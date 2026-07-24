# Security Policy & Threat Model — SliceWyse

Security and privacy are fundamental requirements of SliceWyse.

## Threat Model & Risk Mitigations

| Vulnerability Vector           | Severity | Applied Mitigation Strategy                                                                                                                                                         |
| :----------------------------- | :------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Relay Data Leakage**         | High     | All financial details (titles, amounts, participant allocations) are encrypted using NIP-44 v2 symmetric encryption before relay transmission. Relays only observe encrypted blobs. |
| **Private Key Exposure**       | High     | Nostr secret keys (`nsec`) are isolated within `IdentityService`. Keys are stored locally in IndexedDB and never logged or exposed in memory globals.                               |
| **Malicious Event Injection**  | High     | Cryptographic signature verification (`verifyEvent()`) is enforced on all incoming Nostr events before state ingestion.                                                             |
| **Cross-Site Scripting (XSS)** | High     | Input sanitization using DOMPurify on user display names, group titles, and comments. Content Security Policy (CSP) forbids `eval()` and inline scripts.                            |
| **Supply Chain Attacks**       | Medium   | Strict dependency audit (`npm audit clean`), 100% permissive open-source license governance (MIT / Apache-2.0 / ISC), and zero AGPL/GPL dependencies.                               |

## Content Security Policy (CSP) Recommendations

```http
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self' wss://relay.damus.io wss://nos.lol wss://relay.nostr.band; img-src 'self' data:;
```

## Reporting a Security Vulnerability

Please report security issues by opening a confidential security advisory on GitHub or contacting the maintainers directly. Do not report security vulnerabilities in public issue trackers.
