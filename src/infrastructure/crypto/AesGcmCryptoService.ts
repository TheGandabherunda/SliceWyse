import { bytesToHex, hexToBytes } from 'nostr-tools/utils';

export class AesGcmCryptoService {
  generateGroupKey(): Uint8Array {
    const key = new Uint8Array(32);
    crypto.getRandomValues(key);
    return key;
  }

  generateGroupKeyHex(): string {
    return bytesToHex(this.generateGroupKey());
  }

  async encrypt(plaintext: string, groupKeyHex: string): Promise<string> {
    const keyBytes = hexToBytes(groupKeyHex);
    const keyBuffer = new Uint8Array(keyBytes).buffer;

    const cryptoKey = await crypto.subtle.importKey('raw', keyBuffer, { name: 'AES-GCM' }, false, [
      'encrypt',
    ]);

    const iv = new Uint8Array(12);
    crypto.getRandomValues(iv);

    const encoder = new TextEncoder();
    const encodedPlaintext = encoder.encode(plaintext);

    const encryptedBuffer = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      encodedPlaintext
    );

    const ivBase64 = this.arrayBufferToBase64(iv.buffer);
    const ciphertextBase64 = this.arrayBufferToBase64(encryptedBuffer);

    return `${ivBase64}:${ciphertextBase64}`;
  }

  async decrypt(payload: string, groupKeyHex: string): Promise<string> {
    const parts = payload.split(':');
    if (parts.length !== 2) {
      throw new Error('Invalid AES-GCM payload format. Expected base64(iv):base64(ciphertext)');
    }

    const iv = new Uint8Array(this.base64ToArrayBuffer(parts[0]));
    const ciphertext = this.base64ToArrayBuffer(parts[1]);
    const keyBytes = hexToBytes(groupKeyHex);
    const keyBuffer = new Uint8Array(keyBytes).buffer;

    const cryptoKey = await crypto.subtle.importKey('raw', keyBuffer, { name: 'AES-GCM' }, false, [
      'decrypt',
    ]);

    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      ciphertext
    );

    const decoder = new TextDecoder();
    return decoder.decode(decryptedBuffer);
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }
}

export const aesGcmCryptoService = new AesGcmCryptoService();
