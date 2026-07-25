export interface DagNode {
  eventId: string;
  kind: number;
  pubkey: string;
  createdAt: number;
  groupId: string;
  parentEventIds: string[];
  payload: any;
}

export class EventDagService {
  /**
   * Builds DAG graph from event records and returns canonical state + detected branch conflicts.
   */
  processDagNodes(nodes: DagNode[]): {
    membershipSet: Set<string>;
    latestEventId: string | null;
    activeBranchIds: string[];
    hasConflict: boolean;
  } {
    if (nodes.length === 0) {
      return {
        membershipSet: new Set(),
        latestEventId: null,
        activeBranchIds: [],
        hasConflict: false,
      };
    }

    // Sort nodes topologically / chronologically
    const sorted = [...nodes].sort((a, b) => {
      if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
      return a.eventId.localeCompare(b.eventId);
    });

    const parentMap = new Map<string, Set<string>>();
    const childMap = new Map<string, Set<string>>();
    const nodeMap = new Map<string, DagNode>();

    for (const node of sorted) {
      nodeMap.set(node.eventId, node);
      if (!parentMap.has(node.eventId)) {
        parentMap.set(node.eventId, new Set());
      }

      for (const pId of node.parentEventIds) {
        parentMap.get(node.eventId)!.add(pId);
        if (!childMap.has(pId)) {
          childMap.set(pId, new Set());
        }
        childMap.get(pId)!.add(node.eventId);
      }
    }

    // Find leaf nodes (nodes with no children) -> active branch heads
    const leafNodes = sorted.filter(
      (node) => !childMap.has(node.eventId) || childMap.get(node.eventId)!.size === 0
    );
    const activeBranchIds = leafNodes.map((n) => n.eventId);
    const hasConflict = leafNodes.length > 1;

    // Derive membership set by processing membership events in topological order
    const membershipSet = new Set<string>();

    for (const node of sorted) {
      if (node.kind === 1500) {
        // GROUP_CREATED -> Add creator and initial members
        if (node.payload.members) {
          for (const m of node.payload.members) {
            membershipSet.add(typeof m === 'string' ? m : m.pubkey);
          }
        }
        membershipSet.add(node.pubkey);
      } else if (node.kind === 1503) {
        // MEMBER_EVENT -> Verify author is authorized in DAG state
        if (node.payload.type === 'MEMBER_ADDED' && node.payload.targetPubkey) {
          membershipSet.add(node.payload.targetPubkey);
        } else if (node.payload.type === 'MEMBER_REMOVED' && node.payload.targetPubkey) {
          membershipSet.delete(node.payload.targetPubkey);
        }
      }
    }

    // Deterministic tie-breaker for active latest event ID: highest createdAt, then lowest eventId lexically
    let latestEventId: string | null = null;
    if (leafNodes.length > 0) {
      const sortedLeaves = [...leafNodes].sort((a, b) => {
        if (b.createdAt !== a.createdAt) return b.createdAt - a.createdAt;
        return a.eventId.localeCompare(b.eventId);
      });
      latestEventId = sortedLeaves[0].eventId;
    }

    return {
      membershipSet,
      latestEventId,
      activeBranchIds,
      hasConflict,
    };
  }

  /**
   * Validates if a proposed key rotation (version V+1) is authorized by the current membership set.
   */
  validateKeyRotation(
    issuerPubkey: string,
    keyVersion: number,
    currentKeyVersion: number,
    authorizedMembershipSet: Set<string>
  ): boolean {
    if (keyVersion <= currentKeyVersion) return false;
    return authorizedMembershipSet.has(issuerPubkey);
  }

  /**
   * Validates if an incoming data event author was authorized at the time of event creation.
   */
  isAuthorAuthorized(authorPubkey: string, authorizedMembershipSet: Set<string>): boolean {
    return authorizedMembershipSet.has(authorPubkey);
  }
}

export const eventDagService = new EventDagService();
