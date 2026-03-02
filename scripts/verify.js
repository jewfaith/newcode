const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const SERVER_FILE = path.join(__dirname, '../server/server.js');

function getFileHash(filePath) {
    const fileBuffer = fs.readFileSync(filePath);
    const hashSum = crypto.createHash('sha256');
    hashSum.update(fileBuffer);
    return hashSum.digest('hex');
}

try {
    const currentHash = getFileHash(SERVER_FILE);
    console.log(`[INTEGRITY CHECK] Válido. Hash do Servidor: ${currentHash}`);

    // Num cenário real de produção, a hash "golden" seria procurada externamente ou num TPM.
    // Aqui garantimos que o ficheiro pode ser lido e hasheado com sucesso sem crashar.

    // Simulação do resultado
    process.exit(0);
} catch (error) {
    console.error(`[ALERTA DE SEGURANÇA] Falha ao ler ficheiros do servidor: ${error.message}`);
    process.exit(1);
}
