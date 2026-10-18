// tests/unit/encryption.test.ts
// Unit tests for src/app/services/encryption.ts
// Run: npx jest --coverage

import * as CryptoJS from 'crypto-js';
import {
  encryptMessage,
  decryptMessage,
  deriveSessionKey,
  createUserHash,
  isBase64,
  EncryptedPayload,
} from '../../src/app/services/encryption';

declare const describe: any;
declare const test: any;
declare const expect: any;
declare const beforeAll: any;

// ─────────────────────────────────────────────
// Test fixtures (mirrors environment.ts values)
// ─────────────────────────────────────────────

const MASTER_KEY_BASE64  = 'X3emQ+JwTuEV4Jj6Jbfsg6hWaPHbh+vu18dEdXYuXso=';
const STATIC_IV_BASE64   = '5nQIu+58DHvGuTmoH5Wf0A==';
const USER_HASH_SECRET   = 'test-secret-key-for-unit-tests';

const STATIC_KEY = CryptoJS.enc.Base64.parse(MASTER_KEY_BASE64);
const STATIC_IV  = CryptoJS.enc.Base64.parse(STATIC_IV_BASE64);

// ─────────────────────────────────────────────
// encryptMessage()
// ─────────────────────────────────────────────

describe('encryptMessage()', () => {

  test('returns ciphertext different from plaintext', () => {
    const { content } = encryptMessage('Hello World', MASTER_KEY_BASE64);
    expect(content).not.toBe('Hello World');
    expect(content.length).toBeGreaterThan(10);
  });

  test('ciphertext is valid Base64', () => {
    const { content } = encryptMessage('Test', MASTER_KEY_BASE64);
    expect(isBase64(content)).toBe(true);
  });

  test('IV is 24 Base64 chars (16 bytes)', () => {
    const { iv } = encryptMessage('Test', MASTER_KEY_BASE64);
    expect(iv.length).toBe(24);
    expect(isBase64(iv)).toBe(true);
  });

  test('Salt is 44 Base64 chars (32 bytes)', () => {
    const { salt } = encryptMessage('Test', MASTER_KEY_BASE64);
    expect(salt.length).toBe(44);
    expect(isBase64(salt)).toBe(true);
  });

  test('same plaintext produces different ciphertext each call (random IV/Salt)', () => {
    const p1 = encryptMessage('Repeated message', MASTER_KEY_BASE64);
    const p2 = encryptMessage('Repeated message', MASTER_KEY_BASE64);
    // IV and Salt must differ
    expect(p1.iv).not.toBe(p2.iv);
    expect(p1.salt).not.toBe(p2.salt);
    // Ciphertext must also differ
    expect(p1.content).not.toBe(p2.content);
    console.log('  ✅ Random IV/Salt: each encryption is unique (no pattern leakage)');
  });

  test('encrypts Unicode and special characters', () => {
    const original = 'Привіт! 🔐 <script>alert(1)</script>';
    const { content } = encryptMessage(original, MASTER_KEY_BASE64);
    expect(content).not.toBe(original);
    expect(isBase64(content)).toBe(true);
  });

  test('encrypts a 1000-character string', () => {
    const long = 'A'.repeat(1000);
    const { content } = encryptMessage(long, MASTER_KEY_BASE64);
    expect(content.length).toBeGreaterThan(1000);
  });

});

// ─────────────────────────────────────────────
// decryptMessage()
// ─────────────────────────────────────────────

describe('decryptMessage()', () => {

  test('round-trip: decrypt(encrypt(x)) === x', () => {
    const original = `Diploma test — ${Date.now()}`;
    const payload  = encryptMessage(original, MASTER_KEY_BASE64);
    const result   = decryptMessage(payload, MASTER_KEY_BASE64, STATIC_KEY, STATIC_IV);
    expect(result).toBe(original);
    console.log(`  ✅ Round-trip OK: "${result}"`);
  });

  test('round-trip preserves Unicode', () => {
    const original = 'Привіт 🔐 世界';
    const payload  = encryptMessage(original, MASTER_KEY_BASE64);
    expect(decryptMessage(payload, MASTER_KEY_BASE64, STATIC_KEY, STATIC_IV)).toBe(original);
  });

  test('round-trip preserves 1000-char string', () => {
    const original = 'B'.repeat(1000);
    const payload  = encryptMessage(original, MASTER_KEY_BASE64);
    expect(decryptMessage(payload, MASTER_KEY_BASE64, STATIC_KEY, STATIC_IV)).toBe(original);
  });

  test('throws when wrong master key is used', () => {
    const payload  = encryptMessage('Secret', MASTER_KEY_BASE64);
    const wrongKey = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

    expect(() =>
      decryptMessage(payload, wrongKey, STATIC_KEY, STATIC_IV)
    ).toThrow();
    console.log('  ✅ Wrong key correctly throws');
  });

  test('throws when content is corrupted (random bytes ≠ valid ciphertext)', () => {
    // Use valid Base64 but random bytes — AES will produce garbage, sigBytes check will throw
    const payload: EncryptedPayload = {
      content: CryptoJS.lib.WordArray.random(20).toString(CryptoJS.enc.Base64),
      iv:      CryptoJS.lib.WordArray.random(16).toString(CryptoJS.enc.Base64),
      salt:    CryptoJS.lib.WordArray.random(32).toString(CryptoJS.enc.Base64),
    };
    expect(() =>
      decryptMessage(payload, MASTER_KEY_BASE64, STATIC_KEY, STATIC_IV)
    ).toThrow();
    console.log('  ✅ Random bytes content correctly throws on decryption');
  });

  test('uses static key when no salt provided (legacy fallback)', () => {
    // Encrypt with static key directly (old format — no salt)
    const iv        = CryptoJS.lib.WordArray.random(16);
    const encrypted = CryptoJS.AES.encrypt('Legacy message', STATIC_KEY, {
      iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7,
    }).toString();

    const payload: EncryptedPayload = {
      content: encrypted,
      iv:      iv.toString(CryptoJS.enc.Base64),
      salt:    '',   // no salt → legacy path
    };

    const result = decryptMessage(payload, MASTER_KEY_BASE64, STATIC_KEY, STATIC_IV);
    expect(result).toBe('Legacy message');
    console.log('  ✅ Legacy (no-salt) fallback works');
  });

});

