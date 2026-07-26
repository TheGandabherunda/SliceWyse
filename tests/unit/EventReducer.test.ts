import { describe, expect, it } from 'vitest';
import { EventReducer } from '../../src/domain/services/EventReducer';
import type {
  GroupCreatedPayload,
  GroupUpdatedPayload,
  MembershipAddedPayload,
  MembershipRemovedPayload,
  ExpenseCreatedPayload,
  ExpenseUpdatedPayload,
  SettlementCreatedPayload,
} from '../../src/domain/events/EventSchemas';

describe('Milestone 4: Pure Event Reducers', () => {
  const alicePk = '01'.repeat(32);
  const bobPk = '02'.repeat(32);

  describe('Group Reductions', () => {
    it('purely reduces GROUP_CREATED payload into a Group entity', () => {
      const payload: GroupCreatedPayload = {
        type: 'GROUP_CREATED',
        groupId: 'grp_100',
        name: 'Camping Trip',
        currency: 'CAD',
        members: [
          { pubkey: alicePk, displayName: 'Alice', joinedAt: 1700000000 },
          { pubkey: bobPk, displayName: 'Bob', joinedAt: 1700000000 },
        ],
        keyVersion: 1,
        parentEventIds: [],
        createdAt: 1700000000,
      };

      const group = EventReducer.reduceGroup(payload);
      expect(group.id).toBe('grp_100');
      expect(group.name).toBe('Camping Trip');
      expect(group.currency).toBe('CAD');
      expect(group.members).toHaveLength(2);
      expect(group.createdAt).toBe(1700000000);
    });

    it('purely reduces GROUP_UPDATED payload onto an existing Group entity', () => {
      const initialPayload: GroupCreatedPayload = {
        type: 'GROUP_CREATED',
        groupId: 'grp_100',
        name: 'Old Name',
        currency: 'USD',
        members: [],
        keyVersion: 1,
        parentEventIds: [],
        createdAt: 1700000000,
      };

      const group = EventReducer.reduceGroup(initialPayload);

      const updatePayload: GroupUpdatedPayload = {
        type: 'GROUP_UPDATED',
        groupId: 'grp_100',
        name: 'New Name',
        currency: 'EUR',
        parentEventIds: ['evt_created'],
        updatedAt: 1700001000,
      };

      const updatedGroup = EventReducer.reduceGroupUpdate(group, updatePayload);
      expect(updatedGroup.name).toBe('New Name');
      expect(updatedGroup.currency).toBe('EUR');
      expect(updatedGroup.updatedAt).toBe(1700001000);
    });

    it('purely reduces MEMBERSHIP_ADDED and MEMBERSHIP_REMOVED payloads', () => {
      const initialPayload: GroupCreatedPayload = {
        type: 'GROUP_CREATED',
        groupId: 'grp_100',
        name: 'Beach Trip',
        currency: 'USD',
        members: [{ pubkey: alicePk, displayName: 'Alice', joinedAt: 1700000000 }],
        keyVersion: 1,
        parentEventIds: [],
        createdAt: 1700000000,
      };

      let group = EventReducer.reduceGroup(initialPayload);
      expect(group.members).toHaveLength(1);

      const addPayload: MembershipAddedPayload = {
        type: 'MEMBERSHIP_ADDED',
        groupId: 'grp_100',
        member: { pubkey: bobPk, displayName: 'Bob', joinedAt: 1700000500 },
        parentEventIds: [],
      };

      group = EventReducer.reduceMembershipAdd(group, addPayload);
      expect(group.members).toHaveLength(2);

      const removePayload: MembershipRemovedPayload = {
        type: 'MEMBERSHIP_REMOVED',
        groupId: 'grp_100',
        removedPubkey: alicePk,
        parentEventIds: [],
      };

      group = EventReducer.reduceMembershipRemove(group, removePayload);
      expect(group.members).toHaveLength(1);
      expect(group.members[0].pubkey.value).toBe(bobPk);
    });
  });

  describe('Expense Reductions', () => {
    it('purely reduces EXPENSE_CREATED and EXPENSE_UPDATED payloads', () => {
      const payload: ExpenseCreatedPayload = {
        type: 'EXPENSE_CREATED',
        id: 'exp_500',
        groupId: 'grp_100',
        title: 'Dinner',
        amountCents: 6000,
        currency: 'USD',
        paidBy: [{ pubkey: alicePk, amountCents: 6000 }],
        splits: [
          { pubkey: alicePk, amountCents: 3000 },
          { pubkey: bobPk, amountCents: 3000 },
        ],
        splitType: 'EQUAL',
        date: 1700000200,
        revision: 1,
        parentEventIds: [],
        isDeleted: false,
        createdBy: alicePk,
      };

      let expense = EventReducer.reduceExpense(payload);
      expect(expense.id).toBe('exp_500');
      expect(expense.amount.amountCents).toBe(6000);

      const updatePayload: ExpenseUpdatedPayload = {
        type: 'EXPENSE_UPDATED',
        id: 'exp_500',
        groupId: 'grp_100',
        title: 'Dinner & Drinks',
        amountCents: 8000,
        paidBy: [{ pubkey: alicePk, amountCents: 8000 }],
        splits: [
          { pubkey: alicePk, amountCents: 4000 },
          { pubkey: bobPk, amountCents: 4000 },
        ],
        revision: 2,
        parentEventIds: ['evt_exp_500_v1'],
      };

      expense = EventReducer.reduceExpenseUpdate(expense, updatePayload);
      expect(expense.title).toBe('Dinner & Drinks');
      expect(expense.amount.amountCents).toBe(8000);
      expect(expense.version).toBe(2);
    });
  });

  describe('Settlement Reductions', () => {
    it('purely reduces SETTLEMENT_CREATED payload', () => {
      const payload: SettlementCreatedPayload = {
        type: 'SETTLEMENT_CREATED',
        id: 'set_900',
        groupId: 'grp_100',
        payer: bobPk,
        payee: alicePk,
        amountCents: 3000,
        currency: 'USD',
        date: 1700000300,
        parentEventIds: [],
        createdBy: bobPk,
      };

      const settlement = EventReducer.reduceSettlement(payload);
      expect(settlement.id).toBe('set_900');
      expect(settlement.payer).toBe(bobPk);
      expect(settlement.amount.amountCents).toBe(3000);
    });
  });
});
