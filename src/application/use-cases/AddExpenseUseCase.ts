import { Expense, type SplitType } from '../../domain/entities/Expense';
import { Money } from '../../domain/value-objects/Money';
import { identityService } from '../../infrastructure/identity/IdentityService';
import { DexieExpenseRepository } from '../../infrastructure/repositories/DexieExpenseRepository';
import { DexieGroupRepository } from '../../infrastructure/repositories/DexieGroupRepository';
import { syncCoordinator } from '../services/SyncCoordinator';

export interface AddExpenseInput {
  groupId: string;
  title: string;
  amountCents: number;
  currency?: string;
  paidByPubkey: string;
  participantPubkeys?: string[];
  splitType?: SplitType;
  exactSplits?: Record<string, number>; // pubkey -> amountCents if EXACT
  parentEventIds?: string[];
}

export class AddExpenseUseCase {
  constructor(
    private expenseRepo = new DexieExpenseRepository(),
    private groupRepo = new DexieGroupRepository()
  ) {}

  async execute(input: AddExpenseInput): Promise<Expense> {
    const currentIdentity = await identityService.getCurrentIdentity();
    if (!currentIdentity) {
      throw new Error('User identity required to create expense');
    }

    const currency = input.currency || 'USD';
    const totalMoney = new Money(input.amountCents, currency);
    const paidBy = [{ pubkey: input.paidByPubkey, amount: totalMoney }];

    const group = await this.groupRepo.getGroupById(input.groupId);
    const splitType = input.splitType || 'EQUAL';
    const participantPubkeys =
      input.participantPubkeys && input.participantPubkeys.length > 0
        ? input.participantPubkeys
        : (group?.members.map((m) => m.pubkey.value) ?? [input.paidByPubkey]);

    let splits: Array<{ pubkey: string; amount: Money }> = [];

    if (splitType === 'EQUAL') {
      const splitMoneys = totalMoney.splitEqually(participantPubkeys.length);
      splits = participantPubkeys.map((pubkey, i) => ({
        pubkey,
        amount: splitMoneys[i],
      }));
    } else if (splitType === 'EXACT') {
      if (!input.exactSplits) {
        throw new Error('Exact split allocations must be provided for EXACT split type');
      }
      splits = participantPubkeys.map((pubkey) => ({
        pubkey,
        amount: new Money(input.exactSplits?.[pubkey] ?? 0, currency),
      }));
    }

    const expenseId = `exp_${crypto.randomUUID().slice(0, 8)}`;
    const now = Date.now();

    // Construct Immutable Expense Event (Kind 1501)
    const expensePayload = {
      type: 'EXPENSE_CREATED',
      id: expenseId,
      expenseId,
      groupId: input.groupId,
      title: input.title,
      amountCents: totalMoney.amountCents,
      currency: totalMoney.currency,
      paidBy: paidBy.map((p) => ({ pubkey: p.pubkey, amountCents: p.amount.amountCents })),
      splits: splits.map((s) => ({ pubkey: s.pubkey, amountCents: s.amount.amountCents })),
      splitType: input.splitType ?? 'EQUAL',
      date: now,
      keyVersion: 1,
      parentEventIds: input.parentEventIds ?? [],
      createdBy: currentIdentity.pubkey,
    };

    // Submit Local Event via Unified Pipeline (ADR-005)
    // Validates -> Signs -> db.events -> EventReducer.reduceExpense() -> db.expenses -> db.sync_queue
    await syncCoordinator.submitLocalEvent({
      groupId: input.groupId,
      eventKind: 1501,
      unencryptedPayload: expensePayload,
      parentEventIds: input.parentEventIds ?? [],
      recipientPubkeys: input.participantPubkeys,
    });

    // Return canonical Expense projection populated by EventReducer
    const createdExpense = await this.expenseRepo.getExpenseById(expenseId);
    if (!createdExpense) {
      throw new Error(`Failed to initialize expense projection for ${expenseId}`);
    }

    return createdExpense;
  }
}
