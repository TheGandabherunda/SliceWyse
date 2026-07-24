# SliceWyse — Decentralized Split Expense Application

> **SliceWyse** is a minimal, production-quality, private, offline-first, Nostr-native expense-sharing application. It brings the intuitive UX of traditional split-expense apps like Splitwise to a completely serverless, open-source, decentralized architecture.

---

## 🌟 Key Features

- **Invisible Decentralization**: Powered by Nostr, but designed so users never need to understand relays, cryptographic event schemas, or protocol mechanics.
- **Offline-First Storage**: Performs 100% of operations (reads, group management, expense entries, debt math) locally in browser IndexedDB via Dexie.js.
- **NIP-44 End-to-End Encryption**: All financial payloads (titles, amounts, participant lists) are encrypted before relay broadcasting.
- **Zero Backend Infrastructure**: Completely free to host on static web hosts like GitHub Pages. No cloud databases, APIs, analytics, or paid services.
- **Greedy Debt Simplification**: Algorithmic min-flow graph solver to settle all group debts with the minimal number of direct peer transfers.
- **WCAG 2.1 AA Compliant**: Built with accessible contrast ratios, dynamic dark mode, screen reader support, and full keyboard navigation.

---

## 🛠️ Technology Stack & Dependencies

All dependencies are permissively licensed open-source software:

- **Core Framework**: [Svelte 5](https://svelte.dev/) (MIT)
- **Language**: [TypeScript](https://www.typescriptlang.org/) (Apache-2.0)
- **Build Tool & Dev Server**: [Vite](https://vitejs.dev/) (MIT)
- **IndexedDB ORM**: [Dexie.js](https://dexie.org/) (Apache-2.0)
- **Nostr Protocol Tools**: [@nostr/tools](https://github.com/nbd-wtf/nostr-tools) (MIT)
- **UI Icon Set**: [@lucide/svelte](https://lucide.dev/) (ISC)
- **Testing**: [Vitest](https://vitest.dev/) (MIT), [fast-check](https://fast-check.dev/) (MIT), [Playwright](https://playwright.dev/) (Apache-2.0)

---

## 🚀 Getting Started

### Prerequisites

- Node.js >= 20.0.0
- npm >= 10.0.0

### Local Development Setup

```bash
# Clone the repository
git clone https://github.com/TheGandabherunda/SliceWyse.git
cd SliceWyse

# Install dependencies
npm install

# Start local development server
npm run dev
```

Open `http://localhost:5173` in your browser.

---

## 🧪 Testing & Verification

```bash
# Run unit & property-based tests (1,000+ runs)
npm run test

# Run Svelte and TypeScript typechecking
npm run check

# Run Prettier code formatting check
npm run format

# Run Playwright E2E browser tests
npx playwright test
```

---

## 📄 Documentation Index

- [ARCHITECTURE.md](./ARCHITECTURE.md) — Clean Architecture layers & component boundaries.
- [SECURITY.md](./SECURITY.md) — Threat model, NIP-44 cryptographic isolation & CSP policy.
- [DATA_MODEL.md](./DATA_MODEL.md) — Aggregates, value objects, and debt math invariants.
- [NOSTR.md](./NOSTR.md) — NIP specifications, custom event kinds, and relay sync engine.
- [DECISIONS.md](./DECISIONS.md) — Architecture Decision Records (ADRs).
- [CONTRIBUTING.md](./CONTRIBUTING.md) — Guidelines for open-source contributions.

---

## 📜 License

SliceWyse is open-source software licensed under the [MIT License](./LICENSE).
