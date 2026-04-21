#!/usr/bin/env bash
set -euo pipefail

pnpm run check >/tmp/pi-web-check.log 2>&1 || { tail -80 /tmp/pi-web-check.log; exit 1; }
pnpm test -- packages/bridge/__tests__/ws-rpc-adapter.test.ts --reporter=dot >/tmp/pi-web-test.log 2>&1 || { tail -80 /tmp/pi-web-test.log; exit 1; }
