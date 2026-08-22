#!/usr/bin/env bash
# DERO MCP Server — connectivity doctor
# Checks daemon reachability before using the MCP server.
#
# Usage:
#   ./scripts/doctor.sh                          # uses DERO_DAEMON_URL or default
#   ./scripts/doctor.sh http://127.0.0.1:10102   # explicit URL
#   DERO_DAEMON_URL=http://... ./scripts/doctor.sh

set -euo pipefail

# Default: TLS public RPC (same as server default; may be pruned)
DEFAULT_URL="https://dero.rabidmining.com"

# Accept CLI arg or env var
DAEMON_URL="${1:-${DERO_DAEMON_URL:-$DEFAULT_URL}}"

# Match the production URL contract: absolute HTTP(S), no userinfo, preserve
# query parameters, and normalize an optional trailing /json_rpc.
if ! url_output=$(node -e '
const url = new URL(process.argv[1].trim() || process.argv[2]);
if (!/^https?:$/.test(url.protocol)) throw new Error("URL must use http or https");
if (url.username || url.password) throw new Error("URL userinfo is not allowed");
url.hash = "";
let pathname = url.pathname.replace(/\/+$/, "");
if (pathname.endsWith("/json_rpc")) pathname = pathname.slice(0, -9);
url.pathname = pathname;
const display = new URL(url);
display.search = "";
const rpc = new URL(url);
rpc.pathname = `${pathname}/json_rpc`;
process.stdout.write(`${display.toString().replace(/\/$/, "")}\t${rpc.toString()}\t${url.search ? "1" : "0"}`);
' "$DAEMON_URL" "$DEFAULT_URL" 2>/dev/null); then
  echo "Invalid daemon URL: expected an absolute HTTP(S) URL without userinfo credentials."
  exit 1
fi
IFS=$'\t' read -r DISPLAY_URL RPC_URL URL_HAS_QUERY <<< "$url_output"

# ponytail: query-bearing endpoints omit whole bodies; add field-level redaction if safe partial diagnostics become necessary.
show_failure_response() {
  if [[ "$URL_HAS_QUERY" == "1" ]]; then
    echo "   Response omitted to protect daemon URL query parameters."
  else
    echo "   Response: $1"
  fi
}

echo "DERO MCP Doctor"
echo "==============="
echo "Daemon URL: ${DISPLAY_URL}"
echo ""

fail=0

# Check 1: DERO.Ping also verifies DNS, TCP, TLS, HTTP, and JSON-RPC.
echo "1. DERO.Ping RPC connectivity"
ping_response=$(curl -sS -m 10 -X POST "$RPC_URL" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"DERO.Ping","id":1}' 2>/dev/null || echo '{"error":"curl_failed"}')

if echo "$ping_response" | grep -Eq '"status":"OK"|"result":"Pong ?"' ; then
  echo "   OK — daemon responded to ping"
else
  echo "   FAIL — DERO.Ping did not return a known success shape"
  show_failure_response "$ping_response"
  fail=$((fail + 1))
fi

echo ""

# Check 2: DERO.GetInfo confirms this is a chain-aware DERO endpoint.
echo "2. DERO.GetInfo RPC"
info_response=$(curl -sS -m 10 -X POST "$RPC_URL" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"DERO.GetInfo","id":1}' 2>/dev/null || echo '{"error":"curl_failed"}')

if echo "$info_response" | grep -q '"topoheight"'; then
  topoheight=$(echo "$info_response" | grep -oE '"topoheight":[0-9]+' | grep -oE '[0-9]+')
  echo "   OK — chain topoheight: ${topoheight:-unknown}"
else
  echo "   FAIL — DERO.GetInfo did not return chain data"
  show_failure_response "$info_response"
  fail=$((fail + 1))
fi

echo ""

# Summary
if [[ "$fail" -eq 0 ]]; then
  echo "All checks passed. MCP server should work against this daemon."
  exit 0
else
  echo "${fail} check(s) failed. Fix connectivity before using MCP."
  exit 1
fi
