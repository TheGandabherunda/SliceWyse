import { describe, it, expect } from 'vitest';
import { aesGcmCryptoService } from '../../src/infrastructure/crypto/AesGcmCryptoService';

describe('AesGcmCryptoService', () => {
  it('generates a 64-character hex 32-byte group key', () => {
    const keyHex = aesGcmCryptoService.generateGroupKeyHex();
    expect(keyHex).toMatch(/^[0-9a-f]{64}$/i);
  });

  it('encrypts and decrypts payload cleanly with AES-256-GCM', async () => {
    const keyHex = aesGcmCryptoService.generateGroupKeyHex();
    const plaintext = JSON.stringify({ title: "Dinner at Mario's", amountCents: 12000 });

    const ciphertext = await aesGcmCryptoService.encrypt(plaintext, keyHex);
    expect(ciphertext).toContain(':'); // Contains base64(iv):base64(ciphertext)

    const decrypted = await aesGcmCryptoService.decrypt(ciphertext, keyHex);
    expect(decrypted).toBe(plaintext);
  });

  it('enforces fresh unique IVs for every encryption operation', async () => {
    const keyHex = aesGcmCryptoService.generateGroupKeyHex();
    const plaintext = 'Secret Expense Payload';

    const enc1 = await aesGcmCryptoService.encrypt(plaintext, keyHex);
    const enc2 = await aesGcmCryptoService.encrypt(plaintext, keyHex);

    const iv1 = enc1.split(':')[0];
    const iv2 = enc2.split(':')[0];

    // IVs must never be equal
    expect(iv1).not.toBe(iv2);
  });

  it('fails decryption when provided incorrect key', async () => {
    const key1 = aesGcmCryptoService.generateGroupKeyHex();
    const key2 = aesGcmCryptoService.generateGroupKeyHex();

    const ciphertext = await aesGcmCryptoService.encrypt('Test', key1);
    await expect(aesGcmCryptoService.decrypt(ciphertext, key2)).rejects.toThrow();
  });
});
