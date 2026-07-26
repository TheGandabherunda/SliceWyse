import { Group } from '../entities/Group';
import { Member } from '../entities/Member';
import { Expense, type SplitType } from '../entities/Expense';
import { Settlement } from '../entities/Settlement';
import { Money } from '../value-objects/Money';
import { Pubkey } from '../value-objects/Pubkey';
import type {
  GroupCreatedPayload,
  GroupUpdatedPayload,
  MembershipAddedPayload,
  MembershipRemovedPayload,
  ExpenseCreatedPayload,
  ExpenseUpdatedPayload,
  SettlementCreatedPayload,
} from '../events/EventSchemas';

export class EventReducer {
  /**
   * Pure reduction of GROUP_CREATED payload into a Group entity.
   */
  static reduceGroup(payload: GroupCreatedPayload): Group {
    const createdAt = payload.createdAt ?? 0;
    const members = (payload.members ?? []).map(
      (m: any) =>
        new Member({
          pubkey: new Pubkey(typeof m === 'string' ? m : m.pubkey),
          displayName: typeof m === 'string' ? 'Member' : m.displayName,
          joinedAt: typeof m === 'string' ? createdAt : (m.joinedAt ?? createdAt),
        })
    );

    return new Group({
      id: payload.groupId,
      name: payload.name,
      currency: payload.currency ?? 'USD',
      members,
      createdAt,
      updatedAt: createdAt,
    });
  }

  /**
   * Pure reduction of GROUP_UPDATED payload onto an existing Group entity.
   */
  static reduceGroupUpdate(currentGroup: Group, payload: GroupUpdatedPayload): Group {
    return new Group({
      id: currentGroup.id,
      name: payload.name ?? currentGroup.name,
      currency: payload.currency ?? currentGroup.currency,
      members: [...currentGroup.members],
      createdAt: currentGroup.createdAt,
      updatedAt: payload.updatedAt ?? currentGroup.updatedAt,
    });
  }

  /**
   * Pure reduction of MEMBERSHIP_ADDED payload onto an existing Group entity.
   */
  static reduceMembershipAdd(currentGroup: Group, payload: MembershipAddedPayload): Group {
    const newMember = new Member({
      pubkey: new Pubkey(payload.member.pubkey),
      displayName: payload.member.displayName,
      joinedAt: payload.member.joinedAt ?? currentGroup.updatedAt,
    });

    const updatedMembers = [
      ...currentGroup.members.filter((m) => !m.pubkey.equals(newMember.pubkey)),
      newMember,
    ];

    return new Group({
      id: currentGroup.id,
      name: currentGroup.name,
      currency: currentGroup.currency,
      members: updatedMembers,
      createdAt: currentGroup.createdAt,
      updatedAt: payload.member.joinedAt ?? currentGroup.updatedAt,
    });
  }

  /**
   * Pure reduction of MEMBERSHIP_REMOVED payload onto an existing Group entity.
   */
  static reduceMembershipRemove(currentGroup: Group, payload: MembershipRemovedPayload): Group {
    const targetPubkeyHex = payload.removedPubkey;
    const updatedMembers = currentGroup.members.filter((m) => m.pubkey.value !== targetPubkeyHex);

    return new Group({
      id: currentGroup.id,
      name: currentGroup.name,
      currency: currentGroup.currency,
      members: updatedMembers,
      createdAt: currentGroup.createdAt,
      updatedAt: currentGroup.updatedAt,
    });
  }

  /**
   * Pure reduction of EXPENSE_CREATED payload into an Expense entity.
   */
  static reduceExpense(payload: ExpenseCreatedPayload): Expense {
    const currency = payload.currency ?? 'USD';
    const expenseId = payload.id ?? (payload as any).expenseId;
    const date = payload.date ?? 0;

    return new Expense({
      id: expenseId,
      groupId: payload.groupId,
      title: payload.title,
      amount: new Money(payload.amountCents, currency),
      paidBy: (payload.paidBy ?? []).map((p) => ({
        pubkey: p.pubkey,
        amount: new Money(p.amountCents, currency),
      })),
      splits: (payload.splits ?? []).map((s) => ({
        pubkey: s.pubkey,
        amount: new Money(s.amountCents, currency),
      })),
      splitType: payload.splitType as SplitType,
      date,
      version: payload.revision ?? 1,
      previousVersionId: payload.parentEventIds?.[0] ?? null,
      createdBy: payload.createdBy,
    });
  }

