const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const app = express();
const PORT = 3000;
const UPLOADS_DIR = path.join(__dirname, 'vault');

if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

app.use(cors({ origin: '*', methods: ['POST', 'GET', 'DELETE'] }));

app.use((req, res, next) => {
    res.removeHeader('X-Powered-By');
    res.removeHeader('Date');
    res.removeHeader('Connection');
    res.removeHeader('Keep-Alive');
    next();
});

const blindError = (res) => {
    if (!res.headersSent) res.status(500).end();
};

const sendNotFound = (res) => {
    if (!res.headersSent) res.status(404).end();
};

// --- Transactional Concurrency Lock for Appends ---
const lockEvents = new EventEmitter();
lockEvents.setMaxListeners(0);
const activeLocks = new Set();

const acquireLock = (id) => {
    return new Promise(resolve => {
        if (!activeLocks.has(id)) {
            activeLocks.add(id);
            resolve();
            return;
        }
        const tryAcquire = (releasedId) => {
            if (releasedId === id && !activeLocks.has(id)) {
                activeLocks.add(id);
                lockEvents.removeListener('release', tryAcquire);
                resolve();
            }
        };
        lockEvents.on('release', tryAcquire);
    });
};

const releaseLock = (id) => {
    activeLocks.delete(id);
    lockEvents.emit('release', id);
};
// ---------------------------------------------------

app.post(['/q', '/q/:id'], async (req, res) => {
    try {
        const id = req.params.id || crypto.randomBytes(32).toString('hex');
        if (req.params.id && !/^[0-9a-f]{64}$/i.test(id)) {
            return sendNotFound(res);
        }

        const filePath = path.join(UPLOADS_DIR, id);

        await acquireLock(id); // Prevent interleaved chunks (Race Condition Fix)

        const writeStream = fs.createWriteStream(filePath, { flags: 'a' });

        req.pipe(writeStream);

        req.on('end', () => {
            releaseLock(id);
            res.status(200).send(id);
        });

        req.on('error', () => {
            writeStream.close();
            releaseLock(id);
            blindError(res);
        });

        writeStream.on('error', () => {
            writeStream.close();
            releaseLock(id);
            blindError(res);
        });

    } catch (err) {
        blindError(res);
    }
});

app.get('/fetch/:id', (req, res) => {
    try {
        const id = req.params.id;
        if (!/^[0-9a-f]{64}$/i.test(id)) return sendNotFound(res);

        const filePath = path.join(UPLOADS_DIR, id);
        if (!fs.existsSync(filePath)) return sendNotFound(res);

        res.set('Content-Type', 'application/octet-stream');
        res.set('Content-Disposition', 'attachment; filename="encrypted_blob.bin"');

        const readStream = fs.createReadStream(filePath);
        readStream.on('error', () => blindError(res));
        readStream.pipe(res);
    } catch (err) {
        blindError(res);
    }
});

app.delete('/drop/:id', (req, res) => {
    try {
        const id = req.params.id;
        if (!/^[0-9a-f]{64}$/i.test(id)) return sendNotFound(res);

        const filePath = path.join(UPLOADS_DIR, id);
        if (!fs.existsSync(filePath)) return sendNotFound(res);

        res.status(200).end();

        setTimeout(() => {
            try {
                if (fs.existsSync(filePath)) {
                    const stats = fs.statSync(filePath);
                    const fd = fs.openSync(filePath, 'r+');

                    if (stats.size > 0) {
                        const randomBuf = crypto.randomBytes(stats.size);
                        fs.writeSync(fd, randomBuf, 0, stats.size, 0);

                        const zeroBuf = Buffer.alloc(stats.size, 0);
                        fs.writeSync(fd, zeroBuf, 0, stats.size, 0);
                    }

                    fs.closeSync(fd);
                    fs.unlinkSync(filePath);
                }
            } catch (e) { }
        }, 50);

    } catch (err) {
        blindError(res);
    }
});

app.use((req, res) => sendNotFound(res));

app.listen(PORT, '127.0.0.1', () => { });
process.on('uncaughtException', () => { });
process.on('unhandledRejection', () => { });
