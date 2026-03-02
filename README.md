# ⬛ Zero-Knowledge Vault (OpSec Grade)

A browser-based, pure Zero-Knowledge, Anti-Forensic digital vault designed to withstand extreme adversarial threat models, including nation-state rubber-hose cryptanalysis, cold boot attacks, and L4 network traffic fingerprinting. 

Built with zero external dependencies in standard WebCrypto & Node.js, reaching the theoretical boundaries of Javascript security.

---

## 🛡️ Threat Model & Features

This project assumes the **server is blind**, the **network is hostile (DPI/ISP monitoring)**, and the **operator is under physical extraction threats** (Rubber-hose). 

### 1. Absolute Plausible Deniability (Rubber-Hose Mitigation)
* **Dynamic HMAC Synchronization**: There are no magic bytes (`PK\x03`, `ENC0`) marking where a file begins or ends. Blocks are authenticated via a keyed `HMAC-SHA256` derived from your passphrase.
* **Invisible Vaults**: You can append multiple files to the same Vault ID using *different passphrases*. If coerced by authorities, you yield the *decoy passphrase*. The parser extracts the decoy and mathematically slides over the real data in silence, treating it as indistinguishable cryptographic noise. There is zero mathematical proof that other files exist within the blob.

### 2. Constant-Time & Constant-Size Traffic Fingerprinting Masking
* **Fixed 10MB Chunks**: Whether you upload a 2KB text receipt or a 9MB image, the vault enforces a strict `10,485,760 bytes` block size. The remaining space is padded with `crypto.getRandomValues()`. 
* **Traffic Masking**: ISPs or Firewalls analyzing TLS burst sizes cannot deduce the nature or size of your encrypted data.
* **Constant-Time Decryption**: The decryption routine parses decoy headers consuming the exact same CPU AES-GCM cycles as valid headers, nullifying CPU cache / timing side-channel attacks attempting to isolate the true payload offset.

### 3. Anti-Forensic DOM & RAM Sweeping
* **No `pagefile.sys` Leaks via Blob Spilling**: Eliminates caching decrypted binaries in the `%TMP%` OS folder by streaming directly to disk utilizing modern `FileSystemWritableFileStream` APIs via `showSaveFilePicker()`.
* **Aggressive Buffer Shredding**: Implements forced `crypto.getRandomValues()` overlays on all TypedArrays (`Uint8Array`) before Javascript Garbage Collection kicks in, minimizing the window for Cold Boot RAM extraction.
* **Passphrase DOM Wiping**: Actively violently purges the UI input fields upon buffer consumption.

### 4. ASIC/Brute-Force Resistance
* **5,000,000 PBKDF2 Iterations**: Pushes the WebCrypto API to the extreme. The UI momentarily hangs to force maximum CPU exhaustion during key derivation (SHA-256), punishing GPU/ASIC brute-force clusters attempting offline dictionary attacks on the extracted headers.

### 5. Blind Server (Node.js)
* **Zero Logging & Blind Appends**: The server acts strictly as an asynchronous C++ Stream piped to disk. It removes all headers, ignores file types, and possesses a Mutual Exclusion (Mutex) queue preventing block-interleaving race conditions.
* **True Shredding Drop**: The `/drop/` endpoint does not just `unlink()`. It opens the file descriptor, overwrites the entire block size with `crypto.randomBytes()`, overwrites again with zeros, and only then deletes the inode.

---

## ⚙️ Installation & Usage

**Dependencies**: Node.js (v18+). No external dependencies on the client to avoid supply-chain poisoning.

### 1. Start the Blind Server
```bash
cd server
npm install
node server.js
```
*Note: The server is entirely silent. No startup logs are printed to console to enforce zero-footprint.*

### 2. Access the Vault
Run a local web server in the `client` directory (e.g., `npx -y serve .` or `python -m http.server 8080`) and navigate to `index.html`. 
⚠️ Do not use `file:///` protocol if your browser blocks WebCrypto subtle features in local contexts.

### 3. The Decoy Protocol
1. Enter your `Real Passphrase`. Select your sensitive file and click **Encrypt & Store**.
2. Copy the resulting **64-char Hex ID**.
3. Under *Target Vault ID*, paste the Hex ID.
4. Enter your `Fake Passphrase`. Click **Generate Decoy Fill**.
5. The system will generate a mathematically flawless 10MB dummy file consisting of random alphanumeric characters and append it to your true file. 
6. *If coerced, only surrender the Fake Passphrase.*

---

## ⚠️ Red Team Epilogue (Known Limitations)
This software has reached the maximum extent of browser sandbox capabilities. A successful attack against this vault no longer targets the encryption, but the hostile host environment:
1. **OS Paging**: JS `ArrayBuffers` cannot be `mlocked()`. The OS may unexpectedly swap the decrypted RAM to the hard drive in low-memory situations.
2. **Deterministic Entropy**: Runs inside VMs might have their `/dev/urandom` manipulated by a hostile hypervisor, compromising block padding entropy.
3. **Hardware Keyloggers & Acoustic Side-Channels**.

*For absolute security, this vault must be operated over an Amnesic Live USB OS (like Tails) without persistent storage.*
