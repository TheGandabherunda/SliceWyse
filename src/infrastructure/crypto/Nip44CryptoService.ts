import * as nip44 from 'nostr-tools/nip44';
import { hexToBytes } from 'nostr-tools/utils';

export class Nip44CryptoService {
  /**
   * Generates a NIP-44 conversation key between a private key and a public key.
   */
  getConversationKey(secretKeyHex: string, recipientPubkeyHex: string): Uint8Array {
    const secretKeyBytes = hexToBytes(secretKeyHex);
    return nip44.v2.utils.getConversationKey(secretKeyBytes, recipientPubkeyHex);
  }

  /**
   * Encrypts plaintext string using NIP-44 v2 format.
   */
  encrypt(plaintext: string, conversationKey: Uint8Array): string {
    return nip44.v2.encrypt(plaintext, conversationKey);
  }

  /**
   * Decrypts NIP-44 v2 encrypted payload.
   */
  decrypt(ciphertext: string, conversationKey: Uint8Array): string {
    return nip44.v2.decrypt(ciphertext, conversationKey);
  }

  /**
   * Helper to encrypt a JSON serializable object.
   */
  encryptObject<T>(obj: T, conversationKey: Uint8Array): string {
    const json = JSON.stringify(obj);
    return this.encrypt(json, conversationKey);
  }

  /**
   * Helper to decrypt a JSON serializable object.
   */
  decryptObject<T>(ciphertext: string, conversationKey: Uint8Array): T {
    const json = this.decrypt(ciphertext, conversationKey);
    return JSON.parse(json) as T;
  }
}

export const nip44CryptoService = new Nip44CryptoService();
