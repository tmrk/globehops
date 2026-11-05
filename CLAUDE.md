See [AGENTS.md](AGENTS.md).

- Preserve the mobile-first interface, accessibility, reduced motion and the globe’s prominence.
- Use strict TypeScript and the existing Prettier/CSS token conventions.
- Keep pure logic tested in `src/lib/`, `src/state/`, `src/data/` and `src/agent/`; imperative Three.js stays in `src/globe/`.
- Use only openly licensed, documented assets; no proprietary services, keys, backend or analytics.
- Preserve `/globehops/` asset paths and URL > remembered > example route precedence.
- Request a render after scene changes; dispose Three.js resources. Preserve synchronous iOS tap-to-focus.
- Run lint, unit tests, build and all four E2E projects; review mobile/desktop screenshots and update docs plus `RECENT_CHANGES.md`.
- Never commit `.cache/`; Node scripts, `mcp/` and their imports require erasable TypeScript and `.ts` imports. `GITHUB_TOKEN` pushes need an explicit deployment workflow call.
- Read `App.tsx` for journey/timeline orchestration; `lib/{timezone,sun,schedule,flightProgress,timeline,journeyText}.ts` holds time logic; `mcp/` adapts the shared agent modules to local stdio only.
- One UTC `SimulationClock` drives everything through the simulation feed; App must not re-render per frame. Never write `t` during playback (Safari throttling); debounce paused scrubs ≥400 ms.
- Airport zones come from build-time TBB lookup; offsets and DST come from runtime `Intl`, whose rules can differ and change. Keep links backwards compatible.
- Run `npm run timezones:build`, `npm run agent:build` and `npm run mcp` as needed. Never hand-edit generated `timezones.json` or `public/agent/*.json`; the agent-files test rejects drift.
- Keep the ODbL time-zone database and its notices separate from public-domain airports; commit generated time zones with their build record.
- `docs/AGENT_INTEGRATION.md` is for external agents using GlobeHops, not contributors; follow `AGENTS.md` for codebase work.
