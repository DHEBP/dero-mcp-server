#!/usr/bin/env npx tsx
/**
 * DERO MCP Server — Flow Test
 * 
 * Tests the daemon RPC calls that the MCP tools wrap.
 * Run this against a live daemon (local or remote) to verify connectivity
 * and that the RPC methods return expected data shapes.
 * 
 * Usage:
 *   npx tsx scripts/flow-test.ts
 *   npx tsx scripts/flow-test.ts http://127.0.0.1:10102
 *   DERO_DAEMON_URL=http://... npx tsx scripts/flow-test.ts
 */

const DEFAULT_URL = "http://82.65.143.182:10102";

type FlowStatus = "pass" | "fail" | "skip";
type FlowResult = {
  id: string;
  name: string;
  status: FlowStatus;
  message?: string;
  durationMs: number;
};

async function deroRpc<T = unknown>(
  endpoint: string,
  method: string,
  params?: unknown
): Promise<T> {
  const res = await fetch(`${endpoint}/json_rpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "1",
      method,
      params,
    }),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from daemon`);
  }

  const data = await res.json();
  if (data.error) {
    throw new Error(`RPC error: ${JSON.stringify(data.error)}`);
  }
  return data.result;
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

async function runFlow(
  id: string,
  name: string,
  fn: () => Promise<void>
): Promise<FlowResult> {
  const start = performance.now();
  try {
    await fn();
    return { id, name, status: "pass", durationMs: Math.round(performance.now() - start) };
  } catch (error) {
    return {
      id,
      name,
      status: "fail",
      message: error instanceof Error ? error.message : String(error),
      durationMs: Math.round(performance.now() - start),
    };
  }
}

