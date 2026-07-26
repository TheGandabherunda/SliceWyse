export interface DagNode {
  eventId: string;
  kind: number;
  pubkey: string;
  createdAt: number;
  groupId: string;
  parentEventIds: string[];
  payload: any;
  depth?: number;
}

export class EventDagService {
  /**
   * Computes derived Causal Depths for DAG nodes:
   * Depth(e) = 0 if GroupCreated, 1 + max(Depth(parents)) otherwise.
   */
  computeDagDepths(nodes: DagNode[]): Map<string, number> {
    const depthMap = new Map<string, number>();

    // Assign Depth 0 to root GROUP_CREATED nodes
    for (const node of nodes) {
      if (node.kind === 1500 && node.payload?.type === 'GROUP_CREATED') {
        depthMap.set(node.eventId, 0);
      }
    }

    // Iteratively resolve depths: Depth(e) = 1 + max(Depth(parents))
    let changed = true;
    let iterations = 0;
    const maxIterations = nodes.length + 5;

    while (changed && iterations < maxIterations) {
      changed = false;
      iterations++;

      for (const node of nodes) {
        if (node.kind === 1500 && node.payload?.type === 'GROUP_CREATED') {
          continue;
        }

        let maxParentDepth = -1;
        let hasResolvedParent = false;

        for (const pId of node.parentEventIds) {
          if (depthMap.has(pId)) {
            maxParentDepth = Math.max(maxParentDepth, depthMap.get(pId)!);
            hasResolvedParent = true;
          }
        }

        const calculatedDepth = hasResolvedParent ? maxParentDepth + 1 : 1;
        if (depthMap.get(node.eventId) !== calculatedDepth) {
          depthMap.set(node.eventId, calculatedDepth);
          changed = true;
        }
      }
    }

    return depthMap;
  }

  /**
   * Sorts DAG nodes using total order formula:
   * SortKey(e) = <Depth(e), created_at(e), id(e)>
   */
  sortNodesTopologically(nodes: DagNode[]): DagNode[] {
    const depthMap = this.computeDagDepths(nodes);
    return [...nodes].sort((a, b) => {
      const depthA = depthMap.get(a.eventId) ?? a.depth ?? 0;
      const depthB = depthMap.get(b.eventId) ?? b.depth ?? 0;

      if (depthA !== depthB) return depthA - depthB;
      if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
      return a.eventId.localeCompare(b.eventId);
    });
  }

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

    // Sort nodes using total topological SortKey order
    const sorted = this.sortNodesTopologically(nodes);

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
        if (node.payload?.members) {
          for (const m of node.payload.members) {
            membershipSet.add(typeof m === 'string' ? m : m.pubkey);
          }
        }
        membershipSet.add(node.pubkey);
      } else if (node.kind === 1503) {
        if (node.payload?.type === 'MEMBER_ADDED' && node.payload?.targetPubkey) {
          membershipSet.add(node.payload.targetPubkey);
        } else if (node.payload?.type === 'MEMBER_REMOVED' && node.payload?.targetPubkey) {
          membershipSet.delete(node.payload.targetPubkey);
        }
      }
    }

    // Deterministic tie-breaker for active latest event ID using sortNodesTopologically
    let latestEventId: string | null = null;
    if (leafNodes.length > 0) {
      const sortedLeaves = this.sortNodesTopologically(leafNodes);
      latestEventId = sortedLeaves[sortedLeaves.length - 1].eventId;
    }

    return {
      membershipSet,
      latestEventId,
      activeBranchIds,
      hasConflict,
    };
  }

  validateKeyRotation(
    issuerPubkey: string,
    keyVersion: number,
    currentKeyVersion: number,
    authorizedMembershipSet: Set<string>
  ): boolean {
    if (keyVersion <= currentKeyVersion) return false;
    return authorizedMembershipSet.has(issuerPubkey);
  }

  isAuthorAuthorized(authorPubkey: string, authorizedMembershipSet: Set<string>): boolean {
    return authorizedMembershipSet.has(authorPubkey);
  }
}

export const eventDagService = new EventDagService();
