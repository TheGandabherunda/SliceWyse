import { describe, it, expect } from 'vitest';
import {
  nip59GiftWrapService,
  type GroupKeyEnvelope,
} from '../../src/infrastructure/crypto/Nip59GiftWrapService';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { bytesToHex } from 'nostr-tools/utils';

describe('Nip59GiftWrapService', () => {
  it('creates and decrypts NIP-59 Gift Wrap key envelopes using NIP-44 v2', async () => {
    const aliceSecretBytes = generateSecretKey();
    const aliceSecretHex = bytesToHex(aliceSecretBytes);
    const alicePubkey = getPublicKey(aliceSecretBytes);

    const bobSecretBytes = generateSecretKey();
    const bobSecretHex = bytesToHex(bobSecretBytes);
    const bobPubkey = getPublicKey(bobSecretBytes);

    const envelope: GroupKeyEnvelope = {
      protocolVersion: 1,
      groupId: 'grp_123',
      keyVersion: 1,
      groupKey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      issuedAt: 1753488000,
    };

    // Alice creates Gift Wrap for Bob
    const giftWrapEvent = await nip59GiftWrapService.createGiftWrap(
      envelope,
      aliceSecretHex,
      bobPubkey
    );
    expect(giftWrapEvent.kind).toBe(1059);
    expect(giftWrapEvent.tags).toEqual([['p', bobPubkey]]);

    // Bob decrypts Gift Wrap from Alice
    const decrypted = nip59GiftWrapService.decryptGiftWrap(
      giftWrapEvent,
      bobSecretHex,
      alicePubkey
    );
    expect(decrypted).not.toBeNull();
    expect(decrypted?.groupId).toBe('grp_123');
    expect(decrypted?.groupKey).toBe(envelope.groupKey);
  });
});
