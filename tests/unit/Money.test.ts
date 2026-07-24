import { describe, it, expect } from 'vitest';
import { Money } from '../../src/domain/value-objects/Money';

describe('Money Value Object', () => {
  it('should store monetary amounts in minor units (cents)', () => {
    const money = new Money(1050, 'USD');
    expect(money.amountCents).toBe(1050);
    expect(money.toDecimal()).toBe(10.5);
  });

  it('should create from decimal safely', () => {
    const money = Money.fromDecimal(19.99, 'USD');
    expect(money.amountCents).toBe(1999);
  });

  it('should add and subtract with exact precision', () => {
    const m1 = new Money(1000, 'USD');
    const m2 = new Money(550, 'USD');
    expect(m1.add(m2).amountCents).toBe(1550);
    expect(m1.subtract(m2).amountCents).toBe(450);
  });

  it('should throw when operating across different currencies', () => {
    const usd = new Money(1000, 'USD');
    const eur = new Money(1000, 'EUR');
    expect(() => usd.add(eur)).toThrow(/Currency mismatch/);
  });

  it('should split odd cents deterministically without losing pennies', () => {
    const total = new Money(100, 'USD'); // $1.00 split among 3 people
    const splits = total.splitEqually(3);

    expect(splits).toHaveLength(3);
    expect(splits[0].amountCents).toBe(34);
    expect(splits[1].amountCents).toBe(33);
    expect(splits[2].amountCents).toBe(33);

    const sum = splits.reduce((acc, current) => acc + current.amountCents, 0);
    expect(sum).toBe(100);
  });
});
