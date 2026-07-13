#!/usr/bin/env bash
# connect-agent.sh — connect a REAL external agent to a running Finality network.
#
# Any machine/agent that can reach the Finality server can use this to post an
# intent (buyer) or offer (seller) and negotiate a live deal over HTTP + WebSocket.
# It wraps @finality/reference-agent's CLI with defaults + friendly checks.
#
# Usage:
#   ./connect-agent.sh buyer  --price 20 --qty 2 --resource gpu --gpu H100
#   ./connect-agent.sh seller --price 15 --qty 2 --resource gpu --gpu H100
#
# Point at a remote server:
#   FINALITY_HTTP=http://SERVER:3001 FINALITY_WS=ws://SERVER:3002 ./connect-agent.sh buyer --price 20
#
# Notes:
#  - Buyer & seller must use the SAME resource + unit + requirements to match,
#    and buyer --price (max) must be >= seller --price (floor).
#  - Both parties must be connected to the room at the same time to close a deal,
#    so start the counterparty within the --timeout window (default 25s).
#  - --wallet must be hex (0x + hex chars). A random demo wallet is generated if omitted.
set -euo pipefail

ROLE="${1:-}"; shift || true
if [[ "$ROLE" != "buyer" && "$ROLE" != "seller" ]]; then
  echo "usage: $0 <buyer|seller> [--price N] [--qty N] [--resource gpu] [--gpu H100] [--agentId NAME] [--wallet 0x..] [--timeout MS]" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Parse the flags we add defaults for; pass everything else through untouched.
PRICE=""; QTY="2"; RESOURCE="gpu"; GPU="H100"; AGENT_ID=""; WALLET=""; TIMEOUT="25000"
PASS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --price)    PRICE="$2"; shift 2 ;;
    --qty)      QTY="$2"; shift 2 ;;
    --resource) RESOURCE="$2"; shift 2 ;;
    --gpu)      GPU="$2"; shift 2 ;;
    --agentId)  AGENT_ID="$2"; shift 2 ;;
    --wallet)   WALLET="$2"; shift 2 ;;
    --timeout)  TIMEOUT="$2"; shift 2 ;;
    *)          PASS+=("$1"); shift ;;
  esac
done

# Defaults per role.
if [[ -z "$PRICE" ]]; then PRICE=$([[ "$ROLE" == "buyer" ]] && echo 20 || echo 15); fi
if [[ -z "$AGENT_ID" ]]; then AGENT_ID=$([[ "$ROLE" == "buyer" ]] && echo "Buyer-$RANDOM" || echo "Seller-$RANDOM"); fi
# Generate a valid hex demo wallet if none given (intake requires ^0x[0-9a-zA-Z]+$; CLI requires hex).
if [[ -z "$WALLET" ]]; then WALLET="0x$(head -c20 /dev/urandom | xxd -p | tr -d '\n')"; fi

REGISTRY="${FINALITY_REGISTRY:-eip155:84532:0x8004A818BFB912233c491871b3d84c89A494BD9e}"
REQS="{\"gpu\":\"$GPU\"}"

echo "[$ROLE] resource=$RESOURCE gpu=$GPU price=$PRICE qty=$QTY agentId=$AGENT_ID"
echo "[$ROLE] server=${FINALITY_HTTP:-http://localhost:3001} ws=${FINALITY_WS:-ws://localhost:3002}"

exec npm -w packages/reference-agent --prefix "$REPO_ROOT" exec -- tsx "$REPO_ROOT/packages/reference-agent/src/index.ts" \
  --role "$ROLE" \
  --resource "$RESOURCE" \
  --unit hour \
  --price "$PRICE" \
  --qty "$QTY" \
  --terms "per-hour billing" \
  --requirements "$REQS" \
  --agentId "$AGENT_ID" \
  --wallet "$WALLET" \
  --registry "$REGISTRY" \
  --timeout "$TIMEOUT" \
  "${PASS[@]}"
