# Docs bundle sync (MCP ↔ dero-docs)

Bundled docs in `data/docs-index.json` power `dero_docs_*` tools for `npx` users. They do **not** auto-update when you edit MDX in `dero-docs` — this workflow keeps them in sync.

## Architecture

```
dero-docs (MDX)  ──►  build:docs  ──►  data/docs-index.json  ──►  npm publish
     │                                        ▲
     └── Level 3: push main ──► repository_dispatch ──► refresh PR
```

## Level 2 — Manual refresh (always available)

**When:** batch doc updates, or Level 3 secret not configured yet.

1. Open [dero-mcp-server → Actions → Refresh docs bundle](https://github.com/DHEBP/dero-mcp-server/actions/workflows/refresh-docs-bundle.yml)
2. Click **Run workflow**
3. Optional: set `dero_docs_ref` (default `main`)
4. Review and merge the PR it opens
5. Bump patch version → `npm publish` → `mcp-publisher publish`

**Local equivalent:**

```bash
cd dero-mcp-server
npm run build:docs && npm run smoke:docs
git add data/docs-index.json && git commit && git push
```

## Level 3 — Auto PR on dero-docs merge (recommended)

**When:** every push to `dero-docs` `main` (after you merge doc changes).

### One-time setup

Create a GitHub fine-grained PAT (or classic PAT) with:

- **Repository access:** `DHEBP/dero-mcp-server` only
- **Permissions:** `Actions` → Read and write, `Contents` → Read (metadata)

Add it as a secret in **dero-docs** repo:

| Secret | Repo | Value |
|--------|------|--------|
| `MCP_DOCS_SYNC_TOKEN` | `DHEBP/dero-docs` | the PAT |

Workflow: `dero-docs/.github/workflows/sync-mcp-docs-bundle.yml`

That dispatches `dero-docs-updated` to `dero-mcp-server`, which runs `refresh-docs-bundle.yml` and opens a PR if the index changed.

### What you still do manually

- Review + merge the refresh PR on `dero-mcp-server`
- Patch bump + `npm publish` + `mcp-publisher publish`

No OTP in CI — publish stays human-in-the-loop.

## Level 4 — Auto npm publish (not recommended yet)

Would require storing npm publish credentials in CI and skipping 2FA OTP. Possible with automation tokens, but higher risk and more ops burden. Stay on Level 2 + 3 until release cadence is painful.

## After any bundle refresh

Checklist:

```text
[ ] Merge refresh PR (data/docs-index.json)
[ ] npm run smoke:docs locally (optional sanity check)
[ ] Bump patch in package.json + server.json
[ ] npm publish --otp=...
[ ] mcp-publisher publish (re-login if JWT expired)
```

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Level 3 never fires | Check `MCP_DOCS_SYNC_TOKEN` on dero-docs |
| Dispatch 404 | PAT must target `DHEBP/dero-mcp-server` |
| PR says no changes | MDX edits didn't affect indexed pages, or already synced |
| `build:docs` fails in CI | Verify `DHEBP/dero-docs` is accessible (public repo) |
| Local `prepack` stale bundle | Run `npm run build:docs` before commit; don't rely on publish-only rebuild |
