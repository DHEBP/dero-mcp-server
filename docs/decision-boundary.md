# DERO MCP — Decision Boundary

**Last updated:** 2026-05-23
**Repo:** `DHEBP/dero-mcp-server`
**Scope:** v0.1.x server registered as `io.github.DHEBP/dero-mcp-server`
**Source pattern:** Mirrors Food Near Me's Phase 7 decision-boundary discipline ([remix/14](../../../docs/AI%20Agent%20Ready/remix/14-competitive-mcp-shape-parity-and-composites.md), [remix/13](../../../docs/AI%20Agent%20Ready/remix/13-mcp-agent-ready-playbook.md)).

> **Why this doc exists.** "No wallet RPC, no `SendRawTransaction`, no `SubmitBlock`" was a README sentence and an `dero://mcp/safety-boundary` resource. That made it easy for a future contributor to add a `transfer` tool "behind a flag" and have it pass review. This document pins the boundary, makes the rationale auditable, and names the conditions under which the boundary can move.

---

## Posture

DERO MCP server v0.1.x is:

1. **stdio-first.** Local subprocess launched by an MCP host (Cursor, Claude Desktop, OpenCode). No HTTP/SSE transport, no DNS, no shared-host blast radius.
2. **Read-only.** Every tool carries the `readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false` annotation block. No tool can move funds, mutate chain state, or submit consensus data.
3. **Bounded-network.** The server only contacts the configured `DERO_DAEMON_URL` over JSON-RPC. No arbitrary outbound calls.
4. **In-process docs.** The 145-page bundled docs index ships inside the npm package and resolves with zero network I/O.
5. **No telemetry by default.** The server does not phone home. Operators who want metrics wrap it externally.

---

## Allowed

These actions are within scope of v0.1.x and may ship without escalation:

- Any **read-only** DERO daemon JSON-RPC method (`DERO.GetInfo`, `DERO.GetSC`, `DERO.GetTransaction`, …).
- New **composite tools** that chain existing read-only primitives plus bundled docs lookups (see `composites.md`). Composites inherit the read-only annotation block.
- Adding **bundled docs** for new DERO products (e.g. future SDK docs) via `scripts/build-docs-index.ts`.
- Adding **MCP resources** that expose static metadata (server info, safety boundary, example flows, decision boundary, composites design).
- Adding **MCP prompts** that orchestrate read-only tool sequences.
- Adding **CI guards** (description style, citation resolution, annotation parity, smoke probes, flow tests).
- Adding **input ergonomics** to existing tools (camelCase/snake_case aliases via Zod transforms) as long as the canonical input shape is preserved.
- Adding **runtime tool filtering** via an env allowlist (`DERO_MCP_ENABLED_TOOLS`) so operators can disable subsets without forking.

---

## Not allowed (v0.1.x)

These actions require the gate in the "Moving the boundary" section before they can land:

- **Wallet RPC** (`transfer`, `scinvoke`, `make_integrated_address`, `query_key`, etc.).
- **`DERO.SendRawTransaction`** — moves funds or contract state.
- **`DERO.SubmitBlock`** — moves consensus state.
- **Hosting the server over HTTP/SSE** in the npm-distributed binary. (A separate operator-controlled deployment is out of scope here.)
- **Outbound network calls** to anything other than the configured `DERO_DAEMON_URL`. No third-party indexers, no remote search, no analytics.
- **In-process key storage or signing**. The server must never see a private key, mnemonic, or wallet file.
- **Composites that depend on a remote service**. Composites must stitch only what this server already exposes (daemon reads + bundled docs).
- **Telemetry/analytics by default**. Adding metrics requires explicit opt-in env vars, documented destinations, and a per-host disclosure string.
- **Auto-update behaviors** that rewrite or download docs at runtime. The bundled index ships immutable per-release.

---

## Why the boundary lives here, not in the README

A README is read by users. A `safety-boundary` resource is read by agents at runtime. Neither is read by the contributor writing the next change. This doc is the artifact a maintainer points at when declining a "let's just add transfer behind a flag" diff before committing it to main. It is referenced from `README.md`, `docs/mcp-agent-ready-evidence.md`, and `docs/agent-utility-improvements.md` so the boundary is discoverable from every entry point.

---

## Moving the boundary

The boundary can move when **all** of the following are true:

1. **Host UX is ready.** Cursor, Claude Desktop, or OpenCode gains per-tool approval with a strong-enough confirmation surface that a one-character autocomplete cannot trigger an outbound transfer. ("Approve all" for read-only tools is fine and already supported via `readOnlyHint`. Approving destructive tools must require an explicit gesture per call.)
2. **A new annotation block exists.** Write tools MUST use the inverse annotation block (`readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false`) so the host can render a distinct hazard treatment. The `readOnly()` helper in `src/server.ts` cannot be reused; a parallel `destructive()` helper is required.
3. **A runtime env flag opts in.** Write tools MUST require an explicit env var (proposed: `DERO_MCP_ENABLE_WRITES=true`). The default install path must remain read-only.
4. **A dedicated tool filter test exists.** A flow test MUST assert that without the env flag set, calling any write tool returns a structured error with `code: TOOL_DISABLED` and an actionable hint.
5. **Decision-log entry merged first.** This document gains a new section ("Boundary change YYYY-MM-DD") describing the trigger, the new posture, the rollback plan, and the host UX evidence cited.
6. **Major version bump.** Adding write capability is a breaking shift in the agent contract and the safety surface; `0.2.0` is the floor.

These are AND conditions. Failing any one of them is a hard block.

---

## What is intentionally NOT covered here

This doc covers the agent-facing contract of this MCP server. It does NOT cover:

- The DERO chain's own privacy model — see [`derod`](https://derod.org) docs.
- Wallet tooling — handled by Engram/XSWD/curl flows external to this server.
- TELA app deployment — handled by `tela-cli` and the TELA publisher tooling.
- DeroPay payment-processor patterns — see `pay.derod.org`.

If a client wants any of the above, point them at the relevant external tool. This server stays in its lane.

---

## References

- `README.md` — user-facing posture statement.
- `docs/mcp-agent-ready-evidence.md` — baseline evidence (smoke probes, flow tests, doctor).
- `docs/agent-utility-improvements.md` — planning artifact for the utility cycle (Phase A/B/C).
- `docs/composites.md` — design contract for composite tools that compose primitives.
- `src/server.ts` — `READ_ONLY_ANNOTATIONS` constant + `readOnly()` helper.
- `src/citations.ts` — `RELATED_DOCS_BY_TOOL` curated map (no remote calls).
- `dero://mcp/safety-boundary` — runtime MCP resource summarizing the same boundary for agents.
- AI Agent Ready playbook: [`remix/14-competitive-mcp-shape-parity-and-composites.md`](../../../docs/AI%20Agent%20Ready/remix/14-competitive-mcp-shape-parity-and-composites.md).
