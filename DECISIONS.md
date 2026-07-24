# Architecture Decision Records (ADRs) — SliceWyse

## ADR 001: Offline-First IndexedDB Architecture

- **Status**: Approved
- **Context**: The app must operate 100% offline without reliance on continuous relay connectivity.
- **Decision**: Use Dexie.js as the primary local database. Nostr relays act as an asynchronous outbox/sync queue rather than the primary database.

## ADR 002: NIP-44 Cryptographic Payload Isolation

- **Status**: Approved
- **Context**: Financial activities (group titles, amounts, member names) must remain private.
- **Decision**: Encrypt all event content blobs using NIP-44 v2 before broadcasting to Nostr relays. Relays only observe public keys and encrypted payloads.

## ADR 003: Deterministic Event Sourcing & Immutable Tombstones

- **Status**: Approved
- **Context**: Expenses and group state must be audit-verifiable without race conditions.
- **Decision**: Expenses never mutate in place. Editing creates a versioned event referencing `previousVersionId`. Deletion creates a tombstone event (`Kind 30081`).

## ADR 004: Clean Architecture Separation

- **Status**: Approved
- **Context**: Domain logic (debt math, entities) must be framework-agnostic and testable in isolation.
- **Decision**: Implement strict Clean Architecture boundaries (Domain -> Application -> Infrastructure -> UI).
