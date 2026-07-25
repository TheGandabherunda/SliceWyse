import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { generateSecretKey, getPublicKey, type Event as NostrEvent } from 'nostr-tools/pure';
import { bytesToHex } from 'nostr-tools/utils';
import { db } from '../../src/infrastructure/db/SliceWyseDatabase';
import {
  nip59GiftWrapService,
  type GroupKeyEnvelope,
} from '../../src/infrastructure/crypto/Nip59GiftWrapService';
import { aesGcmCryptoService } from '../../src/infrastructure/crypto/AesGcmCryptoService';
import { EventReducer } from '../../src/domain/services/EventReducer';

describe('Group Key Self-Recovery Test Across Isolated DB Contexts', () => {
  beforeEach(async () => {
    await db.identities.clear();
    await db.group_keys.clear();
    await db.groups.clear();
    await db.expenses.clear();
  });

  it('recovers group key and decrypts historical group and expenses in clean DB context', async () => {
    const aliceSecretBytes = generateSecretKey();
    const aliceSecretHex = bytesToHex(aliceSecretBytes);
    const alicePubkey = getPublicKey(aliceSecretBytes);

    // --- BROWSER CONTEXT 1 ---
    const groupKeyHex = aesGcmCryptoService.generateGroupKeyHex();
    const envelope: GroupKeyEnvelope = {
      protocolVersion: 1,
      groupId: 'grp_self_recovery',
      keyVersion: 1,
      groupKey: groupKeyHex,
      issuedAt: 1753488000,
    };

    // Alice creates self-recovery Gift Wrap event
    const giftWrapEvent: NostrEvent = nip59GiftWrapService.createGiftWrap(
      envelope,
      aliceSecretHex,
      alicePubkey
    );

    // Alice creates group creation event payload encrypted with AES-256-GCM
    const rawGroupPayload = {
      type: 'GROUP_CREATED',
      groupId: 'grp_self_recovery',
      name: 'Vacation Trip',
      currency: 'EUR',
      members: [{ pubkey: alicePubkey, displayName: 'Alice' }],
      keyVersion: 1,
      parentEventIds: [],
      createdAt: 1753488000,
    };
    const encryptedGroupPayload = await aesGcmCryptoService.encrypt(
      JSON.stringify(rawGroupPayload),
      groupKeyHex
    );

    const groupEvent: NostrEvent = {
      id: 'evt_group_created',
      kind: 1500,
      pubkey: alicePubkey,
      created_at: 1753488000,
      tags: [['d', 'grp_self_recovery']],
      content: encryptedGroupPayload,
      sig: 'dummy_sig',
    };

    // --- SIMULATED ISOLATED BROWSER CONTEXT 2 (EMPTY DB) ---
    // DB 2 has zero data stored initially
    expect(await db.group_keys.count()).toBe(0);
    expect(await db.groups.count()).toBe(0);

    // 1. Context 2 receives NIP-59 Gift Wrap and unwraps self-recovery envelope
    const unwrapped = nip59GiftWrapService.decryptGiftWrap(giftWrapEvent, aliceSecretHex);
    expect(unwrapped).not.toBeNull();
    expect(unwrapped?.envelope.groupKey).toBe(groupKeyHex);

    // Context 2 persists recovered group key into its clean IndexedDB
    await db.group_keys.add({
      groupId: unwrapped!.envelope.groupId,
      keyVersion: unwrapped!.envelope.keyVersion,
      groupKeyHex: unwrapped!.envelope.groupKey,
      createdAt: unwrapped!.envelope.issuedAt,
    });
    expect(await db.group_keys.count()).toBe(1);

    // 2. Context 2 receives historical group event and decrypts using recovered key
    const recoveredKey = await db.group_keys.where({ groupId: 'grp_self_recovery' }).first();
    expect(recoveredKey).toBeDefined();

    const decryptedJson = await aesGcmCryptoService.decrypt(
      groupEvent.content,
      recoveredKey!.groupKeyHex
    );
    const decryptedPayload = JSON.parse(decryptedJson);

    // 3. Reconstruct group in Context 2
    const group = EventReducer.reduceGroup(decryptedPayload);
    expect(group.id).toBe('grp_self_recovery');
    expect(group.name).toBe('Vacation Trip');
  });
});
