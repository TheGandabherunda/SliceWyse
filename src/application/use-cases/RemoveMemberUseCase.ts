import { Group } from '../../domain/entities/Group';
import { Pubkey } from '../../domain/value-objects/Pubkey';
import { identityService } from '../../infrastructure/identity/IdentityService';
import { DexieGroupRepository } from '../../infrastructure/repositories/DexieGroupRepository';
import { syncCoordinator } from '../services/SyncCoordinator';

export interface RemoveMemberInput {
  groupId: string;
  memberPubkeyToRemove: string;
}

export class RemoveMemberUseCase {
  constructor(private groupRepo = new DexieGroupRepository()) {}

  async execute(input: RemoveMemberInput): Promise<Group> {
    const { groupId, memberPubkeyToRemove } = input;

    const group = await this.groupRepo.getGroupById(groupId);
    if (!group) {
      throw new Error(`Group with ID "${groupId}" not found`);
    }

    const currentIdentity = await identityService.getCurrentIdentity();
    if (!currentIdentity) {
      throw new Error('User identity required to remove group member');
    }

    const removePubkeyObj = new Pubkey(memberPubkeyToRemove);

    // Idempotency / Replay Safety: If member is already removed, return current group
    if (!group.hasMember(removePubkeyObj.value)) {
      return group;
    }

    // 1. Compute remaining active member list
    const remainingMembers = group.members.filter((m) => !m.pubkey.equals(removePubkeyObj));

    if (remainingMembers.length === 0) {
      throw new Error('Cannot remove the last remaining member of a group');
    }

    const remainingPubkeyValues = remainingMembers.map((m) => m.pubkey.value);

    // 2. Single protocol operation: Rotate key epoch (KN -> KN+1) and distribute ONLY to remaining members
    const newKeyRecord = await syncCoordinator.rotateGroupKey(groupId, remainingPubkeyValues);

    // 3. Construct MEMBERSHIP_REMOVED protocol event payload
    const payload = {
      type: 'MEMBERSHIP_REMOVED',
      groupId,
      removedPubkey: removePubkeyObj.value,
      keyVersion: newKeyRecord.keyVersion,
      parentEventIds: [],
    };

    // 4. Submit Local Event via Unified Pipeline (ADR-005)
    // Validates -> Signs -> db.events -> EventReducer.reduceMembershipRemove() -> db.groups/db.members -> db.sync_queue
    await syncCoordinator.submitLocalEvent({
      groupId,
      eventKind: 1500,
      unencryptedPayload: payload,
      parentEventIds: [],
      recipientPubkeys: remainingPubkeyValues,
      keyVersion: newKeyRecord.keyVersion,
    });

    // 5. Return canonical Group projection populated by EventReducer
    const updated = await this.groupRepo.getGroupById(groupId);
    if (!updated) {
      throw new Error(`Failed to retrieve group projection after member removal for ${groupId}`);
    }

    return updated;
  }
}
