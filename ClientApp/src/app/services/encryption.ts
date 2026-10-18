// src/app/services/encryption.ts
// Pure crypto functions — no Angular dependencies
// Extracted from chat.service.ts for unit testing

import * as CryptoJS from 'crypto-js';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface EncryptedPayload {
  content: string;   // Base64 AES-256-CBC ciphertext
  iv:      string;   // Base64, 16 bytes → 24 chars
  salt:    string;   // Base64, 32 bytes → 44 chars
}

export interface UserHash {
  hash:      string;
  timestamp: number;
}

// ─────────────────────────────────────────────
// Key Derivation (PBKDF2)
// ─────────────────────────────────────────────

/**
 * Derives a 256-bit session key from a master key and a unique salt.
 * Uses PBKDF2-SHA256 with 10 000 iterations (OWASP recommendation).
 */
export function deriveSessionKey(
  masterKeyBase64: string,
  salt: CryptoJS.lib.WordArray
): CryptoJS.lib.WordArray {
  return CryptoJS.PBKDF2(masterKeyBase64, salt, {
    keySize:    256 / 32,          // 32 bytes = 256 bits
    iterations: 10000,
    hasher:     CryptoJS.algo.SHA256,
  });
}

// ─────────────────────────────────────────────
// Encryption
// ─────────────────────────────────────────────

/**
 * Encrypts plaintext using AES-256-CBC with a freshly derived session key.
 * Generates cryptographically random IV (128 bit) and Salt (256 bit) per call.
 */
export function encryptMessage(
  plainText:       string,
  masterKeyBase64: string
): EncryptedPayload {
  const iv   = CryptoJS.lib.WordArray.random(16);   // 128 bit
  const salt = CryptoJS.lib.WordArray.random(32);   // 256 bit

  const sessionKey = deriveSessionKey(masterKeyBase64, salt);

  const encrypted = CryptoJS.AES.encrypt(plainText, sessionKey, {
    iv,
    mode:    CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });

  return {
    content: encrypted.toString(),
    iv:      iv.toString(CryptoJS.enc.Base64),
    salt:    salt.toString(CryptoJS.enc.Base64),
  };
}

// ─────────────────────────────────────────────
// Decryption
// ─────────────────────────────────────────────

/**
 * Decrypts an EncryptedPayload using PBKDF2-derived session key.
 * Falls back to a static key when no salt is provided (legacy messages).
 */
export function decryptMessage(
  payload:         EncryptedPayload,
  masterKeyBase64: string,
  staticKey:       CryptoJS.lib.WordArray,
  staticIv:        CryptoJS.lib.WordArray
): string {
  const iv  = payload.iv   ? CryptoJS.enc.Base64.parse(payload.iv)   : staticIv;
  const key = payload.salt
    ? deriveSessionKey(masterKeyBase64, CryptoJS.enc.Base64.parse(payload.salt))
    : staticKey;

  const bytes = CryptoJS.AES.decrypt(payload.content, key, {
    iv,
    mode:    CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });

  if (bytes.sigBytes <= 0) {
    throw new Error('Decryption failed — 0 bytes returned (wrong key or corrupted data)');
  }

  const result = bytes.toString(CryptoJS.enc.Utf8);
  if (!result.trim()) {
    throw new Error('Decryption failed — result is empty');
  }

  return result;
}

// ─────────────────────────────────────────────
// User Hash  (replay-attack protection)
// ─────────────────────────────────────────────

/**
 * Creates a time-bound HMAC-style hash for a user ID.
 * Hash includes userId + Unix timestamp + secret key.
 */
export function createUserHash(userId: string, secretKey: string): UserHash {
  const timestamp  = Math.floor(Date.now() / 1000);
  const raw        = `${userId}:${timestamp}:${secretKey}`;
  const hash       = CryptoJS.enc.Base64.stringify(
    CryptoJS.SHA256(CryptoJS.enc.Utf8.parse(raw))
  );
  return { hash, timestamp };
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

/** Returns true when a string looks like valid Base64. */
export function isBase64(value: string): boolean {
  return /^[A-Za-z0-9+/]+=*$/.test(value);
}