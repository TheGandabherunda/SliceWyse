import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { bytesToHex } from 'nostr-tools/utils';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { db } from '../../src/infrastructure/db/SliceWyseDatabase';
import { identityService } from '../../src/infrastructure/identity/IdentityService';
import { relayManager } from '../../src/infrastructure/nostr/RelayManager';
import { aesGcmCryptoService } from '../../src/infrastructure/crypto/AesGcmCryptoService';

describe('identity profile refresh', () => {
  beforeEach(async () => {
    await db.identities.clear();
    await db.members.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('hydrates profile metadata during import and updates local display name', async () => {
    const pubkeyHex = getPublicKey(generateSecretKey());
    vi.spyOn(identityService, 'hydrateProfile').mockResolvedValue('Nostr Alice');

    const identity = await identityService.importSecretKey(bytesToHex(generateSecretKey()), '');
    expect(identity.displayName).toBe('Nostr Alice');
  });

  it('does not replace an explicitly supplied import name with profile metadata', async () => {
    const hydrateSpy = vi.spyOn(identityService, 'hydrateProfile');
    const identity = await identityService.importSecretKey(
      bytesToHex(generateSecretKey()),
      'Chosen Name'
    );

    expect((await db.identities.get(identity.pubkey))?.displayName).toBe('Chosen Name');
    expect(hydrateSpy).not.toHaveBeenCalled();
  });
});

describe('encrypted sync payloads', () => {
  beforeEach(async () => {
    await db.identities.clear();
  });

  it('encrypts and decrypts shared group data using AES-256-GCM', async () => {
    const groupKeyHex = aesGcmCryptoService.generateGroupKeyHex();
    const payload = JSON.stringify({
      groupId: 'grp_private',
      title: 'Private dinner',
      amountCents: 4200,
    });

    const ciphertext = await aesGcmCryptoService.encrypt(payload, groupKeyHex);
    expect(ciphertext).not.toContain('Private dinner');

    const decrypted = await aesGcmCryptoService.decrypt(ciphertext, groupKeyHex);
    expect(JSON.parse(decrypted)).toEqual(JSON.parse(payload));
  });
});
