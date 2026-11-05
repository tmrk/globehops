# Deployment

## GitHub Pages

Set repository **Settings → Pages → Build and deployment → Source** to **GitHub Actions**. `.github/workflows/deploy.yml` runs on pushes to `main`, manual dispatch and reusable workflow calls. It checks out the requested ref, uses Node 24 and `npm ci`, runs lint/unit tests/build, installs Chromium and runs the desktop/mobile Chromium E2E projects against the built site (`E2E_SKIP_BUILD: 1`). On failure it uploads the Playwright report for seven days.

Successful runs upload `dist/` as the Pages artifact, then deploy through the `github-pages` environment with Pages write and OIDC permissions. Deployment runs are serialised by the `pages` concurrency group. The Vite default base is `/globehops/`, matching [the live URL](https://tmrk.github.io/globehops/). `BASE_PATH` can override it when building for another host.

With GitHub CLI authenticated and the workflows present on `main`, run:

```sh
gh workflow run deploy.yml --repo tmrk/globehops --ref main
gh run list --repo tmrk/globehops --workflow deploy.yml
gh run watch <run-id> --repo tmrk/globehops
```

## Airport and time-zone refresh

`.github/workflows/update-airports.yml` runs daily at **04:23 UTC** or manually. It downloads the three CSVs, validates and regenerates only when the content hash changes. When airport content changes, the workflow restores `.cache/timezones` using cache key `tz-2026f` and runs `npm run timezones:build` against the pinned TBB ZIP (downloading if absent). It then runs unit tests and a production build before committing both generated datasets and their build records to `main`. No-change airport checks skip the zone rebuild; this workflow does not upgrade the pinned TBB release automatically. Check source/licence changes explicitly when changing that pin.

Generated discovery examples also depend on real airport calculations. If the agent-files drift test fails after a data change, regenerate with `npm run agent:build` and review/commit the outputs; the current refresh workflow does not run that generator automatically. `agent/dataset.json` is always emitted from current metadata during the Vite build.

A successful direct push exposes its SHA and calls Deploy through `workflow_call` with that exact SHA. Pushes made using the repository’s `GITHUB_TOKEN` do not trigger push workflows, so this explicit call is needed; see [GitHub’s workflow triggering documentation](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow).

If branch protection rejects the push, the workflow pushes a dated `data/ourairports-YYYY-MM-DD` branch and attempts a pull request. Enable **Settings → Actions → General → Workflow permissions → Allow GitHub Actions to create and approve pull requests** for that fallback. Review and merge the PR through the normal repository process; a user merge to `main` triggers deployment. The workflow has contents/pull-request write permissions; branch rules still apply. There is currently no `pull_request` trigger in Deploy, so manually dispatch validation on a PR ref when needed.

```sh
gh workflow run update-airports.yml --repo tmrk/globehops --ref main
gh run list --repo tmrk/globehops --workflow update-airports.yml
```

## Verify a release

Check that both build and deploy jobs succeeded and inspect the `github-pages` deployment URL. Open `/globehops/?route=CPH-LHR-JFK` in a fresh browser context: confirm stops, totals, textured globe and labels. Reload, open About and test an airport search at desktop and mobile widths. Network requests for JS/CSS, fonts, `airports-*.json` and `earth-*.webp` must remain under `/globehops/` and succeed. Confirm the About data date matches the committed build record for a data release. Do not infer live deployment success from a local build alone.

Also verify:

- `/globehops/llms.txt` responds with 200 and readable discovery text. `/globehops/agent/capabilities.json`, `itinerary.schema.json`, `examples.json` and build-emitted `dataset.json` each respond with 200 and a JSON content type; check the freshness metadata against the committed records.
- A scheduled link such as `/globehops/?route=CPH-LHR-JFK&dep1=2026-11-20T08:15&arr2=2026-11-20T09:05&dep2=2026-11-20T11:00&arr3=2026-11-20T13:50` loads local endpoint times and journey totals.
- Day/night shading changes when scrubbing UTC time, the toggle restores the unshaded appearance, and playback moves through flights and transfers. Check reduced-motion behaviour and keyboard controls at desktop/mobile sizes.
- The hashed time-zone JSON loads under `/globehops/`, and visible credits retain TBB/OSM attribution and the ODbL link.

MCP is **not deployed**. `mcp/server.ts` is a local stdio process using a checkout and installed dependencies; Pages has no MCP endpoint. Its integration test is part of the unit suite.

The full browser suite can also run against the live site (no local server is started):

```sh
E2E_BASE_URL=https://tmrk.github.io/globehops/ npx playwright test
```
