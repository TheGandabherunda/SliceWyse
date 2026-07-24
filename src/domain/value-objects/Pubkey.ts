/**
 * Value Object for Nostr Public Key.
 * Represents a valid 64-character hex encoded public key.
 */
export class Pubkey {
  readonly value: string;

  constructor(value: string) {
    const cleaned = value.trim().toLowerCase();
    if (!Pubkey.isValidHex(cleaned)) {
      throw new Error(
        `Invalid Nostr public key hex: "${value}". Expected 64-character hex string.`
      );
    }
    this.value = cleaned;
  }

  static isValidHex(hex: string): boolean {
    return /^[0-9a-f]{64}$/i.test(hex);
  }

  equals(other: Pubkey): boolean {
    return this.value === other.value;
  }

  /**
   * Truncated view for UI rendering e.g. "8234...9182"
   */
  toShortString(): string {
    return `${this.value.slice(0, 6)}...${this.value.slice(-4)}`;
  }
}
