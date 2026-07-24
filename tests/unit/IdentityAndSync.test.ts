import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { bytesToHex } from 'nostr-tools/utils';
import { generateSecretKey, getPublicKey, type Event as NostrEvent } from 'nostr-tools/pure';
import { db } from '../../src/infrastructure/db/SliceWyseDatabase';
import { identityService } from '../../src/infrastructure/identity/IdentityService';
import { relayManager } from '../../src/infrastructure/nostr/RelayManager';
import { SyncCoordinator } from '../../src/application/services/SyncCoordinator';

describe('identity profile refresh', () => {
  beforeEach(async () => {
    await db.identities.clear();
    await db.members.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('replaces an imported fallback with Kind 0 metadata and updates local members', async () => {
    let onEvent: ((event: NostrEvent) => void) | undefined;
    vi.spyOn(relayManager, 'subscribe').mockImplementation((_filters, callback) => {
      onEvent = callback;
      return () => undefined;
    });

    const identity = await identityService.importSecretKey(bytesToHex(generateSecretKey()), '');
    await db.members.add({
      groupId: 'grp_profile',
      pubkey: identity.pubkey,
      displayName: identity.displayName,
      joinedAt: Date.now(),
    });

    const listener = vi.fn();
    const unsubscribe = identityService.onIdentityChange(listener);
    onEvent?.({ content: JSON.stringify({ display_name: 'Nostr Alice' }) } as NostrEvent);

    await vi.waitFor(async () => {
      expect((await db.identities.get(identity.pubkey))?.displayName).toBe('Nostr Alice');
    });

    expect((await db.members.where({ groupId: 'grp_profile' }).first())?.displayName).toBe(
      'Nostr Alice'
    );
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ displayName: 'Nostr Alice' }));
    unsubscribe();
  });

  it('does not replace an explicitly supplied import name with profile metadata', async () => {
    const subscribe = vi.spyOn(relayManager, 'subscribe');
    const identity = await identityService.importSecretKey(bytesToHex(generateSecretKey()), 'Chosen Name');

    expect((await db.identities.get(identity.pubkey))?.displayName).toBe('Chosen Name');
    expect(subscribe).not.toHaveBeenCalled();
  });
});

describe('encrypted sync envelopes', () => {
  beforeEach(async () => {
    await db.identities.clear();
  });

  it('encrypts for the author and group members, allowing another session of the author to read it', async () => {
    const aliceSecretKey = generateSecretKey();
    const matchingAlicePubkey = getPublicKey(aliceSecretKey);
    const bobSecretKey = generateSecretKey();
    const bobPubkey = getPublicKey(bobSecretKey);

    await db.identities.put({
      pubkey: matchingAlicePubkey,
      secretKey: bytesToHex(aliceSecretKey),
      displayName: 'Alice',
      hasCustomDisplayName: true,
      isExtension: false,
      isCurrent: 1,
      createdAt: Date.now(),
    });

    const coordinator = new SyncCoordinator();
    const internal = coordinator as unknown as {
      encryptForRecipients(payload: string, recipients: string[]): Promise<string>;
      decryptEventPayload(content: string, author: string): Promise<Record<string, unknown> | null>;
    };
    const payload = JSON.stringify({ groupId: 'grp_private', title: 'Private dinner', amountCents: 4200 });
    const envelope = await internal.encryptForRecipients(payload, [bobPubkey]);

    expect(envelope).not.toContain('Private dinner');
    expect(envelope).toContain(matchingAlicePubkey);
    expect(envelope).toContain(bobPubkey);

    // A fresh IndexedDB session for the same key can decrypt the self-recipient envelope.
    const asAliceAgain = await internal.decryptEventPayload(envelope, matchingAlicePubkey);
    expect(asAliceAgain).toEqual(JSON.parse(payload));

    await db.identities.update(matchingAlicePubkey, { isCurrent: 0 });
    await db.identities.put({
      pubkey: bobPubkey,
      secretKey: bytesToHex(bobSecretKey),
      displayName: 'Bob',
      hasCustomDisplayName: true,
      isExtension: false,
      isCurrent: 1,
      createdAt: Date.now(),
    });
    expect(await internal.decryptEventPayload(envelope, matchingAlicePubkey)).toEqual(JSON.parse(payload));
  });

  it('continues to read legacy plaintext payloads published by earlier versions', async () => {
    const secretKey = generateSecretKey();
    const pubkey = getPublicKey(secretKey);
    await db.identities.put({
      pubkey,
      secretKey: bytesToHex(secretKey),
      displayName: 'Alice',
      hasCustomDisplayName: true,
      isExtension: false,
      isCurrent: 1,
      createdAt: Date.now(),
    });

    const coordinator = new SyncCoordinator() as unknown as {
      decryptEventPayload(content: string, author: string): Promise<Record<string, unknown> | null>;
    };
    expect(await coordinator.decryptEventPayload('{"groupId":"legacy"}', pubkey)).toEqual({
      groupId: 'legacy',
    });
  });
});
