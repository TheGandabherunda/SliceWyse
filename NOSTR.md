# Nostr Protocol Integration — SliceWyse

SliceWyse utilizes Nostr as a peer-to-peer event log and synchronization transport protocol.

## Nostr Event Kinds Specification

| Event Kind  | Event Type  | Purpose                                                                 | Content Payload Encryption                     |
| :---------- | :---------- | :---------------------------------------------------------------------- | :--------------------------------------------- |
| **`0`**     | Replaceable | Nostr Profile Metadata                                                  | Plaintext NIP-01 JSON (`display_name`, `name`) |
| **`1500`**  | Immutable   | Group State (`GROUP_CREATED`, `GROUP_UPDATED`)                          | AES-256-GCM via Web Crypto API (`groupKey`)    |
| **`1501`**  | Immutable   | Expense Event (`EXPENSE_CREATED`, `EXPENSE_UPDATED`, `EXPENSE_DELETED`) | AES-256-GCM via Web Crypto API (`groupKey`)    |
| **`1502`**  | Immutable   | Settlement Event (`SETTLEMENT_CREATED`)                                 | AES-256-GCM via Web Crypto API (`groupKey`)    |
| **`1503`**  | Immutable   | Membership Event (`MEMBER_ADDED`, `MEMBER_REMOVED`)                     | AES-256-GCM via Web Crypto API (`groupKey`)    |
| **`1059`**  | Gift Wrap   | NIP-59 Group Key Distribution Envelope                                  | NIP-44 v2 (Identity Key Transport)             |
| **`10002`** | Replaceable | NIP-65 Relay List Metadata                                              | Plaintext Relay Tags (`read`, `write`)         |

### Rationale for Kind Selection (Kinds 1500–1503)

- **No Protocol Collisions**: Standard regular immutable event range (1000–9999). Avoids NIP-29 Relay Group Control events (9000–9021).
- **Multi-Author Compatibility**: Regular immutable kinds eliminate NIP-33 `kind + author + d` replacement constraints, allowing any active group member to author, update, or settle expenses independently.

---

## Supported NIPs

- **NIP-01**: Basic Nostr protocol specifications, Schnorr signatures, event structure.
- **NIP-07**: Browser extension identity provider interface (`window.nostr`).
- **NIP-19**: bech32 encoded entity keys (`npub`, `nsec`).
- **NIP-44**: Version 2 identity-to-identity payload encryption for NIP-59 key transport.
- **NIP-59**: Gift Wrap (`Kind 1059` / `13` / `14`) for secure, metadata-private group key distribution.
- **NIP-65**: Relay List Metadata (`Kind 10002`) for dynamic multi-author relay discovery.
