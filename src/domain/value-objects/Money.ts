/**
 * Value Object representing monetary amounts stored as integer minor units (cents).
 * Ensures absolute precision and eliminates floating-point representation bugs.
 */
export class Money {
  readonly amountCents: number;
  readonly currency: string;

  constructor(amountCents: number, currency: string = 'USD') {
    if (!Number.isInteger(amountCents)) {
      throw new Error(`Monetary amount in cents must be an integer, received: ${amountCents}`);
    }
    this.amountCents = amountCents;
    this.currency = currency.toUpperCase();
  }

  static fromDecimal(amount: number, currency: string = 'USD'): Money {
    const cents = Math.round(amount * 100);
    return new Money(cents, currency);
  }

  static zero(currency: string = 'USD'): Money {
    return new Money(0, currency);
  }

  toDecimal(): number {
    return this.amountCents / 100;
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amountCents + other.amountCents, this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amountCents - other.amountCents, this.currency);
  }

  negate(): Money {
    return new Money(-this.amountCents, this.currency);
  }

  equals(other: Money): boolean {
    return this.amountCents === other.amountCents && this.currency === other.currency;
  }

  isZero(): boolean {
    return this.amountCents === 0;
  }

  isPositive(): boolean {
    return this.amountCents > 0;
  }

  isNegative(): boolean {
    return this.amountCents < 0;
  }

  /**
   * Distributes minor units equally among count recipients.
   * Handles odd splits deterministically by distributing remainder cents to initial recipients.
   */
  splitEqually(count: number): Money[] {
    if (count <= 0 || !Number.isInteger(count)) {
      throw new Error('Split count must be a positive integer');
    }

    const baseCents = Math.floor(this.amountCents / count);
    const remainder = this.amountCents - baseCents * count;

    const result: Money[] = [];
    for (let i = 0; i < count; i++) {
      const extra = i < remainder ? 1 : 0;
      result.push(new Money(baseCents + extra, this.currency));
    }
    return result;
  }

  format(locale: string = 'en-US'): string {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: this.currency,
    }).format(this.toDecimal());
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new Error(`Currency mismatch: ${this.currency} vs ${other.currency}`);
    }
  }
}