  /**
   * Pure reduction of EXPENSE_UPDATED payload onto an existing Expense entity.
   */
  static reduceExpenseUpdate(currentExpense: Expense, payload: ExpenseUpdatedPayload): Expense {
    const currency = payload.currency ?? currentExpense.amount.currency;
    const amountCents = payload.amountCents ?? currentExpense.amount.amountCents;
    const totalMoney = new Money(amountCents, currency);

    const paidBy = payload.paidBy
      ? payload.paidBy.map((p) => ({
          pubkey: p.pubkey,
          amount: new Money(p.amountCents, currency),
        }))
      : [
          {
            pubkey: currentExpense.paidBy[0]?.pubkey || currentExpense.createdBy,
            amount: totalMoney,
          },
        ];

    const splitType = (payload.splitType as SplitType) || currentExpense.splitType;
    let splits: Array<{ pubkey: string; amount: Money }> = [];

    if (payload.splits) {
      splits = payload.splits.map((s) => ({
        pubkey: s.pubkey,
        amount: new Money(s.amountCents, currency),
      }));
    } else if (splitType === 'EQUAL') {
      const splitMoneys = totalMoney.splitEqually(currentExpense.splits.length);
      splits = currentExpense.splits.map((s, i) => ({
        pubkey: s.pubkey,
        amount: splitMoneys[i],
      }));
    } else {
      splits = currentExpense.splits.map((s) => ({
        pubkey: s.pubkey,
        amount: new Money(s.amount.amountCents, currency),
      }));
    }

    return new Expense({
      id: currentExpense.id,
      groupId: currentExpense.groupId,
      title: payload.title ?? currentExpense.title,
      amount: totalMoney,
      paidBy,
      splits,
      splitType,
      date: currentExpense.date,
      version: payload.revision ?? currentExpense.version + 1,
      previousVersionId: payload.parentEventIds?.[0] ?? currentExpense.previousVersionId,
      createdBy: currentExpense.createdBy,
    });
  }

  /**
   * Pure reduction of EXPENSE_DELETED payload onto an existing Expense entity.
   */
  static reduceExpenseDelete(currentExpense: Expense, payload: any): Expense {
    return new Expense({
      id: currentExpense.id,
      groupId: currentExpense.groupId,
      title: currentExpense.title,
      amount: currentExpense.amount,
      paidBy: [...currentExpense.paidBy],
      splits: [...currentExpense.splits],
      splitType: currentExpense.splitType,
      date: currentExpense.date,
      version: currentExpense.version + 1,
      previousVersionId: payload.parentEventIds?.[0] ?? currentExpense.previousVersionId,
      isDeleted: true,
      createdBy: currentExpense.createdBy,
    });
  }

  /**
   * Pure reduction of SETTLEMENT_CREATED payload into a Settlement entity.
   */
  static reduceSettlement(payload: SettlementCreatedPayload): Settlement {
    const currency = payload.currency ?? 'USD';
    const settlementId = payload.id ?? (payload as any).settlementId;
    const date = payload.date ?? 0;

    return new Settlement({
      id: settlementId,
      groupId: payload.groupId,
      payer: payload.payer,
      payee: payload.payee,
      amount: new Money(payload.amountCents, currency),
      date,
      createdBy: payload.createdBy,
    });
  }

  /**
   * Pure reduction of SETTLEMENT_DELETED payload onto an existing Settlement entity.
   */
  static reduceSettlementDelete(currentSettlement: Settlement, payload: any): Settlement {
    return new Settlement({
      id: currentSettlement.id,
      groupId: currentSettlement.groupId,
      payer: currentSettlement.payer,
      payee: currentSettlement.payee,
      amount: currentSettlement.amount,
      date: currentSettlement.date,
      isDeleted: true,
      createdBy: currentSettlement.createdBy,
    });
  }
}
