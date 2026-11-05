See [AGENTS.md](AGENTS.md).

- Preserve the mobile-first interface, accessibility, reduced motion and the globe’s prominence.
- Use strict TypeScript and the existing Prettier/CSS token conventions.
- Keep pure logic tested in `src/lib/`, `src/state/` and `src/data/`; imperative Three.js stays in `src/globe/`.
- Use only openly licensed, documented assets; no proprietary services, keys, backend or analytics.
- Preserve `/globehops/` asset paths and URL > remembered > example route precedence.
- Request a render after scene changes; dispose Three.js resources. Preserve synchronous iOS tap-to-focus.
- Run lint, unit tests, build and all four E2E projects; review mobile/desktop screenshots and update docs plus `RECENT_CHANGES.md`.
- Never commit `.cache/`; Node scripts require erasable TypeScript and `.ts` imports. `GITHUB_TOKEN` pushes need an explicit deployment workflow call.
