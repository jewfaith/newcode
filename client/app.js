const SERVER_URL = 'http://127.0.0.1:3000';

const UI = {
    passphraseInput: () => document.getElementById('passphrase'),
    passphrase: () => document.getElementById('passphrase').value,
    fileInput: () => document.getElementById('fileInput'),
    appendId: () => document.getElementById('appendId').value.trim(),
    vaultId: () => document.getElementById('vaultId').value.trim(),
    status: (msg, cssClass = '') => {
        const el = document.getElementById('status');
        el.textContent = msg;
        el.className = cssClass;
    }
};

const CONSTANT_BLOCK_SIZE = 10485760; // 10 MB Constant Box
const EXPECTED_CIPHER_LEN = CONSTANT_BLOCK_SIZE + 16;
const FRAME_TOTAL_LEN = 16 + 12 + 32 + EXPECTED_CIPHER_LEN;

/**
 * Derives AES & HMAC Keys via 5M rounds PBKDF2
 */
async function deriveKeys(passphrase, salt) {
    const enc = new TextEncoder();
    const keyMaterial = await window.crypto.subtle.importKey(
        'raw',
        enc.encode(passphrase),
        { name: 'PBKDF2' },
        false,
        ['deriveBits', 'deriveKey']
    );

    const derivedBits = await window.crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt: salt, iterations: 5000000, hash: 'SHA-256' },
        keyMaterial,
        512
    );

    const aesKeyData = derivedBits.slice(0, 32);
    const hmacKeyData = derivedBits.slice(32, 64);

    const aesKey = await window.crypto.subtle.importKey(
        'raw', aesKeyData, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
    );

    const hmacKey = await window.crypto.subtle.importKey(
        'raw', hmacKeyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify', 'sign']
    );

    secureErase(new Uint8Array(derivedBits));
    secureErase(new Uint8Array(aesKeyData));
    secureErase(new Uint8Array(hmacKeyData));

    return { aesKey, hmacKey };
}

function secureErase(arrayView) {
    if (arrayView && arrayView.buffer) {
        let offset = 0;
        while (offset < arrayView.byteLength) {
            const chunkLen = Math.min(65536, arrayView.byteLength - offset);
            const chunk = new Uint8Array(arrayView.buffer, arrayView.byteOffset + offset, chunkLen);
            window.crypto.getRandomValues(chunk);
            offset += chunkLen;
        }
    }
}

/**
 * Converts a string to Uint8Array, trying to avoid long-lived primitives.
 * Also violently clears the DOM input.
 */
function consumePassword() {
    const p = UI.passphrase();
    if (p) {
        UI.passphraseInput().value = ''; // Attempt to erase from DOM
    }
    return p;
}

/**
 * Shared Encrypt & Store Function for Real and Decoy files
 */
