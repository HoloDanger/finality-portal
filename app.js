document.addEventListener('DOMContentLoaded', () => {
    // Matrix Code Rain Background
    const canvas = document.getElementById('matrix-canvas');
    const ctx = canvas.getContext('2d');

    let width = canvas.width = window.innerWidth;
    let height = canvas.height = window.innerHeight;

    const fontSize = 14;
    const columns = Math.floor(width / fontSize);
    const yPositions = Array(columns).fill(0);

    function drawMatrix() {
        ctx.fillStyle = 'rgba(5, 5, 5, 0.05)';
        ctx.fillRect(0, 0, width, height);

        ctx.fillStyle = '#00ffcc';
        ctx.font = `${fontSize}px monospace`;

        for (let i = 0; i < yPositions.length; i++) {
            // Pick a random binary digit (0 or 1)
            const char = Math.random() > 0.5 ? '0' : '1';
            const x = i * fontSize;
            const y = yPositions[i];

            // Render glowing head
            if (Math.random() > 0.98) {
                ctx.fillStyle = '#ffffff';
            } else {
                ctx.fillStyle = '#00ffcc';
            }

            ctx.fillText(char, x, y);

            if (y > 100 + Math.random() * 10000) {
                yPositions[i] = 0;
            } else {
                yPositions[i] += fontSize;
            }
        }
    }

    let matrixInterval = setInterval(drawMatrix, 33);

    window.addEventListener('resize', () => {
        width = canvas.width = window.innerWidth;
        height = canvas.height = window.innerHeight;
    });

    const keyInput = document.getElementById('key-input');
    const submitBtn = document.getElementById('submit-btn');
    const errorMsg = document.getElementById('error-msg');
    const authPanel = document.getElementById('auth-panel');
    const letterPanel = document.getElementById('letter-panel');
    const entropyPanel = document.getElementById('entropy-panel');
    const countdownWrapper = document.getElementById('countdown-wrapper');
    const lockBtn = document.getElementById('lock-btn');

    // Letter Elements
    const letterTitle = document.getElementById('letter-title');
    const metaRecipient = document.getElementById('meta-recipient');
    const metaRole = document.getElementById('meta-role');
    const letterContent = document.getElementById('letter-content');

    // Countdown Timer Elements
    const dSpan = document.getElementById('days');
    const hSpan = document.getElementById('hours');
    const mSpan = document.getElementById('minutes');
    const sSpan = document.getElementById('seconds');

    let expirationTime = null;
    let countdownInterval = null;
    let typewriterTimeout = null;

    // 1. QUERY ENTROPY METADATA & INITIALIZE COUNTDOWN
    async function initConduit() {
        try {
            const response = await fetch('/api/entropy-status');
            const data = await response.json();
            
            expirationTime = new Date(data.expirationTime).getTime();
            
            if (data.isExpired) {
                triggerEntropyShutdown();
            } else {
                startCountdown();
            }
        } catch (err) {
            console.error("Failed to connect to finality daemon:", err);
            // Offline fallback: 7 days countdown if backend is not reachable
            expirationTime = new Date().getTime() + (7 * 24 * 60 * 60 * 1000);
            startCountdown();
        }
    }

    function startCountdown() {
        if (countdownInterval) clearInterval(countdownInterval);
        
        updateTimer();
        countdownInterval = setInterval(updateTimer, 1000);
    }

    function updateTimer() {
        const now = new Date().getTime();
        const distance = expirationTime - now;

        if (distance <= 0) {
            clearInterval(countdownInterval);
            triggerEntropyShutdown();
            return;
        }

        const days = Math.floor(distance / (1000 * 60 * 60 * 24));
        const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((distance % (1000 * 60)) / 1000);

        dSpan.textContent = String(days).padStart(2, '0');
        hSpan.textContent = String(hours).padStart(2, '0');
        mSpan.textContent = String(minutes).padStart(2, '0');
        sSpan.textContent = String(seconds).padStart(2, '0');
    }

    // 2. TRIGGER ENTROPY SHUTDOWN (DATA WIPE VIEW)
    function triggerEntropyShutdown() {
        dSpan.textContent = '00';
        hSpan.textContent = '00';
        mSpan.textContent = '00';
        sSpan.textContent = '00';
        
        countdownWrapper.style.borderColor = 'var(--entropy-red)';
        
        authPanel.classList.add('hidden');
        letterPanel.classList.add('hidden');
        entropyPanel.classList.remove('hidden');
    }

    // Cryptography Helpers for Path A (Zero-Trust Local Decryption)
    async function sha256(str) {
        const buf = new TextEncoder().encode(str);
        return await crypto.subtle.digest('SHA-256', buf);
    }

    async function deriveKeyPBKDF2(passphrase, saltStr, iterations) {
        const baseKey = await crypto.subtle.importKey(
            "raw",
            new TextEncoder().encode(passphrase),
            "PBKDF2",
            false,
            ["deriveBits"]
        );
        const derivedBits = await crypto.subtle.deriveBits(
            {
                name: "PBKDF2",
                salt: new TextEncoder().encode(saltStr),
                iterations: iterations,
                hash: "SHA-256"
            },
            baseKey,
            256
        );
        return derivedBits; // ArrayBuffer (32 bytes)
    }

    function bufToHex(buffer) {
        return Array.from(new Uint8Array(buffer))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    }

    function hexToBuf(hex) {
        const bytes = new Uint8Array(hex.length / 2);
        for (let i = 0; i < hex.length; i += 2) {
            bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
        }
        return bytes;
    }

    async function decryptPayload(keyBuffer, nonceHex, ciphertextHex) {
        const key = await crypto.subtle.importKey(
            "raw",
            keyBuffer,
            { name: "AES-GCM" },
            false,
            ["decrypt"]
        );
        const nonce = hexToBuf(nonceHex);
        const ciphertext = hexToBuf(ciphertextHex);

        const decrypted = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: nonce },
            key,
            ciphertext
        );

        return new TextDecoder().decode(decrypted);
    }

    // 3. DECRYPT CONDUIT TRANSACTION
    async function attemptDecryption() {
        if (submitBtn.disabled) return;
        const rawKey = keyInput.value.trim();
        if (!rawKey) {
            triggerShake(authPanel);
            errorMsg.textContent = "CRITICAL ERROR: Key register is empty.";
            return;
        }

        const key = rawKey.toLowerCase();
        submitBtn.disabled = true;
        submitBtn.textContent = "DECRYPTING...";
        errorMsg.textContent = "";

        try {
            // Compute auth key identifier client-side using PBKDF2 stretching
            const authKeyHash = await deriveKeyPBKDF2(key, "finality-auth-salt-2026", 100000);
            const authKeyHex = bufToHex(authKeyHash);

            const response = await fetch(`/api/letter?id=${authKeyHex}`, {
                method: 'GET'
            });

            if (response.status === 410) {
                triggerEntropyShutdown();
                return;
            }

            const data = await response.json();

            if (response.ok) {
                // Decrypt envelope locally in-browser using PBKDF2 stretched key
                const cryptKeyBuf = await deriveKeyPBKDF2(key, "finality-crypt-salt-2026", 100000);
                const plaintextStr = await decryptPayload(cryptKeyBuf, data.nonce, data.ciphertext);
                const letter = JSON.parse(plaintextStr);

                // Success: render letter
                authPanel.classList.add('hidden');
                letterPanel.classList.remove('hidden');
                
                letterTitle.textContent = `EXTRACTED_TRANSMISSION // KEY_${key.toUpperCase()}`;
                metaRecipient.textContent = letter.recipient;
                metaRole.textContent = letter.role;
                
                // Animate letter text ingestion
                typeWriterEffect(letterContent, letter.content);
                keyInput.value = '';
            } else {
                // Auth error
                triggerShake(authPanel);
                errorMsg.textContent = `DECRYPTION_FAILED: ${data.error || "Invalid cryptographic key."}`;
                keyInput.select();
            }
        } catch (err) {
            console.error("Local decryption failure:", err);
            triggerShake(authPanel);
            errorMsg.textContent = "DECRYPTION_FAILED: Invalid cryptographic key.";
            keyInput.select();
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = "DECRYPT CONDUIT";
        }
    }

    function triggerShake(element) {
        element.classList.remove('shake');
        void element.offsetWidth; // Trigger reflow to restart animation
        element.classList.add('shake');
        setTimeout(() => element.classList.remove('shake'), 400);
    }

    function typeWriterEffect(element, text) {
        if (typewriterTimeout) {
            clearTimeout(typewriterTimeout);
            typewriterTimeout = null;
        }
        element.innerHTML = '';
        let index = 0;
        
        // Speed up typwriter for longer texts
        const speed = text.length > 500 ? 5 : 12;

        function type() {
            if (index < text.length) {
                // Handle newlines correctly
                if (text.charAt(index) === '\n') {
                    element.innerHTML += '<br>';
                } else {
                    element.innerHTML += text.charAt(index);
                }
                index++;
                typewriterTimeout = setTimeout(type, speed);
            } else {
                typewriterTimeout = null;
            }
        }
        type();
    }

    // 4. LOCK TRANSMISSION (SECURE SHIELD)
    function lockConduit() {
        if (typewriterTimeout) {
            clearTimeout(typewriterTimeout);
            typewriterTimeout = null;
        }
        if (!letterPanel.classList.contains('hidden')) {
            letterPanel.classList.add('hidden');
            authPanel.classList.remove('hidden');
            letterContent.innerHTML = '';
            metaRecipient.textContent = '...';
            metaRole.textContent = '...';
            keyInput.value = '';
            keyInput.focus();
        }
    }

    lockBtn.addEventListener('click', lockConduit);

    // Event Bindings
    submitBtn.addEventListener('click', attemptDecryption);
    keyInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            attemptDecryption();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            lockConduit();
        }
    });

    // Run Initialization
    initConduit();
});
