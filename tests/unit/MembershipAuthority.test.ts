import { describe, it, expect } from 'vitest';
import { eventDagService, type DagNode } from '../../src/domain/services/EventDagService';

describe('MembershipAuthority & Key Rotation Rules', () => {
  it('handles concurrent member additions cleanly', () => {
    const groupCreated: DagNode = {
      eventId: 'evt_g1',
      kind: 1500,
      pubkey: 'pubkey_alice',
      createdAt: 1000,
      groupId: 'grp_1',
      parentEventIds: [],
      payload: { type: 'GROUP_CREATED', name: 'Trip', members: [{ pubkey: 'pubkey_alice' }] },
    };

    const addBob: DagNode = {
      eventId: 'evt_m1',
      kind: 1503,
      pubkey: 'pubkey_alice',
      createdAt: 1010,
      groupId: 'grp_1',
      parentEventIds: ['evt_g1'],
      payload: { type: 'MEMBER_ADDED', targetPubkey: 'pubkey_bob' },
    };

    const addCharlie: DagNode = {
      eventId: 'evt_m2',
      kind: 1503,
      pubkey: 'pubkey_alice',
      createdAt: 1011,
      groupId: 'grp_1',
      parentEventIds: ['evt_g1'],
      payload: { type: 'MEMBER_ADDED', targetPubkey: 'pubkey_charlie' },
    };

    const res = eventDagService.processDagNodes([groupCreated, addBob, addCharlie]);
    expect(res.membershipSet.has('pubkey_alice')).toBe(true);
    expect(res.membershipSet.has('pubkey_bob')).toBe(true);
    expect(res.membershipSet.has('pubkey_charlie')).toBe(true);
  });

  it('validates key rotation authorized by current member and rejects stale key rotations', () => {
    const activeMembers = new Set(['pubkey_alice', 'pubkey_bob']);

    // Alice (active member) rotates to key version 2 -> Authorized
    const aliceValid = eventDagService.validateKeyRotation('pubkey_alice', 2, 1, activeMembers);
    expect(aliceValid).toBe(true);

    // Stale/removed member attempt -> Rejected
    const staleInvalid = eventDagService.validateKeyRotation(
      'pubkey_eve_stale',
      2,
      1,
      activeMembers
    );
    expect(staleInvalid).toBe(false);
  });

  it('rejects data events authored by unauthorized/removed members', () => {
    const activeMembers = new Set(['pubkey_alice', 'pubkey_bob']);

    expect(eventDagService.isAuthorAuthorized('pubkey_alice', activeMembers)).toBe(true);
    expect(eventDagService.isAuthorAuthorized('pubkey_removed_eve', activeMembers)).toBe(false);
  });

  it('produces identical deterministic canonical state regardless of event arrival order', () => {
    const g1: DagNode = {
      eventId: 'evt_g1',
      kind: 1500,
      pubkey: 'pubkey_alice',
      createdAt: 1000,
      groupId: 'grp_1',
      parentEventIds: [],
      payload: { type: 'GROUP_CREATED', name: 'Trip', members: [{ pubkey: 'pubkey_alice' }] },
    };

    const m1: DagNode = {
      eventId: 'evt_m1',
      kind: 1503,
      pubkey: 'pubkey_alice',
      createdAt: 1010,
      groupId: 'grp_1',
      parentEventIds: ['evt_g1'],
      payload: { type: 'MEMBER_ADDED', targetPubkey: 'pubkey_bob' },
    };

    const e1: DagNode = {
      eventId: 'evt_e1',
      kind: 1501,
      pubkey: 'pubkey_bob',
      createdAt: 1020,
      groupId: 'grp_1',
      parentEventIds: ['evt_m1'],
      payload: { title: 'Lunch' },
    };

    // Forward order
    const res1 = eventDagService.processDagNodes([g1, m1, e1]);
    // Reverse order
    const res2 = eventDagService.processDagNodes([e1, m1, g1]);
    // Shuffled order
    const res3 = eventDagService.processDagNodes([m1, e1, g1]);

    expect(res1.latestEventId).toBe(res2.latestEventId);
    expect(res2.latestEventId).toBe(res3.latestEventId);
    expect(Array.from(res1.membershipSet)).toEqual(Array.from(res2.membershipSet));
    expect(Array.from(res2.membershipSet)).toEqual(Array.from(res3.membershipSet));
  });
});
