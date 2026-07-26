import { Group } from '../../domain/entities/Group';
import { Member } from '../../domain/entities/Member';
import { Pubkey } from '../../domain/value-objects/Pubkey';
import { identityService } from '../../infrastructure/identity/IdentityService';
import { DexieGroupRepository } from '../../infrastructure/repositories/DexieGroupRepository';
import { syncCoordinator } from '../services/SyncCoordinator';
import {
  nip59GiftWrapService,
  type GroupKeyEnvelope,
} from '../../infrastructure/crypto/Nip59GiftWrapService';

export interface FulfillJoinRequestInput {
  groupId: string;
  joiningPubkey: string;
  joiningMember: {
    pubkey: string;
    displayName: string;
    joinedAt?: number;
  };
  invitationKeyVersion: number;
}

export class FulfillJoinRequestUseCase {
  constructor(private groupRepo = new DexieGroupRepository()) {}

  async execute(input: FulfillJoinRequestInput): Promise<boolean> {
    const { groupId, joiningPubkey, joiningMember, invitationKeyVersion } = input;

    const group = await this.groupRepo.getGroupById(groupId);
    if (!group) return false;

    const currentIdentity = await identityService.getCurrentIdentity();
    if (!currentIdentity?.secretKey) return false;

    const isHandlerMember = group.members.some((m) => m.pubkey.value === currentIdentity.pubkey);
    if (!isHandlerMember) return false;

    let memberWasAdded = false;

    // Idempotency check: only add member if not already present in group
    if (!group.hasMember(joiningPubkey)) {
      const newMember = new Member({
        pubkey: new Pubkey(joiningPubkey),
        displayName: joiningMember?.displayName || `Member ${joiningPubkey.slice(0, 8)}`,
        joinedAt: joiningMember?.joinedAt ?? Date.now(),
      });

      const updatedMembers = [...group.members, newMember];
      const updatedGroup = new Group({
        id: group.id,
        name: group.name,
        currency: group.currency,
        members: updatedMembers,
        createdAt: group.createdAt,
        updatedAt: Date.now(),
      });

      memberWasAdded = true;

      // Construct MEMBERSHIP_ADDED protocol event payload
      const membershipPayload = {
        type: 'MEMBERSHIP_ADDED',
        groupId: group.id,
        member: {
          pubkey: joiningPubkey,
          displayName: newMember.displayName,
          joinedAt: newMember.joinedAt,
        },
        parentEventIds: [],
      };

      // Submit Local Event via Unified Pipeline (ADR-005)
      // Validates -> Signs -> db.events -> EventReducer.reduceMembershipAdd() -> db.groups/db.members -> db.sync_queue
      await syncCoordinator.submitLocalEvent({
        groupId: group.id,
        eventKind: 1500,
        unencryptedPayload: membershipPayload,
        parentEventIds: [],
        recipientPubkeys: updatedMembers.map((m) => m.pubkey.value),
      });
    }

    // Re-deliver any newer key epochs (invitationKeyVersion + 1 ... latest)
    const keys = await syncCoordinator.getAllGroupKeys(groupId);
    const startVersion = (invitationKeyVersion ?? 1) + 1;
    const newerKeys = keys.filter((k) => k.keyVersion >= startVersion);

    for (const keyRecord of newerKeys) {
      const envelope: GroupKeyEnvelope = {
        protocolVersion: 1,
        groupId,
        keyVersion: keyRecord.keyVersion,
        groupKey: keyRecord.groupKeyHex,
        issuedAt: keyRecord.createdAt,
      };

      try {
        const giftWrap = nip59GiftWrapService.createGiftWrap(
          envelope,
          currentIdentity.secretKey,
          joiningPubkey
        );
        await syncCoordinator.enqueueSignedEvent(giftWrap, groupId, joiningPubkey);
      } catch {
        // Continue fulfilling request
      }
    }

    return memberWasAdded;
  }
}
