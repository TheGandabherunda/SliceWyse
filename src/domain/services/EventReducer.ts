import { Group } from '../entities/Group';
import { Member } from '../entities/Member';
import { Expense, type SplitType } from '../entities/Expense';
import { Settlement } from '../entities/Settlement';
import { Money } from '../value-objects/Money';
import { Pubkey } from '../value-objects/Pubkey';

export class EventReducer {
  static reduceGroup(payload: any): Group {
    const members = (payload.members ?? []).map(
      (m: any) =>
        new Member({
          pubkey: new Pubkey(typeof m === 'string' ? m : m.pubkey),
          displayName: typeof m === 'string' ? 'Member' : m.displayName,
          joinedAt: m.joinedAt ?? Date.now(),
        })
    );

    return new Group({
      id: payload.groupId,
      name: payload.name,
      currency: payload.currency ?? 'USD',
      members,
      createdAt: payload.createdAt ?? Date.now(),
      updatedAt: payload.createdAt ?? Date.now(),
    });
  }

  static reduceExpense(payload: any): Expense {
    const currency = payload.currency ?? 'USD';

    return new Expense({
      id: payload.expenseId,
      groupId: payload.groupId,
      title: payload.title,
      amount: new Money(payload.amountCents, currency),
      paidBy: (payload.paidBy ?? []).map((p: any) => ({
        pubkey: p.pubkey,
        amount: new Money(p.amountCents, currency),
      })),
      splits: (payload.splits ?? []).map((s: any) => ({
        pubkey: s.pubkey,
        amount: new Money(s.amountCents, currency),
      })),
      splitType: payload.splitType as SplitType,
      date: payload.date ?? Date.now(),
      version: payload.revision ?? 1,
      previousVersionId: payload.parentEventIds?.[0] ?? null,
      createdBy: payload.createdBy,
    });
  }

  static reduceSettlement(payload: any): Settlement {
    const currency = payload.currency ?? 'USD';

    return new Settlement({
      id: payload.settlementId,
      groupId: payload.groupId,
      payer: payload.payer,
      payee: payload.payee,
      amount: new Money(payload.amountCents, currency),
      date: payload.date ?? Date.now(),
      createdBy: payload.createdBy,
    });
  }
}
