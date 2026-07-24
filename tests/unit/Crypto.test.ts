import { describe, it, expect } from 'vitest';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { bytesToHex } from 'nostr-tools/utils';
import { Nip44CryptoService } from '../../src/infrastructure/crypto/Nip44CryptoService';

describe('NIP-44 Crypto Service', () => {
  const cryptoService = new Nip44CryptoService();

  it('should encrypt and decrypt JSON payloads between Nostr keypairs', () => {
    const aliceSecretBytes = generateSecretKey();
    const aliceSecretHex = bytesToHex(aliceSecretBytes);

    const bobSecretBytes = generateSecretKey();
    const bobPubkeyHex = getPublicKey(bobSecretBytes);

    const conversationKey = cryptoService.getConversationKey(aliceSecretHex, bobPubkeyHex);

    const originalData = {
      expenseId: 'exp_123',
      amountCents: 4500,
      title: 'Secret Izakaya Dinner',
    };

    const encrypted = cryptoService.encryptObject(originalData, conversationKey);
    expect(encrypted).not.toBe(JSON.stringify(originalData));

    const decrypted = cryptoService.decryptObject(encrypted, conversationKey);
    expect(decrypted).toEqual(originalData);
  });
});
