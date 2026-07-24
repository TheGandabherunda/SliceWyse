import { describe, it, expect } from 'vitest';
import { DebtSimplifier } from '../../src/domain/services/DebtSimplifier';
import { Expense } from '../../src/domain/entities/Expense';
import { Settlement } from '../../src/domain/entities/Settlement';
import { Money } from '../../src/domain/value-objects/Money';

describe('DebtSimplifier Domain Service', () => {
  const alice = '8234ab1111111111111111111111111111111111111111111111111111111111';
  const bob = '9182cd2222222222222222222222222222222222222222222222222222222222';
  const charlie = '7364ef3333333333333333333333333333333333333333333333333333333333';

  it('should compute net balances accurately for a 3-way equal split expense', () => {
    // Alice paid $90 for Alice, Bob, Charlie (equal split = $30 each)
    const expense = new Expense({
      id: 'exp_1',
      groupId: 'grp_1',
      title: 'Dinner',
      amount: new Money(9000, 'USD'),
      paidBy: [{ pubkey: alice, amount: new Money(9000, 'USD') }],
      splits: [
        { pubkey: alice, amount: new Money(3000, 'USD') },
        { pubkey: bob, amount: new Money(3000, 'USD') },
        { pubkey: charlie, amount: new Money(3000, 'USD') },
      ],
      splitType: 'EQUAL',
      date: Date.now(),
      createdBy: alice,
    });

    const netBalances = DebtSimplifier.calculateNetBalances([alice, bob, charlie], [expense], []);

    expect(netBalances.get(alice)?.amountCents).toBe(6000); // Alice is owed $60
    expect(netBalances.get(bob)?.amountCents).toBe(-3000); // Bob owes $30
    expect(netBalances.get(charlie)?.amountCents).toBe(-3000); // Charlie owes $30
  });

  it('should simplify complex circular debts into minimal direct transfers', () => {
    // Alice paid $90 split between Bob & Charlie ($45 each) -> Alice +90, Bob -45, Charlie -45
    // Bob paid $60 split between Alice & Charlie ($30 each) -> Bob +60-45=+15, Alice +90-30=+60, Charlie -45-30=-75
    const netBalances = new Map<string, Money>([
      [alice, new Money(6000, 'USD')],
      [bob, new Money(1500, 'USD')],
      [charlie, new Money(-7500, 'USD')],
    ]);

    const transfers = DebtSimplifier.simplifyDebts(netBalances, 'USD');

    // Charlie should pay Alice $60 and Bob $15
    expect(transfers).toHaveLength(2);
    expect(transfers).toContainEqual({
      from: charlie,
      to: alice,
      amount: new Money(6000, 'USD'),
    });
    expect(transfers).toContainEqual({
      from: charlie,
      to: bob,
      amount: new Money(1500, 'USD'),
    });
  });

  it('should account for settlements in net balances', () => {
    const expense = new Expense({
      id: 'exp_1',
      groupId: 'grp_1',
      title: 'Lunch',
      amount: new Money(4000, 'USD'),
      paidBy: [{ pubkey: alice, amount: new Money(4000, 'USD') }],
      splits: [
        { pubkey: alice, amount: new Money(2000, 'USD') },
        { pubkey: bob, amount: new Money(2000, 'USD') },
      ],
      splitType: 'EQUAL',
      date: Date.now(),
      createdBy: alice,
    });

    // Bob settles up $20 to Alice
    const settlement = new Settlement({
      id: 'set_1',
      groupId: 'grp_1',
      payer: bob,
      payee: alice,
      amount: new Money(2000, 'USD'),
      date: Date.now(),
      createdBy: bob,
    });

    const netBalances = DebtSimplifier.calculateNetBalances([alice, bob], [expense], [settlement]);

    expect(netBalances.get(alice)?.amountCents).toBe(0);
    expect(netBalances.get(bob)?.amountCents).toBe(0);

    const transfers = DebtSimplifier.simplifyDebts(netBalances);
    expect(transfers).toHaveLength(0);
  });
});