async function runAllFlows(daemonUrl: string): Promise<FlowResult[]> {
  const results: FlowResult[] = [];

  // Flow 1: Ping
  results.push(
    await runFlow("ping", "DERO.Ping — daemon reachable", async () => {
      const result = await deroRpc<string>(daemonUrl, "DERO.Ping");
      assert(result === "Pong " || result === "Pong", `Expected 'Pong', got '${result}'`);
    })
  );

  // Flow 2: Echo
  results.push(
    await runFlow("echo", "DERO.Echo — roundtrip strings", async () => {
      const words = ["hello", "dero", "mcp"];
      const result = await deroRpc<string>(daemonUrl, "DERO.Echo", words);
      assert(typeof result === "string", "Expected string response");
      assert(result.includes("DERO") || words.some(w => result.includes(w)), "Echo should contain input or DERO");
    })
  );

  // Flow 3: GetInfo
  let topoheight: number | undefined;
  results.push(
    await runFlow("get-info", "DERO.GetInfo — chain metadata", async () => {
      const result = await deroRpc<{
        topoheight?: number;
        height?: number;
        network?: string;
        version?: string;
      }>(daemonUrl, "DERO.GetInfo");
      assert(typeof result.topoheight === "number", "Missing topoheight");
      assert(typeof result.height === "number", "Missing height");
      topoheight = result.topoheight;
    })
  );

  // Flow 4: GetHeight
  results.push(
    await runFlow("get-height", "DERO.GetHeight — block heights", async () => {
      const result = await deroRpc<{
        height?: number;
        stableheight?: number;
        topoheight?: number;
      }>(daemonUrl, "DERO.GetHeight");
      assert(typeof result.height === "number", "Missing height");
      assert(typeof result.topoheight === "number", "Missing topoheight");
    })
  );

  // Flow 5: GetBlockCount
  results.push(
    await runFlow("get-block-count", "DERO.GetBlockCount — total blocks", async () => {
      const result = await deroRpc<{ count?: number }>(daemonUrl, "DERO.GetBlockCount");
      assert(typeof result.count === "number", "Missing count");
      assert(result.count > 0, "Block count should be > 0");
    })
  );

  // Flow 6: GetLastBlockHeader
  results.push(
    await runFlow("get-last-block-header", "DERO.GetLastBlockHeader — tip block", async () => {
      const result = await deroRpc<{ block_header?: { height?: number; hash?: string } }>(
        daemonUrl,
        "DERO.GetLastBlockHeader"
      );
      assert(result.block_header, "Missing block_header");
      assert(typeof result.block_header.height === "number", "Missing height in header");
    })
  );

  // Flow 7: GetBlock by height (use topoheight - 10 for safety)
  results.push(
    await runFlow("get-block-by-height", "DERO.GetBlock — fetch by height", async () => {
      const testHeight = Math.max(1, (topoheight ?? 100) - 10);
      const result = await deroRpc<{ block_header?: unknown }>(daemonUrl, "DERO.GetBlock", {
        height: testHeight,
      });
      assert(result.block_header, "Missing block_header in response");
    })
  );

  // Flow 8: GetTxPool (may be empty, just check shape)
  results.push(
    await runFlow("get-tx-pool", "DERO.GetTxPool — mempool check", async () => {
      const result = await deroRpc<{ tx_hashes?: string[] }>(daemonUrl, "DERO.GetTxPool");
      // tx_hashes may be null/undefined if empty, which is fine
      assert(
        result.tx_hashes === undefined || result.tx_hashes === null || Array.isArray(result.tx_hashes),
        "tx_hashes should be array or null"
      );
    })
  );

  // Flow 9: NameToAddress (test known name "dero" — may not exist on all networks)
  results.push(
    await runFlow("name-to-address", "DERO.NameToAddress — resolve 'dero'", async () => {
      try {
        const result = await deroRpc<{ address?: string; name?: string }>(
          daemonUrl,
          "DERO.NameToAddress",
          { name: "dero", topoheight: -1 }
        );
        // Name may not be registered, that's okay
        if (result.address) {
          assert(result.address.startsWith("dero") || result.address.startsWith("deto"), "Invalid address format");
        }
      } catch (e) {
        // Name not found is acceptable
        if (String(e).includes("NOT FOUND") || String(e).includes("not found")) {
          return;
        }
        throw e;
      }
    })
  );

  // Flow 10: GetSC — test with the name registry SCID
  const NAME_REGISTRY_SCID = "0000000000000000000000000000000000000000000000000000000000000001";
  results.push(
    await runFlow("get-sc", "DERO.GetSC — name registry contract", async () => {
      const result = await deroRpc<{ code?: string; balances?: unknown }>(
        daemonUrl,
        "DERO.GetSC",
        { scid: NAME_REGISTRY_SCID, code: true, variables: false }
      );
      assert(result.code, "Missing contract code");
      assert(result.code.includes("Function"), "Code should contain Function keyword");
    })
  );

  return results;
}

function formatReport(results: FlowResult[]): string {
  const lines: string[] = [
    "",
    "DERO MCP Flow Test Results",
    "==========================",
    "",
  ];

  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const skipped = results.filter((r) => r.status === "skip").length;

  for (const r of results) {
    const icon = r.status === "pass" ? "✓" : r.status === "fail" ? "✗" : "○";
    const status = r.status.toUpperCase().padEnd(4);
    lines.push(`${icon} ${status} ${r.name} (${r.durationMs}ms)`);
    if (r.message) {
      lines.push(`       ${r.message}`);
    }
  }

  lines.push("");
  lines.push(`Summary: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  lines.push("");

  return lines.join("\n");
}

async function main() {
  const daemonUrl = (process.argv[2] || process.env.DERO_DAEMON_URL || DEFAULT_URL).replace(/\/$/, "");

  console.log(`Testing daemon at: ${daemonUrl}`);
  console.log("");

  try {
    const results = await runAllFlows(daemonUrl);
    console.log(formatReport(results));

    const failed = results.filter((r) => r.status === "fail").length;
    process.exit(failed > 0 ? 1 : 0);
  } catch (error) {
    console.error("Fatal error:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
