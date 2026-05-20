#!/usr/bin/env bash
# DERO MCP Server — connectivity doctor
# Checks daemon reachability before using the MCP server.
#
# Usage:
#   ./scripts/doctor.sh                          # uses DERO_DAEMON_URL or default
#   ./scripts/doctor.sh http://127.0.0.1:10102   # explicit URL
#   DERO_DAEMON_URL=http://... ./scripts/doctor.sh

set -euo pipefail

# Default: public RPC (same as server default)
DEFAULT_URL="http://82.65.143.182:10102"

# Accept CLI arg or env var
DAEMON_URL="${1:-${DERO_DAEMON_URL:-$DEFAULT_URL}}"
DAEMON_URL="${DAEMON_URL%/}"  # strip trailing slash

echo "DERO MCP Doctor"
echo "==============="
echo "Daemon URL: ${DAEMON_URL}"
echo ""

fail=0

# Check 1: Basic TCP reachability (extract host:port)
host_port=$(echo "$DAEMON_URL" | sed -E 's|https?://||' | sed 's|/.*||')
host=$(echo "$host_port" | cut -d: -f1)
port=$(echo "$host_port" | cut -d: -f2)
if [[ -z "$port" || "$port" == "$host" ]]; then
  port=10102
fi

echo "1. TCP connectivity to ${host}:${port}"
if nc -z -w 5 "$host" "$port" 2>/dev/null; then
  echo "   OK — port reachable"
else
  echo "   FAIL — cannot reach ${host}:${port}"
  echo "   Hint: Is the daemon running? Is the port open?"
  fail=$((fail + 1))
fi

echo ""

# Check 2: DERO.Ping RPC call
echo "2. DERO.Ping RPC"
ping_response=$(curl -sS -m 10 -X POST "${DAEMON_URL}/json_rpc" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"DERO.Ping","id":1}' 2>/dev/null || echo '{"error":"curl_failed"}')

if echo "$ping_response" | grep -Eq '"status":"OK"|"result":"Pong ?"' ; then
  echo "   OK — daemon responded to ping"
else
  echo "   FAIL — DERO.Ping did not return a known success shape"
  echo "   Response: $ping_response"
  fail=$((fail + 1))
fi

echo ""

# Check 3: DERO.GetInfo (confirms chain sync)
echo "3. DERO.GetInfo RPC"
info_response=$(curl -sS -m 10 -X POST "${DAEMON_URL}/json_rpc" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"DERO.GetInfo","id":1}' 2>/dev/null || echo '{"error":"curl_failed"}')

if echo "$info_response" | grep -q '"topoheight"'; then
  topoheight=$(echo "$info_response" | grep -oE '"topoheight":[0-9]+' | grep -oE '[0-9]+')
  echo "   OK — chain topoheight: ${topoheight:-unknown}"
else
  echo "   FAIL — DERO.GetInfo did not return chain data"
  echo "   Response: $info_response"
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