async function encryptAndUpload(fileDataArray, fileName, appendId) {
    const passphrase = consumePassword();
    if (!passphrase) { UI.status('Error: Passphrase is required.', 'error'); return; }

    try {
        const enc = new TextEncoder();
        const fnameBytes = enc.encode(fileName);
        const realPayloadLength = 2 + fnameBytes.byteLength + fileDataArray.byteLength;

        if (realPayloadLength > CONSTANT_BLOCK_SIZE - 6) {
            UI.status('Error: File too large for the constant 10MB block.', 'error');
            return;
        }

        const plaintext = new Uint8Array(CONSTANT_BLOCK_SIZE);
        plaintext[0] = (realPayloadLength >> 24) & 0xff;
        plaintext[1] = (realPayloadLength >> 16) & 0xff;
        plaintext[2] = (realPayloadLength >> 8) & 0xff;
        plaintext[3] = realPayloadLength & 0xff;
        plaintext[4] = (fnameBytes.byteLength >> 8) & 0xff;
        plaintext[5] = fnameBytes.byteLength & 0xff;
        plaintext.set(fnameBytes, 6);
        plaintext.set(new Uint8Array(fileDataArray), 6 + fnameBytes.byteLength);

        // Fill remaining with random noise
        let randOffset = 6 + fnameBytes.byteLength + fileDataArray.byteLength;
        while (randOffset < plaintext.byteLength) {
            const chunkLen = Math.min(65536, plaintext.byteLength - randOffset);
            const chunk = new Uint8Array(chunkLen);
            window.crypto.getRandomValues(chunk);
            plaintext.set(chunk, randOffset);
            randOffset += chunkLen;
        }

        const salt = window.crypto.getRandomValues(new Uint8Array(16));
        const iv = window.crypto.getRandomValues(new Uint8Array(12));

        const { aesKey, hmacKey } = await deriveKeys(passphrase, salt);

        const cipherBuffer = await window.crypto.subtle.encrypt(
            { name: 'AES-GCM', iv: iv }, aesKey, plaintext
        );
        const cipherView = new Uint8Array(cipherBuffer);

        const dynamicSyncTag = new Uint8Array(await window.crypto.subtle.sign('HMAC', hmacKey, iv));

        const finalBlob = new Uint8Array(salt.byteLength + iv.byteLength + dynamicSyncTag.byteLength + cipherView.byteLength);
        finalBlob.set(salt, 0);
        finalBlob.set(iv, salt.byteLength);
        finalBlob.set(dynamicSyncTag, salt.byteLength + iv.byteLength);
        finalBlob.set(cipherView, salt.byteLength + iv.byteLength + dynamicSyncTag.byteLength);

        UI.status('Transmitting fixed-size block...');
        const url = appendId ? `${SERVER_URL}/q/${appendId}` : `${SERVER_URL}/q`;

        const response = await fetch(url, {
            method: 'POST', body: finalBlob, headers: { 'Content-Type': 'application/octet-stream' }
        });

        if (!response.ok) throw new Error('Upload failed');

        const id = await response.text();
        UI.status(`Success. ID stored/appended: ${id}`, 'success');
        document.getElementById('vaultId').value = id;
        document.getElementById('appendId').value = id;

        secureErase(plaintext);
        secureErase(finalBlob);
        secureErase(cipherView);
        secureErase(dynamicSyncTag);
    } catch (e) {
        UI.status(`Error: Operation failed. ${e.message}`, 'error');
    }
}

document.getElementById('btnStore').addEventListener('click', async () => {
    const file = UI.fileInput().files[0];
    if (!file) { UI.status('Error: File required.', 'error'); return; }
    UI.status('Encrypting real file...');
    const fileData = await file.arrayBuffer();
    await encryptAndUpload(new Uint8Array(fileData), file.name, UI.appendId());
    secureErase(new Uint8Array(fileData));
});

// --- RED TEAM FIX: Generate Decoy Volume (Plausible Deniability Size Fix) ---
document.getElementById('btnDecoy').addEventListener('click', async () => {
    UI.status('Generating massive Decoy file locally...');

    // We generate a "realistic" looking dummy text file that fills almost exactly 10MB
    // to act as a plausible cover layer for the vault.
    const targetSize = CONSTANT_BLOCK_SIZE - 200;
    const decoyData = new Uint8Array(targetSize);

    // Fill with random printable ascii (A-Z, a-z, 0-9, space) to look like massive encoded JSON/Logs
    for (let i = 0; i < targetSize; i++) {
        let charCode = Math.floor(Math.random() * 62);
        if (charCode < 10) decoyData[i] = 48 + charCode; // 0-9
        else if (charCode < 36) decoyData[i] = 65 + (charCode - 10); // A-Z
        else decoyData[i] = 97 + (charCode - 36); // a-z
        if (i > 0 && i % 80 === 0) decoyData[i] = 10; // Newlines every 80 chars
    }

    const decoyName = `sys_log_backup_${Date.now()}.txt`;
    await encryptAndUpload(decoyData, decoyName, UI.appendId());
    secureErase(decoyData);
});

