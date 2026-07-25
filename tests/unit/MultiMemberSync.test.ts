import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { generateSecretKey, getPublicKey, type Event as NostrEvent } from 'nostr-tools/pure';
import { bytesToHex } from 'nostr-tools/utils';
import {
  nip59GiftWrapService,
  type GroupKeyEnvelope,
} from '../../src/infrastructure/crypto/Nip59GiftWrapService';
import { aesGcmCryptoService } from '../../src/infrastructure/crypto/AesGcmCryptoService';
import { EventReducer } from '../../src/domain/services/EventReducer';

describe('Multi-Member Cross-Device Sync & Key Recovery', () => {
  it("allows Alice and Bob to exchange group keys and decrypt each other's expenses", async () => {
    const aliceSecretBytes = generateSecretKey();
    const aliceSecretHex = bytesToHex(aliceSecretBytes);
    const alicePubkey = getPublicKey(aliceSecretBytes);

    const bobSecretBytes = generateSecretKey();
    const bobSecretHex = bytesToHex(bobSecretBytes);
    const bobPubkey = getPublicKey(bobSecretBytes);

    // 1. Alice creates Group & Group Key v1
    const groupKeyHex = aesGcmCryptoService.generateGroupKeyHex();
    const envelope: GroupKeyEnvelope = {
      protocolVersion: 1,
      groupId: 'grp_multi_member',
      keyVersion: 1,
      groupKey: groupKeyHex,
      issuedAt: 1753488000,
    };

    // Alice distributes NIP-59 key envelope to Bob
    const aliceToBobGiftWrap = nip59GiftWrapService.createGiftWrap(
      envelope,
      aliceSecretHex,
      bobPubkey
    );

    // Bob receives and decrypts key envelope
    const bobKeyResult = nip59GiftWrapService.decryptGiftWrap(aliceToBobGiftWrap, bobSecretHex);
    expect(bobKeyResult).not.toBeNull();
    expect(bobKeyResult?.senderPubkey).toBe(alicePubkey);
    expect(bobKeyResult?.envelope.groupKey).toBe(groupKeyHex);

    const bobRecoveredGroupKey = bobKeyResult!.envelope.groupKey;

    // 2. Alice creates an expense encrypted with groupKey
    const aliceExpensePayload = {
      type: 'EXPENSE_CREATED',
      groupId: 'grp_multi_member',
      expenseId: 'exp_alice_1',
      title: "Dinner at Mario's",
      amountCents: 6000,
      currency: 'USD',
      paidBy: [{ pubkey: alicePubkey, amountCents: 6000 }],
      splits: [
        { pubkey: alicePubkey, amountCents: 3000 },
        { pubkey: bobPubkey, amountCents: 3000 },
      ],
      splitType: 'EQUAL',
      date: 1753488100,
      keyVersion: 1,
      parentEventIds: [],
      createdBy: alicePubkey,
    };

    const aliceEncryptedContent = await aesGcmCryptoService.encrypt(
      JSON.stringify(aliceExpensePayload),
      groupKeyHex
    );

    // Bob decrypts Alice's expense using his recovered group key
    const decryptedAliceExpense = await aesGcmCryptoService.decrypt(
      aliceEncryptedContent,
      bobRecoveredGroupKey
    );
    const bobParsedAliceExpense = EventReducer.reduceExpense(JSON.parse(decryptedAliceExpense));
    expect(bobParsedAliceExpense.title).toBe("Dinner at Mario's");
    expect(bobParsedAliceExpense.amount.amountCents).toBe(6000);

    // 3. Bob creates an expense encrypted with groupKey
    const bobExpensePayload = {
      type: 'EXPENSE_CREATED',
      groupId: 'grp_multi_member',
      expenseId: 'exp_bob_1',
      title: 'Coffee and Drinks',
      amountCents: 2000,
      currency: 'USD',
      paidBy: [{ pubkey: bobPubkey, amountCents: 2000 }],
      splits: [
        { pubkey: alicePubkey, amountCents: 1000 },
        { pubkey: bobPubkey, amountCents: 1000 },
      ],
      splitType: 'EQUAL',
      date: 1753488200,
      keyVersion: 1,
      parentEventIds: ['exp_alice_1'],
      createdBy: bobPubkey,
    };

    const bobEncryptedContent = await aesGcmCryptoService.encrypt(
      JSON.stringify(bobExpensePayload),
      bobRecoveredGroupKey
    );

    // Alice decrypts Bob's expense using her group key
    const decryptedBobExpense = await aesGcmCryptoService.decrypt(bobEncryptedContent, groupKeyHex);
    const aliceParsedBobExpense = EventReducer.reduceExpense(JSON.parse(decryptedBobExpense));
    expect(aliceParsedBobExpense.title).toBe('Coffee and Drinks');
    expect(aliceParsedBobExpense.createdBy).toBe(bobPubkey);
  });
});
