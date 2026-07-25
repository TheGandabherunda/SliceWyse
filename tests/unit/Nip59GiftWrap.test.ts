import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
  nip59GiftWrapService,
  type GroupKeyEnvelope,
} from '../../src/infrastructure/crypto/Nip59GiftWrapService';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { bytesToHex } from 'nostr-tools/utils';
import { syncCoordinator } from '../../src/application/services/SyncCoordinator';
import { db } from '../../src/infrastructure/db/SliceWyseDatabase';

describe('NIP-59 Gift Wrap Key Envelope Tests', () => {
  beforeEach(async () => {
    await db.sync_queue.clear();
  });

  it('Alice wraps group key for Bob, Bob unwraps, Charlie fails to unwrap', () => {
    const aliceSecretBytes = generateSecretKey();
    const aliceSecretHex = bytesToHex(aliceSecretBytes);
    const alicePubkey = getPublicKey(aliceSecretBytes);

    const bobSecretBytes = generateSecretKey();
    const bobSecretHex = bytesToHex(bobSecretBytes);
    const bobPubkey = getPublicKey(bobSecretBytes);

    const charlieSecretBytes = generateSecretKey();
    const charlieSecretHex = bytesToHex(charlieSecretBytes);

    const envelope: GroupKeyEnvelope = {
      protocolVersion: 1,
      groupId: 'grp_test',
      keyVersion: 1,
      groupKey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      issuedAt: 1753488000,
    };

    // Alice wraps key envelope for Bob
    const giftWrapEvent = nip59GiftWrapService.createGiftWrap(envelope, aliceSecretHex, bobPubkey);

    expect(giftWrapEvent.kind).toBe(1059);
    // Outer Gift Wrap pubkey must be an ephemeral key, NOT Alice's real pubkey
    expect(giftWrapEvent.pubkey).not.toBe(alicePubkey);
    expect(giftWrapEvent.tags).toEqual([['p', bobPubkey]]);

    // Bob unwraps Gift Wrap
    const bobResult = nip59GiftWrapService.decryptGiftWrap(giftWrapEvent, bobSecretHex);
    expect(bobResult).not.toBeNull();
    expect(bobResult?.senderPubkey).toBe(alicePubkey); // Verified real sender pubkey from seal
    expect(bobResult?.envelope.groupKey).toBe(envelope.groupKey);

    // Charlie fails to unwrap Bob's Gift Wrap
    const charlieResult = nip59GiftWrapService.decryptGiftWrap(giftWrapEvent, charlieSecretHex);
    expect(charlieResult).toBeNull();
  });

  it('asserts that event ID entering publication queue equals the exact event ID published', async () => {
    const aliceSecretBytes = generateSecretKey();
    const aliceSecretHex = bytesToHex(aliceSecretBytes);
    const bobPubkey = getPublicKey(generateSecretKey());

    const envelope: GroupKeyEnvelope = {
      protocolVersion: 1,
      groupId: 'grp_queue_test',
      keyVersion: 1,
      groupKey: '1111111111111111111111111111111111111111111111111111111111111111',
      issuedAt: 1753488000,
    };

    const giftWrapEvent = nip59GiftWrapService.createGiftWrap(envelope, aliceSecretHex, bobPubkey);
    await syncCoordinator.enqueueSignedEvent(giftWrapEvent, envelope.groupId, bobPubkey);

    const queuedItem = await db.sync_queue.where({ groupId: envelope.groupId }).first();
    expect(queuedItem).toBeDefined();
    // Queued event ID MUST equal the exact signed gift wrap event ID
    expect(queuedItem?.eventId).toBe(giftWrapEvent.id);

    const deserializedSignedEvent = JSON.parse(queuedItem!.signedNostrEventJson!);
    expect(deserializedSignedEvent.id).toBe(giftWrapEvent.id);
    expect(deserializedSignedEvent.sig).toBe(giftWrapEvent.sig);
  });
});
