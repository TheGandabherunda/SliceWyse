export const generateEncryptionKey = async (): Promise<CryptoKey> => {
  return await window.crypto.subtle.generateKey(
    {
      name: 'AES-GCM',
      length: 256,
    },
    true, // extractable
    ['encrypt', 'decrypt']
  );
};

export const exportKeyToURLSafeBase64 = async (key: CryptoKey): Promise<string> => {
  const exported = await window.crypto.subtle.exportKey('raw', key);
  const buffer = new Uint8Array(exported);
  const base64 = btoa(String.fromCharCode(...buffer));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export const importKeyFromURLSafeBase64 = async (base64: string): Promise<CryptoKey> => {
  let standardBase64 = base64.replace(/-/g, '+').replace(/_/g, '/');
  while (standardBase64.length % 4) {
    standardBase64 += '=';
  }
  const binary = atob(standardBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return await window.crypto.subtle.importKey(
    'raw',
    bytes,
    'AES-GCM',
    true,
    ['encrypt', 'decrypt']
  );
};

export const encryptData = async (data: any, key: CryptoKey): Promise<{ ciphertext: string; iv: string }> => {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(JSON.stringify(data));
  const ciphertextBuffer = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded
  );
  
  const ciphertextBytes = new Uint8Array(ciphertextBuffer);
  const ciphertextBase64 = btoa(String.fromCharCode(...ciphertextBytes));
  const ivBase64 = btoa(String.fromCharCode(...iv));
  
  return { ciphertext: ciphertextBase64, iv: ivBase64 };
};

export const decryptData = async (ciphertextBase64: string, ivBase64: string, key: CryptoKey): Promise<any> => {
  const ciphertextBytes = Uint8Array.from(atob(ciphertextBase64), c => c.charCodeAt(0));
  const ivBytes = Uint8Array.from(atob(ivBase64), c => c.charCodeAt(0));
  
  const decryptedBuffer = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivBytes },
    key,
    ciphertextBytes
  );
  
  const decodedString = new TextDecoder().decode(decryptedBuffer);
  return JSON.parse(decodedString);
};
