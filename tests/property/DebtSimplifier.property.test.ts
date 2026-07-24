import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { DebtSimplifier } from '../../src/domain/services/DebtSimplifier';
import { Money } from '../../src/domain/value-objects/Money';

describe('DebtSimplifier Invariant Property Tests', () => {
  it('Property: Net balances must ALWAYS sum to zero for any random balance map', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: -100000, max: 100000 }), { minLength: 2, maxLength: 10 }),
        (rawBalances) => {
          // Ensure zero sum by adjusting the last element
          const sumExceptLast = rawBalances.slice(0, -1).reduce((a, b) => a + b, 0);
          const adjustedBalances = [...rawBalances.slice(0, -1), -sumExceptLast];

          const netBalancesMap = new Map<string, Money>();
          adjustedBalances.forEach((cents, index) => {
            netBalancesMap.set(`user_${index}`, new Money(cents, 'USD'));
          });

          // Check that sum is zero
          let totalSum = 0;
          for (const money of netBalancesMap.values()) {
            totalSum += money.amountCents;
          }
          expect(totalSum).toBe(0);

          // Run debt simplification
          const transfers = DebtSimplifier.simplifyDebts(netBalancesMap, 'USD');

          // Check invariant 2: apply transfers to balances, verify all final balances are zero
          const postTransferBalances = new Map(
            adjustedBalances.map((cents, idx) => [`user_${idx}`, cents])
          );

          for (const transfer of transfers) {
            const debtorCurrent = postTransferBalances.get(transfer.from)!;
            const creditorCurrent = postTransferBalances.get(transfer.to)!;

            postTransferBalances.set(transfer.from, debtorCurrent + transfer.amount.amountCents);
            postTransferBalances.set(transfer.to, creditorCurrent - transfer.amount.amountCents);
          }

          for (const [, finalCents] of postTransferBalances.entries()) {
            expect(Math.abs(finalCents)).toBe(0);
          }
        }
      ),
      { numRuns: 1000 }
    );
  });
});
