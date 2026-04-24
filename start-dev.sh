#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"

FRONTEND_SCRIPT="dev"
FRONTEND_URL="http://localhost:5173"
NETWORK_HINT="http://<your-lan-ip>:5173"

usage() {
  cat <<'EOF'
Usage:
  ./start-dev.sh [--https]

Options:
  --https    Start frontend with HTTPS dev server on port 5174.
  -h, --help Show this help message.

Notes:
  - Backend starts on http://localhost:3001
  - Frontend defaults to http://localhost:5173
  - HTTPS mode uses https://localhost:5174
EOF
}

for arg in "$@"; do
  case "$arg" in
    --https)
      FRONTEND_SCRIPT="dev:https"
      FRONTEND_URL="https://localhost:5174"
      NETWORK_HINT="https://<your-lan-ip>:5174"
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown option: %s\n\n' "$arg" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ ! -d "$BACKEND_DIR" || ! -d "$FRONTEND_DIR" ]]; then
  printf 'Expected backend/ and frontend/ under %s\n' "$ROOT_DIR" >&2
  exit 1
fi

cleanup() {
  local exit_code=$?

  trap - EXIT INT TERM

  if [[ -n "${BACKEND_PID:-}" ]] && kill -0 "$BACKEND_PID" 2>/dev/null; then
    kill "$BACKEND_PID" 2>/dev/null || true
  fi

  if [[ -n "${FRONTEND_PID:-}" ]] && kill -0 "$FRONTEND_PID" 2>/dev/null; then
    kill "$FRONTEND_PID" 2>/dev/null || true
  fi

  wait "${BACKEND_PID:-}" 2>/dev/null || true
  wait "${FRONTEND_PID:-}" 2>/dev/null || true

  exit "$exit_code"
}

trap cleanup EXIT INT TERM

printf 'Starting backend in %s\n' "$BACKEND_DIR"
(
  cd "$BACKEND_DIR"
  npm run dev
) &
BACKEND_PID=$!

printf 'Starting frontend (%s) in %s\n' "$FRONTEND_SCRIPT" "$FRONTEND_DIR"
(
  cd "$FRONTEND_DIR"
  npm run "$FRONTEND_SCRIPT"
) &
FRONTEND_PID=$!

printf '\n'
printf 'Backend:  http://localhost:3001\n'
printf 'Frontend: %s\n' "$FRONTEND_URL"
printf 'Network:  %s\n' "$NETWORK_HINT"
printf '\n'
printf 'Press Ctrl+C to stop both processes.\n\n'

wait -n "$BACKEND_PID" "$FRONTEND_PID"
