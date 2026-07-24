# Contributing Guidelines — SliceWyse

We welcome open-source contributions to SliceWyse!

## Development Workflow

1. Fork the repository and create a feature branch (`git checkout -b feat/your-feature`).
2. Install dependencies using `npm install`.
3. Ensure all tests and linters pass before committing:
   ```bash
   npm run test
   npm run check
   npm run format
   ```
4. Commit your changes using **Conventional Commits**:
   - `feat(identity)`: add encrypted backup import
   - `fix(debt)`: resolve floating point rounding in percentage splits
   - `docs(readme)`: update getting started guide
5. Open a Pull Request on GitHub.

## Dependency Policy

All dependencies must use permissive open-source licenses:

- MIT
- Apache-2.0
- BSD
- ISC

GPL/AGPL dependencies are strictly prohibited.
