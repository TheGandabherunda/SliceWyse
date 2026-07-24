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
       |  - Domain Services (DebtSimplifier)                   |
       +---------------------------+---------------------------+
                                   ^
                                   |
       +---------------------------+---------------------------+
       |                Infrastructure Layer                   |
       |  - Dexie (IndexedDB Repositories)                      |
       |  - RelayManager (Nostr WebSocket Protocol)            |
       |  - Nip44CryptoService (Web Crypto / NIP-44 Engine)     |
       |  - IdentityService (Keypair Management)               |
       +-------------------------------------------------------+
```

## Layer Responsibilities

### 1. Domain Layer (`src/domain/`)

- Pure TypeScript implementation of core expense-sharing logic.
- **`Money`**: Value object managing integer minor units (cents) to avoid floating-point inaccuracies.
- **`Pubkey`**: Value object validating Nostr public key hex format.
- **`Group`**, **`Expense`**, **`Settlement`**, **`Member`**: Core domain entities and aggregates.
- **`DebtSimplifier`**: Pure domain service executing greedy debt graph reduction ($\sum \text{NetBalance} = 0$).
- **Rule**: Zero imports from external UI frameworks, Nostr libraries, or Dexie DB.

### 2. Application Layer (`src/application/`)

- Orchestrates business workflows into distinct use cases (`CreateGroupUseCase`, `AddExpenseUseCase`, `SettleUpUseCase`, `AddMemberUseCase`).
- Coordinates background offline sync through `SyncCoordinator`.

### 3. Infrastructure Layer (`src/infrastructure/`)

- Implements data persistence and network protocols.
- **`SliceWyseDatabase`**: Dexie.js IndexedDB schema and object stores.
- **`IdentityService`**: Nostr secret key generation, local storage, and NIP-07 browser extension integration.
- **`Nip44CryptoService`**: NIP-44 v2 symmetric payload encryption wrapper.
- **`RelayManager`**: WebSocket connection pool manager for standard Nostr relays.

### 4. UI Layer (`src/ui/`)

- Built with Svelte 5 runes (`$state`, `$effect`, `$derived`, `$props`).
- Presentation, form validation, responsive glassmorphism visual layout, and accessibility features.
