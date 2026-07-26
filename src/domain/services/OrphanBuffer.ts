import type { ValidatedEvent } from './EventValidationPipeline';

export class OrphanBuffer {
  private buffer = new Map<string, ValidatedEvent>();

  /**
   * Buffers a validated event whose parent dependencies are missing from storage.
   */
  addOrphan(validated: ValidatedEvent): void {
    if (validated.event?.id) {
      this.buffer.set(validated.event.id, validated);
    }
  }

  /**
   * Checks if an event is currently buffered in the orphan queue.
   */
  hasOrphan(eventId: string): boolean {
    return this.buffer.has(eventId);
  }

  /**
   * Drains and returns all orphaned events whose parent dependencies have all been persisted.
   */
  async drainReadyOrphans(
    isParentPersisted: (parentEventId: string) => Promise<boolean>
  ): Promise<ValidatedEvent[]> {
    const readyEvents: ValidatedEvent[] = [];
    let drainedAny = true;

    while (drainedAny) {
      drainedAny = false;
      const candidates = Array.from(this.buffer.values());

      for (const candidate of candidates) {
        let allParentsReady = true;

        for (const pId of candidate.parentEventIds) {
          const ready = await isParentPersisted(pId);
          if (!ready) {
            allParentsReady = false;
            break;
          }
        }

        if (allParentsReady) {
          readyEvents.push(candidate);
          this.buffer.delete(candidate.event.id);
          drainedAny = true;
        }
      }
    }

    return readyEvents;
  }

  /**
   * Returns current count of buffered orphan events.
   */
  get size(): number {
    return this.buffer.size;
  }

  /**
   * Clears all buffered orphan events.
   */
  clear(): void {
    this.buffer.clear();
  }
}

export const orphanBuffer = new OrphanBuffer();