// ─────────────────────────────────────────────
// deriveSessionKey()
// ─────────────────────────────────────────────

describe('deriveSessionKey()', () => {

  test('returns a 256-bit (32-byte) key', () => {
    const salt = CryptoJS.lib.WordArray.random(32);
    const key  = deriveSessionKey(MASTER_KEY_BASE64, salt);
    expect(key.sigBytes).toBe(32);
  });

  test('same inputs produce same key (deterministic)', () => {
    const salt = CryptoJS.lib.WordArray.random(32);
    const k1   = deriveSessionKey(MASTER_KEY_BASE64, salt);
    const k2   = deriveSessionKey(MASTER_KEY_BASE64, salt);
    expect(k1.toString()).toBe(k2.toString());
  });

  test('different salts produce different keys', () => {
    const s1 = CryptoJS.lib.WordArray.random(32);
    const s2 = CryptoJS.lib.WordArray.random(32);
    const k1 = deriveSessionKey(MASTER_KEY_BASE64, s1);
    const k2 = deriveSessionKey(MASTER_KEY_BASE64, s2);
    expect(k1.toString()).not.toBe(k2.toString());
    console.log('  ✅ Unique salt → unique session key');
  });

  test('different master keys produce different derived keys', () => {
    const salt = CryptoJS.lib.WordArray.random(32);
    const k1   = deriveSessionKey(MASTER_KEY_BASE64, salt);
    const k2   = deriveSessionKey('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', salt);
    expect(k1.toString()).not.toBe(k2.toString());
  });

});

// ─────────────────────────────────────────────
// createUserHash()
// ─────────────────────────────────────────────

describe('createUserHash()', () => {

  test('returns a non-empty hash string', () => {
    const { hash } = createUserHash('user-1', USER_HASH_SECRET);
    expect(hash.length).toBeGreaterThan(20);
    expect(isBase64(hash)).toBe(true);
  });

  test('includes a Unix timestamp', () => {
    const { timestamp } = createUserHash('user-1', USER_HASH_SECRET);
    expect(timestamp).toBeCloseTo(Math.floor(Date.now() / 1000), -1);
  });

  test('different userIds produce different hashes', () => {
    const { hash: h1 } = createUserHash('user-A', USER_HASH_SECRET);
    const { hash: h2 } = createUserHash('user-B', USER_HASH_SECRET);
    expect(h1).not.toBe(h2);
    console.log('  ✅ Different users → different hashes');
  });

  test('same userId within same second produces same hash', () => {
    const { hash: h1 } = createUserHash('user-X', USER_HASH_SECRET);
    const { hash: h2 } = createUserHash('user-X', USER_HASH_SECRET);
    expect(h1).toBe(h2);
    console.log('  ✅ Hash is deterministic within the same second');
  });

  test('different secret keys produce different hashes', () => {
    const { hash: h1 } = createUserHash('user-1', 'secret-A');
    const { hash: h2 } = createUserHash('user-1', 'secret-B');
    expect(h1).not.toBe(h2);
  });

});

// ─────────────────────────────────────────────
// isBase64()
// ─────────────────────────────────────────────

describe('isBase64()', () => {

  test('valid Base64 returns true', () => {
    expect(isBase64('SGVsbG8gV29ybGQ=')).toBe(true);
    expect(isBase64('GOFTI6MgabgNGT8WB6omVg==')).toBe(true);
  });

  test('plain text returns false', () => {
    expect(isBase64('Hello, World!')).toBe(false);
    expect(isBase64('not base64 !@#$')).toBe(false);
  });

  test('encrypted output passes isBase64 check', () => {
    const { content } = encryptMessage('Any message', MASTER_KEY_BASE64);
    expect(isBase64(content)).toBe(true);
  });

});