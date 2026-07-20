import { describe, it, expect } from 'vitest';
import { computeBalances, simplifyDebts, type Expense } from './debt';

describe('Debt Simplification Engine', () => {
  it('should perfectly split an equal expense', () => {
    const expenses: Expense[] = [
      {
        id: '1',
        description: 'Dinner',
        amount: 90,
        paidBy: 'Alice',
        splitMethod: 'EQUAL',
        splits: [
          { userId: 'Alice', amountOrPercent: 0 },
          { userId: 'Bob', amountOrPercent: 0 },
          { userId: 'Charlie', amountOrPercent: 0 }
        ],
        date: Date.now()
      }
    ];

    const balances = computeBalances(expenses);
    expect(balances['Alice']).toBe(60); // Paid 90, owes 30, net +60
    expect(balances['Bob']).toBe(-30);
    expect(balances['Charlie']).toBe(-30);

    const debts = simplifyDebts(balances);
    expect(debts.length).toBe(2);
    expect(debts.find(d => d.from === 'Bob' && d.to === 'Alice')?.amount).toBe(30);
    expect(debts.find(d => d.from === 'Charlie' && d.to === 'Alice')?.amount).toBe(30);
  });

  it('should deterministically simplify circular debts', () => {
    // A owes B 10, B owes C 10 -> A owes C 10
    const balances = {
      'A': -10,
      'B': 0, // A gave B 10, but B gave C 10, so B is 0
      'C': 10
    };

    const debts = simplifyDebts(balances);
    expect(debts.length).toBe(1);
    expect(debts[0]).toEqual({ from: 'A', to: 'C', amount: 10 });
  });
});
