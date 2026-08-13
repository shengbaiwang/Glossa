#!/usr/bin/env bash
#
# Starts an isolated Next.js server, launches the Tauri WebDriver app, then
# runs either all Tauri tests or the Vitest file filters passed to this script.
# Every process stopped here was started by this invocation.

set -euo pipefail

WEBDRIVER_PORT=4445
POLL_INTERVAL=1
TIMEOUT=300
DEV_PID=''
TAURI_PID=''
DEV_LOG=''
TAURI_LOG=''
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DOTENV="${APP_DIR}/node_modules/.bin/dotenv"
NEXT="${APP_DIR}/node_modules/.bin/next"
TAURI="${APP_DIR}/node_modules/.bin/tauri"

port_in_use() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

choose_dev_port() {
  local candidate
  for _ in $(seq 1 40); do
    candidate=$((20000 + RANDOM % 20000))
    if ! port_in_use "$candidate"; then
      printf '%s\n' "$candidate"
      return
    fi
  done
  echo 'ERROR: Could not find an unused local development port.' >&2
  exit 1
}

stop_process_tree() {
  local pid="$1"
  local child
  [[ -n "$pid" ]] || return
  for child in $(pgrep -P "$pid" 2>/dev/null || true); do
    stop_process_tree "$child"
  done
  kill -TERM "$pid" 2>/dev/null || true
}

cleanup() {
  stop_process_tree "$TAURI_PID"
  stop_process_tree "$DEV_PID"
  [[ -n "$TAURI_PID" ]] && wait "$TAURI_PID" 2>/dev/null || true
  [[ -n "$DEV_PID" ]] && wait "$DEV_PID" 2>/dev/null || true
  [[ -n "$DEV_LOG" ]] && rm -f "$DEV_LOG"
  [[ -n "$TAURI_LOG" ]] && rm -f "$TAURI_LOG"
}

show_log() {
  local label="$1"
  local file="$2"
  local matches
  matches=$(grep -Ein 'error|failed|panic|permission|webdriver' "$file" || true)
  if [[ -n "$matches" ]]; then
    echo "--- ${label} diagnostic lines ---" >&2
    printf '%s\n' "$matches" >&2
  fi
  echo "--- ${label} log (last 160 lines) ---" >&2
  tail -n 160 "$file" >&2 || true
}

wait_for_http_response() {
  local url="$1"
  local pid="$2"
  local label="$3"
  local log="$4"
  local elapsed=0 status
  while true; do
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "ERROR: ${label} exited before becoming ready." >&2
      show_log "$label" "$log"
      exit 1
    fi
    status=$(curl -s --max-time 2 -o /dev/null -w '%{http_code}' "$url" || true)
    # Any HTTP response proves the server is reachable. In particular, do not
    # reject ordinary redirects or a 404 from an app route as a readiness error.
    if [[ "$status" =~ ^[1-5][0-9][0-9]$ ]]; then
      echo "${label} responded with HTTP ${status}."
      return
    fi
    if (( elapsed >= TIMEOUT )); then
      echo "ERROR: Timed out waiting for ${label} at ${url}." >&2
      show_log "$label" "$log"
      exit 1
    fi
    sleep "$POLL_INTERVAL"
    ((elapsed += POLL_INTERVAL))
  done
}

trap cleanup EXIT INT TERM

if port_in_use "$WEBDRIVER_PORT"; then
  echo "ERROR: WebDriver port ${WEBDRIVER_PORT} is already in use; refusing to stop an unknown process." >&2
  lsof -nP -iTCP:"$WEBDRIVER_PORT" -sTCP:LISTEN >&2 || true
  exit 1
fi

DEV_PORT=$(choose_dev_port)
DEV_URL="http://127.0.0.1:${DEV_PORT}"
DEV_LOG=$(mktemp -t readest-tauri-next.XXXXXX.log)
TAURI_LOG=$(mktemp -t readest-tauri-app.XXXXXX.log)

if [[ ! -x "$DOTENV" || ! -x "$NEXT" || ! -x "$TAURI" ]]; then
  echo 'ERROR: Required project-local CLI executable is missing from node_modules/.bin.' >&2
  exit 1
fi

echo "Starting Next.js dev server at ${DEV_URL}..."
"$DOTENV" -e .env.tauri -- "$NEXT" dev --hostname 127.0.0.1 --port "$DEV_PORT" >"$DEV_LOG" 2>&1 &
DEV_PID=$!
wait_for_http_response "$DEV_URL" "$DEV_PID" 'Next.js dev server' "$DEV_LOG"

echo 'Starting Tauri app with WebDriver (no duplicate dev server)...'
TAURI_CONFIG=$(printf '{"identifier":"com.bilingify.readest.webdriver-test","build":{"beforeDevCommand":"","devUrl":"%s"},"app":{"security":{"capabilities":["default","desktop-capability","webdriver-remote"]}}}' "$DEV_URL")
"$DOTENV" -e .env.tauri -- "$TAURI" dev --features webdriver --config "$TAURI_CONFIG" >"$TAURI_LOG" 2>&1 &
TAURI_PID=$!
wait_for_http_response "http://127.0.0.1:${WEBDRIVER_PORT}/status" "$TAURI_PID" 'Tauri WebDriver' "$TAURI_LOG"

echo 'WebDriver is ready. Running Tauri tests...'
pnpm vitest --config vitest.tauri.config.mts --watch=false "$@"
