import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { bytesToHex } from 'nostr-tools/utils';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { db } from '../../src/infrastructure/db/SliceWyseDatabase';
import { identityService } from '../../src/infrastructure/identity/IdentityService';

describe('Identity Profile Hydration Tests', () => {
  beforeEach(async () => {
    await db.identities.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('hydrates profile metadata during nsec import and sets display_name', async () => {
    vi.spyOn(identityService, 'hydrateProfile').mockResolvedValue('Alice Nostr');
    const secretHex = bytesToHex(generateSecretKey());

    const identity = await identityService.importSecretKey(secretHex, '');
    expect(identity.displayName).toBe('Alice Nostr');
    expect((await db.identities.get(identity.pubkey))?.displayName).toBe('Alice Nostr');
  });

  it('falls back gracefully to shortened npub if Kind 0 lookup fails or times out', async () => {
    vi.spyOn(identityService, 'hydrateProfile').mockResolvedValue(null);
    const secretHex = bytesToHex(generateSecretKey());

    const identity = await identityService.importSecretKey(secretHex, '');
    expect(identity.displayName).toMatch(/^npub1/);
  });

  it('preserves explicitly user-supplied display name during import without overwriting', async () => {
    const hydrateSpy = vi.spyOn(identityService, 'hydrateProfile');
    const secretHex = bytesToHex(generateSecretKey());

    const identity = await identityService.importSecretKey(secretHex, 'Explicit Custom Name');
    expect(identity.displayName).toBe('Explicit Custom Name');
    expect(hydrateSpy).not.toHaveBeenCalled();
  });
});
