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

## Airport refresh

`.github/workflows/update-airports.yml` runs daily at **04:23 UTC** or manually. It downloads the three CSVs, validates and regenerates only when the content hash changes. Changed data must pass unit tests and a production build before committing the dataset and build record to `main`.

A successful direct push exposes its SHA and calls Deploy through `workflow_call` with that exact SHA. Pushes made using the repository’s `GITHUB_TOKEN` do not trigger push workflows, so this explicit call is needed; see [GitHub’s workflow triggering documentation](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow).

If branch protection rejects the push, the workflow pushes a dated `data/ourairports-YYYY-MM-DD` branch and attempts a pull request. Enable **Settings → Actions → General → Workflow permissions → Allow GitHub Actions to create and approve pull requests** for that fallback. Review and merge the PR through the normal repository process; a user merge to `main` triggers deployment. The workflow has contents/pull-request write permissions; branch rules still apply. There is currently no `pull_request` trigger in Deploy, so manually dispatch validation on a PR ref when needed.

```sh
gh workflow run update-airports.yml --repo tmrk/globehops --ref main
gh run list --repo tmrk/globehops --workflow update-airports.yml
```

## Verify a release

Check that both build and deploy jobs succeeded and inspect the `github-pages` deployment URL. Open `/globehops/?route=CPH-LHR-JFK` in a fresh browser context: confirm stops, totals, textured globe and labels. Reload, open About and test an airport search at desktop and mobile widths. Network requests for JS/CSS, fonts, `airports-*.json` and `earth-*.webp` must remain under `/globehops/` and succeed. Confirm the About data date matches the committed build record for a data release. Do not infer live deployment success from a local build alone.
