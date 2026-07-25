import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { aesGcmCryptoService } from '../../src/infrastructure/crypto/AesGcmCryptoService';
import { nip59GiftWrapService } from '../../src/infrastructure/crypto/Nip59GiftWrapService';
import { eventDagService } from '../../src/domain/services/EventDagService';
import { generateSecretKey, getPublicKey, type Event as NostrEvent } from 'nostr-tools/pure';
import { bytesToHex } from 'nostr-tools/utils';

describe('Security & Validation Policy Tests', () => {
  it('rejects decryption when provided malformed ciphertext or incorrect key', async () => {
    const key = aesGcmCryptoService.generateGroupKeyHex();
    await expect(aesGcmCryptoService.decrypt('invalid_base64_string', key)).rejects.toThrow();

    const wrongKey = aesGcmCryptoService.generateGroupKeyHex();
    const ciphertext = await aesGcmCryptoService.encrypt('Test Data', key);
    await expect(aesGcmCryptoService.decrypt(ciphertext, wrongKey)).rejects.toThrow();
  });

  it('rejects malformed NIP-59 Gift Wrap events cleanly without crashing', () => {
    const secretBytes = generateSecretKey();
    const secretHex = bytesToHex(secretBytes);

    const invalidKindEvent: NostrEvent = {
      id: 'evt_invalid',
      kind: 1, // Text note, not 1059 Gift Wrap
      pubkey: getPublicKey(secretBytes),
      created_at: 1000,
      tags: [],
      content: 'Hello',
      sig: 'sig',
    };

    const res = nip59GiftWrapService.decryptGiftWrap(invalidKindEvent, secretHex);
    expect(res).toBeNull();
  });

  it('rejects events authored by removed/unauthorized members according to protocol rules', () => {
    const authorizedMembers = new Set(['pubkey_alice', 'pubkey_bob']);

    expect(eventDagService.isAuthorAuthorized('pubkey_alice', authorizedMembers)).toBe(true);
    expect(eventDagService.isAuthorAuthorized('pubkey_removed_eve', authorizedMembers)).toBe(false);

    // Stale member attempting to publish key rotation
    const isRotationValid = eventDagService.validateKeyRotation(
      'pubkey_removed_eve',
      2,
      1,
      authorizedMembers
    );
    expect(isRotationValid).toBe(false);
  });
});
