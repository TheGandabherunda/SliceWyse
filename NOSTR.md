# Nostr Protocol Integration — SliceWyse

SliceWyse utilizes Nostr as a peer-to-peer event log and synchronization transport protocol.

## Nostr Event Kinds Architecture

| Event Kind | Type        | Content Payload (NIP-44 Encrypted) | Purpose                      |
| :--------- | :---------- | :--------------------------------- | :--------------------------- |
| `0`        | Replaceable | Plaintext JSON (`name`, `about`)   | Nostr User Metadata Profile  |
| `30078`    | Addressable | NIP-44 Encrypted JSON              | Group State & Member Roster  |
| `30079`    | Addressable | NIP-44 Encrypted JSON              | Expense Event Payload        |
| `30080`    | Addressable | NIP-44 Encrypted JSON              | Settlement Event Payload     |
| `30081`    | Replaceable | NIP-44 Encrypted JSON              | Expense Tombstone (Deletion) |

## Supported NIPs

- **NIP-01**: Basic Nostr protocol specifications, signatures, event structure.
- **NIP-07**: Browser extension identity provider interface (`window.nostr`).
- **NIP-19**: bech32 encoded entity keys (`npub`, `nsec`).
- **NIP-44**: Version 2 symmetric payload encryption standard.
