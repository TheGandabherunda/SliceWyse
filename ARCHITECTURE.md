# Architecture Specification — SliceWyse

SliceWyse is structured using **Clean Architecture** (Ports and Adapters) to separate business logic from external frameworks, user interfaces, storage engines, and network protocols.

```
       +-------------------------------------------------------+
       |                   UI Layer (Svelte 5)                 |
       |  - Views (Onboarding, Dashboard, GroupDetail)         |
       |  - Components (CreateGroupModal, AddExpenseModal, etc)|
       +---------------------------+---------------------------+
                                   |
                                   v
       +-------------------------------------------------------+
       |                 Application Layer                     |
       |  - Use Cases (CreateGroup, AddExpense, SettleUp)       |
       |  - Services (SyncCoordinator)                         |
       +---------------------------+---------------------------+
                                   |
                                   v
       +-------------------------------------------------------+
       |                   Domain Layer                        |
       |  - Core Entities (Group, Expense, Settlement, Member) |
       |  - Value Objects (Money, Pubkey)                      |
       |  - Domain Services (DebtSimplifier, EventDagService)  |
       +---------------------------+---------------------------+
                                   ^
                                   |
       +---------------------------+---------------------------+
       |                Infrastructure Layer                   |
       |  - Dexie (IndexedDB Repositories)                      |
       |  - RelayManager (Nostr WebSocket & NIP-65 Protocol)    |
       |  - AesGcmCryptoService (Web Crypto AES-256-GCM)       |
       |  - Nip59GiftWrapService (NIP-59 Kind 1059 Envelopes)   |
       |  - IdentityService (Keypair & Profile Hydration)       |
       +-------------------------------------------------------+
```

## Security & Protocol Architecture

```
Nostr Identity
      ↓
NIP-59 / NIP-44
      ↓
Group Key Distribution

Group Key
      ↓
AES-256-GCM
      ↓
Shared Group Events

Signed Immutable Nostr Events (Kinds 1500-1503)
      ↓
Relays
      ↓
Event DAG (parentEventIds)
      ↓
Derived SliceWyse State
```

## Layer Responsibilities

### 1. Domain Layer (`src/domain/`)

- Pure TypeScript implementation of core expense-sharing logic.
- **`Money`**: Value object managing integer minor units (cents) to avoid floating-point inaccuracies.
- **`Pubkey`**: Value object validating Nostr public key hex format.
- **`Group`**, **`Expense`**, **`Settlement`**, **`Member`**: Core domain entities and aggregates.
- **`DebtSimplifier`**: Pure domain service executing greedy debt graph reduction ($\sum \text{NetBalance} = 0$).
- **`EventDagService`**: Pure domain service processing `parentEventIds` DAG graph traversal, concurrent edit branch detection, merge resolution, and equal-member authority validation.

### 2. Application Layer (`src/application/`)

- Orchestrates business workflows into distinct use cases (`CreateGroupUseCase`, `AddExpenseUseCase`, `SettleUpUseCase`, `AddMemberUseCase`).
- Coordinates background offline sync, NIP-59 key distribution, and 4-stage historical discovery through `SyncCoordinator`.

### 3. Infrastructure Layer (`src/infrastructure/`)

- Implements data persistence and network protocols.
- **`SliceWyseDatabase`**: Dexie.js IndexedDB schema and object stores (`groups`, `expenses`, `settlements`, `group_keys`, `events`, `sync_queue`).
- **`IdentityService`**: Nostr secret key generation, local storage, profile hydration, and NIP-07 browser extension integration.
- **`AesGcmCryptoService`**: AES-256-GCM payload encryption wrapper using Web Crypto API (`crypto.subtle`) with fresh 12-byte IVs.
- **`Nip59GiftWrapService`**: NIP-59 Gift Wrap (`Kind 1059` / `13` / `14`) key envelope distribution engine.
- **`RelayManager`**: WebSocket connection pool manager with NIP-65 dynamic discovery, per-relay health tracking, and NIP-20 `OK` confirmation validation.

### 4. UI Layer (`src/ui/`)

- Built with Svelte 5 runes (`$state`, `$effect`, `$derived`, `$props`).
- Presentation, form validation, responsive glassmorphism visual layout, and accessibility features.
