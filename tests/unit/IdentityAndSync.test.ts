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

describe('identity export functionality', () => {
  beforeEach(async () => {
    await db.identities.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exports secret key in NIP-19 nsec format for local identities', async () => {
    const secretKeyBytes = generateSecretKey();
    const secretKeyHex = bytesToHex(secretKeyBytes);
    await identityService.importSecretKey(secretKeyHex, 'Alice');

    const exportedNsec = await identityService.exportSecretKeyNsec();
    expect(exportedNsec).toBeDefined();
    expect(exportedNsec).toMatch(/^nsec1[a-z0-9]+$/);
  });

  it('returns null when exporting secret key for extension-based identity', async () => {
    vi.spyOn(identityService, 'hydrateProfile').mockResolvedValue('Ext User');

    (globalThis as any).window = {
      nostr: {
        getPublicKey: async () =>
          '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
        signEvent: async (evt: any) => evt,
      },
    };

    await identityService.connectExtension('Ext User');
    const exportedNsec = await identityService.exportSecretKeyNsec();
    expect(exportedNsec).toBeNull();
  });
});