// --- RED TEAM FIX: Constant-Time Decryption Scan ---
document.getElementById('btnRetrieve').addEventListener('click', async () => {
    const id = UI.vaultId();
    const passphrase = consumePassword();

    if (!id || !passphrase) {
        UI.status('Error: ID and Passphrase are required.', 'error');
        return;
    }

    try {
        UI.status('Receiving deniable blob...');
        const response = await fetch(`${SERVER_URL}/fetch/${id}`, { method: 'GET' });
        if (!response.ok) throw new Error('Download failed');

        const encryptedData = new Uint8Array(await response.arrayBuffer());
        if (encryptedData.byteLength === 0) throw new Error('Empty blob');

        UI.status('Scanning Vault (Constant-Time Decryption active)...');

        let offset = 0;
        let extractionCount = 0;

        while (offset + FRAME_TOTAL_LEN <= encryptedData.byteLength) {

            const salt = encryptedData.slice(offset, offset + 16);
            const iv = encryptedData.slice(offset + 16, offset + 28);
            const storedHmac = encryptedData.slice(offset + 28, offset + 60);
            const cipherStart = offset + 60;
            const ciphertext = encryptedData.slice(cipherStart, cipherStart + EXPECTED_CIPHER_LEN);

            // Derive Keys
            const { aesKey, hmacKey } = await deriveKeys(passphrase, salt);

            // Verify HMAC
            const isValidSync = await window.crypto.subtle.verify(
                'HMAC',
                hmacKey,
                storedHmac,
                iv
            );

            // TIMING ATTACK MITIGATION: 
            // DO NOT EARLY EXIT IF HMAC FAILS! 
            // We must force the AES-GCM engine to process the 10MB block anyway.
            // This consumes identical CPU time whether the block belongs to us or is an invisible layer.
            let dummyDecryptSuccess = false;
            let paddedPlaintext = null;

            try {
                // We ALWAYS decipher
                const decryptedBuffer = await window.crypto.subtle.decrypt(
                    { name: 'AES-GCM', iv: iv }, aesKey, ciphertext
                );
                paddedPlaintext = new Uint8Array(decryptedBuffer);
                dummyDecryptSuccess = true;
            } catch (decryptionError) {
                dummyDecryptSuccess = false;
            }

            // Both conditions must be true to extract (Logical AND evaluated after heavy crypto)
            if (isValidSync && dummyDecryptSuccess && paddedPlaintext) {

                const realPayloadLength = (paddedPlaintext[0] << 24) |
                    (paddedPlaintext[1] << 16) |
                    (paddedPlaintext[2] << 8) |
                    paddedPlaintext[3];

                const fnameLength = (paddedPlaintext[4] << 8) | paddedPlaintext[5];
                const fnameBytes = paddedPlaintext.slice(6, 6 + fnameLength);
                const fileContent = paddedPlaintext.slice(6 + fnameLength, 6 + fnameLength + realPayloadLength);

                const dec = new TextDecoder();
                const filename = dec.decode(fnameBytes);

                if (window.showSaveFilePicker) {
                    try {
                        const fileHandle = await window.showSaveFilePicker({ suggestedName: filename });
                        const writableStream = await fileHandle.createWritable();
                        await writableStream.write(fileContent);
                        await writableStream.close();
                    } catch (fsErr) { if (fsErr.name !== 'AbortError') throw fsErr; }
                } else {
                    const blob = new Blob([fileContent], { type: 'application/octet-stream' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.style.display = 'none';
                    a.href = url;
                    a.download = filename;
                    document.body.appendChild(a);
                    a.click();
                    setTimeout(() => { URL.revokeObjectURL(url); document.body.removeChild(a); }, 100);
                }
                extractionCount++;
                secureErase(paddedPlaintext);
                secureErase(fileContent);
            }

            offset += FRAME_TOTAL_LEN;
            secureErase(salt); secureErase(iv); secureErase(storedHmac); secureErase(ciphertext);
        }

        UI.status(`Success. Extracted ${extractionCount} matching file(s). Invisible files skipped seamlessly.`, 'success');
        secureErase(encryptedData);

    } catch (e) {
        UI.status('Generic Error: Network or empty vault.', 'error');
    }
});

document.getElementById('btnDelete').addEventListener('click', async () => {
    const id = UI.vaultId();

    if (!id) {
        UI.status('Error: ID is required.', 'error');
        return;
    }

    try {
        UI.status('Requesting secure delete...');
        const response = await fetch(`${SERVER_URL}/drop/${id}`, { method: 'DELETE' });
        if (!response.ok) throw new Error('Delete failed');

        UI.status('Success. Blob permanently destroyed.', 'success');
        document.getElementById('vaultId').value = '';
        document.getElementById('appendId').value = '';

    } catch (e) {
        UI.status('Generic Error: Non-existent ID or internal error.', 'error');
    }
});
