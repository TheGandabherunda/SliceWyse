import { describe, expect, it, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from '../../src/infrastructure/db/SliceWyseDatabase';
import { syncCoordinator } from '../../src/application/services/SyncCoordinator';
import { EventValidationPipeline } from '../../src/domain/services/EventValidationPipeline';
import { aesGcmCryptoService } from '../../src/infrastructure/crypto/AesGcmCryptoService';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';

describe('Milestone 5: Option B+ Epoch-Based Group Key Lifecycle', () => {
  const aliceSecretKey = generateSecretKey();
  const alicePubkey = getPublicKey(aliceSecretKey);

  beforeEach(async () => {
    await db.group_keys.clear();
    await db.events.clear();
    await db.sync_queue.clear();
  });

  it('rotateGroupKey() acts as sole authority incrementing keyVersions (1 -> 2 -> 3)', async () => {
    const groupId = 'grp_key_test_100';

    const keyV1 = await syncCoordinator.rotateGroupKey(groupId, [alicePubkey]);
    expect(keyV1.keyVersion).toBe(1);
    expect(keyV1.groupKeyHex).toHaveLength(64);

    const keyV2 = await syncCoordinator.rotateGroupKey(groupId, [alicePubkey]);
    expect(keyV2.keyVersion).toBe(2);

    const keyV3 = await syncCoordinator.rotateGroupKey(groupId, [alicePubkey]);
    expect(keyV3.keyVersion).toBe(3);

    const allKeys = await syncCoordinator.getAllGroupKeys(groupId);
    expect(allKeys).toHaveLength(3);
    expect(allKeys.map((k) => k.keyVersion)).toEqual([1, 2, 3]);

    const latest = await syncCoordinator.getLatestGroupKey(groupId);
    expect(latest?.keyVersion).toBe(3);
  });

  it('validates canonical ["k", "<keyVersion>"] tag for direct epoch lookup', async () => {
    const groupId = 'grp_key_test_200';
    const keyV1 = await syncCoordinator.rotateGroupKey(groupId, [alicePubkey]);
    const keyV2 = await syncCoordinator.rotateGroupKey(groupId, [alicePubkey]);

    // Encrypt payload under keyV2
    const payload = {
      type: 'EXPENSE_CREATED',
      id: 'exp_v2_1',
      groupId,
      title: 'Lunch',
      amountCents: 5000,
      currency: 'USD',
      paidBy: [{ pubkey: alicePubkey, amountCents: 5000 }],
      splits: [{ pubkey: alicePubkey, amountCents: 5000 }],
      splitType: 'EQUAL',
      date: 1700000000,
      revision: 1,
      parentEventIds: [],
      isDeleted: false,
      createdBy: alicePubkey,
    };

    const encryptedContent = await aesGcmCryptoService.encrypt(
      JSON.stringify(payload),
      keyV2.groupKeyHex
    );

    const eventWithKTag = finalizeEvent(
      {
        kind: 1501,
        created_at: 1700000000,
        tags: [
          ['d', groupId],
          ['k', '2'],
        ],
        content: encryptedContent,
      },
      aliceSecretKey
    );

    const result = await EventValidationPipeline.validateAndDecryptEvent(
      eventWithKTag,
      async (gId) => syncCoordinator.getAllGroupKeys(gId)
    );

    expect(result.isValid).toBe(true);
    expect(result.keyVersion).toBe(2);
    expect(result.payload.title).toBe('Lunch');
  });

  it('enforces forward secrecy: client with only V1 key cannot decrypt V2 event', async () => {
    const groupId = 'grp_key_test_300';
    const keyV1 = await syncCoordinator.rotateGroupKey(groupId, [alicePubkey]);

    // Generate V2 key separately (simulating member removed before V2 rotation)
    const v2KeyHex = aesGcmCryptoService.generateGroupKeyHex();

    const payload = {
      type: 'EXPENSE_CREATED',
      id: 'exp_v2_secret',
      groupId,
      title: 'Secret Dinner',
      amountCents: 10000,
      currency: 'USD',
      paidBy: [{ pubkey: alicePubkey, amountCents: 10000 }],
      splits: [{ pubkey: alicePubkey, amountCents: 10000 }],
      splitType: 'EQUAL',
      date: 1700000000,
      revision: 1,
      parentEventIds: [],
      isDeleted: false,
      createdBy: alicePubkey,
    };

    const encryptedV2Content = await aesGcmCryptoService.encrypt(JSON.stringify(payload), v2KeyHex);

    const eventV2 = finalizeEvent(
      {
        kind: 1501,
        created_at: 1700000000,
        tags: [
          ['d', groupId],
          ['k', '2'],
        ],
        content: encryptedV2Content,
      },
      aliceSecretKey
    );

    // Client only has keyV1 stored in DB
    const result = await EventValidationPipeline.validateAndDecryptEvent(eventV2, async (gId) => [
      keyV1,
    ]);

    expect(result.isValid).toBe(false);
    expect(result.error).toContain('Step 5 Failed');
  });

  it('supports backward historical decryption of V1 and V2 events by active member', async () => {
    const groupId = 'grp_key_test_400';
    const keyV1 = await syncCoordinator.rotateGroupKey(groupId, [alicePubkey]);

    // Create and encrypt V1 expense
    const payloadV1 = {
      type: 'EXPENSE_CREATED',
      id: 'exp_v1_hist',
      groupId,
      title: 'Old Expense V1',
      amountCents: 2000,
      currency: 'USD',
      paidBy: [{ pubkey: alicePubkey, amountCents: 2000 }],
      splits: [{ pubkey: alicePubkey, amountCents: 2000 }],
      splitType: 'EQUAL',
      date: 1700000000,
      revision: 1,
      parentEventIds: [],
      isDeleted: false,
      createdBy: alicePubkey,
    };

    const encryptedV1 = await aesGcmCryptoService.encrypt(
      JSON.stringify(payloadV1),
      keyV1.groupKeyHex
    );

    const eventV1 = finalizeEvent(
      {
        kind: 1501,
        created_at: 1700000000,
        tags: [
          ['d', groupId],
          ['k', '1'],
        ],
        content: encryptedV1,
      },
      aliceSecretKey
    );

    // Now rotate key to V2
    const keyV2 = await syncCoordinator.rotateGroupKey(groupId, [alicePubkey]);

    // Create and encrypt V2 expense
    const payloadV2 = {
      type: 'EXPENSE_CREATED',
      id: 'exp_v2_new',
      groupId,
      title: 'New Expense V2',
      amountCents: 4000,
      currency: 'USD',
      paidBy: [{ pubkey: alicePubkey, amountCents: 4000 }],
      splits: [{ pubkey: alicePubkey, amountCents: 4000 }],
      splitType: 'EQUAL',
      date: 1700000100,
      revision: 1,
      parentEventIds: [],
      isDeleted: false,
      createdBy: alicePubkey,
    };

    const encryptedV2 = await aesGcmCryptoService.encrypt(
      JSON.stringify(payloadV2),
      keyV2.groupKeyHex
    );

    const eventV2 = finalizeEvent(
      {
        kind: 1501,
        created_at: 1700000100,
        tags: [
          ['d', groupId],
          ['k', '2'],
        ],
        content: encryptedV2,
      },
      aliceSecretKey
    );

    const activeMemberKeys = await syncCoordinator.getAllGroupKeys(groupId);

    const resV1 = await EventValidationPipeline.validateAndDecryptEvent(
      eventV1,
      async () => activeMemberKeys
    );
    const resV2 = await EventValidationPipeline.validateAndDecryptEvent(
      eventV2,
      async () => activeMemberKeys
    );

    expect(resV1.isValid).toBe(true);
    expect(resV1.payload.title).toBe('Old Expense V1');
    expect(resV2.isValid).toBe(true);
    expect(resV2.payload.title).toBe('New Expense V2');
  });
});
