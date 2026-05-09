#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${ROOT_DIR}/config.json"
BACKEND_DIR="${ROOT_DIR}/open_codex_web/backend"
FRONTEND_DIR="${ROOT_DIR}/open_codex_web/frontend"
BACKEND_SESSION="${BACKEND_SESSION:-ocw-backend}"
FRONTEND_SESSION="${FRONTEND_SESSION:-ocw-frontend}"

read_config() {
  node -e '
const fs = require("fs")
const file = process.argv[1]
const key = process.argv[2]
const fallback = process.argv[3] ?? ""
const config = JSON.parse(fs.readFileSync(file, "utf8"))
const value = key.split(".").reduce((current, part) => current?.[part], config)
if (value === undefined || value === null || value === "") {
  process.stdout.write(fallback)
} else if (typeof value === "object") {
  process.stdout.write(JSON.stringify(value))
} else {
  process.stdout.write(String(value))
}
' "${CONFIG_FILE}" "$1" "${2:-}"
}

if [[ ! -f "${CONFIG_FILE}" ]]; then
  echo "配置文件不存在：${CONFIG_FILE}" >&2
  exit 1
fi

BACKEND_PORT="$(read_config server.port 3001)"
FRONTEND_HOST="$(read_config frontend.host 0.0.0.0)"
FRONTEND_PORT="$(read_config frontend.port 5174)"
FREECAD_WORKSPACE_DIR="$(read_config freecad.workspaceDir)"
FREECAD_RPC_HOST="$(read_config freecad.rpcHost localhost)"
FREECAD_RPC_PORT="$(read_config freecad.rpcPort 9876)"

if [[ -z "${FREECAD_WORKSPACE_DIR}" ]]; then
  echo "config.json 缺少 freecad.workspaceDir" >&2
  exit 1
fi

stop_session() {
  local session="$1"
  if tmux has-session -t "${session}" 2>/dev/null; then
    tmux kill-session -t "${session}"
  fi
}

for session in $(tmux ls -F '#S' 2>/dev/null | grep -E '^ocw-backend($|-)|^ocw-frontend($|-)' || true); do
  stop_session "${session}"
done

tmux new-session -d -s "${BACKEND_SESSION}" -c "${BACKEND_DIR}" \
  "FREECAD_WORKSPACE_DIR='${FREECAD_WORKSPACE_DIR}' FREECAD_RPC_HOST='${FREECAD_RPC_HOST}' FREECAD_RPC_PORT='${FREECAD_RPC_PORT}' npm run dev"

tmux new-session -d -s "${FRONTEND_SESSION}" -c "${FRONTEND_DIR}" \
  "npm run dev -- --host '${FRONTEND_HOST}' --port '${FRONTEND_PORT}' --strictPort"

echo "backend:  http://localhost:${BACKEND_PORT}  tmux=${BACKEND_SESSION}"
echo "frontend: http://10.110.10.11:${FRONTEND_PORT}  tmux=${FRONTEND_SESSION}"
