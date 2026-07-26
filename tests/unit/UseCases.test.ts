import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from '../../src/infrastructure/db/SliceWyseDatabase';
import { identityService } from '../../src/infrastructure/identity/IdentityService';
import { syncCoordinator } from '../../src/application/services/SyncCoordinator';
import { CreateGroupUseCase } from '../../src/application/use-cases/CreateGroupUseCase';
import { CreateInviteLinkUseCase } from '../../src/application/use-cases/CreateInviteLinkUseCase';
import { AcceptInviteLinkUseCase } from '../../src/application/use-cases/AcceptInviteLinkUseCase';
import { AddExpenseUseCase } from '../../src/application/use-cases/AddExpenseUseCase';
import { SettleUpUseCase } from '../../src/application/use-cases/SettleUpUseCase';
import { DebtSimplifier } from '../../src/domain/services/DebtSimplifier';
import { DexieGroupRepository } from '../../src/infrastructure/repositories/DexieGroupRepository';
import { DexieExpenseRepository } from '../../src/infrastructure/repositories/DexieExpenseRepository';
import { DexieSettlementRepository } from '../../src/infrastructure/repositories/DexieSettlementRepository';
import { aesGcmCryptoService } from '../../src/infrastructure/crypto/AesGcmCryptoService';

describe('Application Use Cases Integration Tests', () => {
  const createGroup = new CreateGroupUseCase();
  const createInviteLink = new CreateInviteLinkUseCase();
  const acceptInviteLink = new AcceptInviteLinkUseCase();
  const addExpense = new AddExpenseUseCase();
  const settleUp = new SettleUpUseCase();

  const groupRepo = new DexieGroupRepository();
  const expenseRepo = new DexieExpenseRepository();
  const settlementRepo = new DexieSettlementRepository();

  const bobPubkey = '9182cd2222222222222222222222222222222222222222222222222222222222';
  const bobSecretHex = '0101010101010101010101010101010101010101010101010101010101010101';

  beforeEach(async () => {
    vi.spyOn(syncCoordinator, 'processSyncQueue').mockResolvedValue(undefined);

    await db.identities.clear();
    await db.groups.clear();
    await db.members.clear();
    await db.expenses.clear();
    await db.settlements.clear();

    await identityService.generateIdentity('Alice');
  });

  it('should create group, invite & join member, add expense, and simplify debt', async () => {
    // 1. Create Group
    const group = await createGroup.execute({ name: 'Roadtrip', currency: 'USD' });
    const alicePubkey = group.members[0].pubkey.value;

    // 2. Generate Invitation Link
    const inviteResult = await createInviteLink.execute({ groupId: group.id });
    expect(inviteResult.inviteUrl).toContain('#/join?groupId=');

    // 3. Bob accepts Invitation Link
    const rawPayload = {
      type: 'GROUP_INVITATION',
      groupId: group.id,
      groupName: 'Roadtrip',
      currency: 'USD',
      inviterPubkey: alicePubkey,
      groupKeyHex: aesGcmCryptoService.generateGroupKeyHex(),
      keyVersion: 1,
      createdAt: Date.now(),
    };

    const encrypted = await aesGcmCryptoService.encrypt(
      JSON.stringify(rawPayload),
      inviteResult.invKeyHex
    );

    // Switch active identity to Bob to simulate second client device
    await db.identities.clear();
    await db.identities.add({
      pubkey: bobPubkey,
      secretKey: bobSecretHex,
      displayName: 'Bob',
      isCurrent: 1,
      createdAt: Date.now(),
    });

    await acceptInviteLink.execute({
      groupId: group.id,
      invKeyHex: inviteResult.invKeyHex,
      encryptedEventContent: encrypted,
    });

    // 4. Alice pays $100 for Alice & Bob
    await addExpense.execute({
      groupId: group.id,
      title: 'Gas',
      amountCents: 10000,
      currency: 'USD',
      paidByPubkey: alicePubkey,
      participantPubkeys: [alicePubkey, bobPubkey],
      splitType: 'EQUAL',
    });

    // 4. Verify balances
    const expenses = await expenseRepo.getExpensesByGroupId(group.id);
    const settlements = await settlementRepo.getSettlementsByGroupId(group.id);
    const updatedGroup = await groupRepo.getGroupById(group.id);

    const memberPubkeys = updatedGroup!.members.map((m) => m.pubkey.value);
    const netBalances = DebtSimplifier.calculateNetBalances(memberPubkeys, expenses, settlements);

    expect(netBalances.get(alicePubkey)?.amountCents).toBe(5000); // Alice owed $50
    expect(netBalances.get(bobPubkey)?.amountCents).toBe(-5000); // Bob owes $50

    // 5. Bob settles up $50
    await settleUp.execute({
      groupId: group.id,
      payerPubkey: bobPubkey,
      payeePubkey: alicePubkey,
      amountCents: 5000,
      currency: 'USD',
    });

    const updatedSettlements = await settlementRepo.getSettlementsByGroupId(group.id);
    const finalBalances = DebtSimplifier.calculateNetBalances(
      memberPubkeys,
      expenses,
      updatedSettlements
    );

    expect(finalBalances.get(alicePubkey)?.amountCents).toBe(0);
    expect(finalBalances.get(bobPubkey)?.amountCents).toBe(0);
  }, 15000);
});
