#!/usr/bin/env bash
set -euo pipefail

# Resolve the plugin repo root from the script's own location (works regardless of cwd)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors
BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
RESET='\033[0m'

step() {
  echo -e "\n${CYAN}${BOLD}==> $1${RESET}"
}

ok() {
  echo -e "${GREEN}    ✓ $1${RESET}"
}

# ---------------------------------------------------------------------------
# 1. Stop gateway + uninstall LaunchAgent
# ---------------------------------------------------------------------------
step "Stopping OpenClaw gateway"

PLIST="$HOME/Library/LaunchAgents/ai.openclaw.gateway.plist"

openclaw gateway stop 2>&1 || true

# Unregister and remove the LaunchAgent so it doesn't auto-restart
if [ -f "$PLIST" ]; then
  launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  ok "LaunchAgent uninstalled"
else
  ok "Gateway stopped (no LaunchAgent present)"
fi

# ---------------------------------------------------------------------------
# 2. Clear state
# ---------------------------------------------------------------------------
step "Clearing OpenClaw state"

OPENCLAW_DIR="$HOME/.openclaw"

# Sessions
rm -rf "$OPENCLAW_DIR/sessions"
rm -rf "$OPENCLAW_DIR"/agents/*/sessions
ok "Removed sessions"

# Memory DB
rm -f "$OPENCLAW_DIR/memory.db" "$OPENCLAW_DIR/memory.db-shm" "$OPENCLAW_DIR/memory.db-wal"
ok "Removed memory DB"

# Logs
rm -rf "$OPENCLAW_DIR/logs"
ok "Removed logs"

# Workspace personality / state / runs
rm -rf "$OPENCLAW_DIR/workspace/personality" \
       "$OPENCLAW_DIR/workspace/state" \
       "$OPENCLAW_DIR/workspace/runs"
ok "Removed workspace personality, state, runs"

# Cron
rm -f "$OPENCLAW_DIR/cron.json"
ok "Removed cron.json"

# Config backups
rm -f "$OPENCLAW_DIR"/*.bak "$OPENCLAW_DIR"/*.backup
ok "Removed config backups"

# Update-check cache
rm -f "$OPENCLAW_DIR/update-check.json"
ok "Removed update-check cache"

# Canvas
rm -rf "$OPENCLAW_DIR/canvas"
ok "Removed canvas"

echo -e "${YELLOW}    (Kept: openclaw.json, auth-profiles.json, identity/, devices/, completions/)${RESET}"

# ---------------------------------------------------------------------------
# 3. Fix extensions symlink
# ---------------------------------------------------------------------------
step "Fixing extensions symlink"

EXTENSIONS_DIR="$OPENCLAW_DIR/extensions"
SYMLINK_PATH="$EXTENSIONS_DIR/workflowskill-plugin"

mkdir -p "$EXTENSIONS_DIR"

# Remove stale symlink or directory if present
if [ -L "$SYMLINK_PATH" ] || [ -d "$SYMLINK_PATH" ]; then
  rm -rf "$SYMLINK_PATH"
fi

ln -s "$PLUGIN_ROOT" "$SYMLINK_PATH"
ok "Symlink: $SYMLINK_PATH -> $PLUGIN_ROOT"

# ---------------------------------------------------------------------------
# 4. Rebuild runtime
# ---------------------------------------------------------------------------
step "Rebuilding workflowskill runtime"

RUNTIME_DIR="$(cd "$PLUGIN_ROOT/../workflowskill/runtime" && pwd)"

if [ ! -d "$RUNTIME_DIR" ]; then
  echo "ERROR: Runtime directory not found at $RUNTIME_DIR" >&2
  exit 1
fi

(cd "$RUNTIME_DIR" && npm run build)
ok "Runtime built: $RUNTIME_DIR"

# ---------------------------------------------------------------------------
# 5. Reinstall plugin deps
# ---------------------------------------------------------------------------
step "Reinstalling plugin dependencies"
(cd "$PLUGIN_ROOT" && npm install)
ok "Dependencies installed"

# ---------------------------------------------------------------------------
# 6. Start gateway (foreground — Ctrl+C to stop)
# ---------------------------------------------------------------------------
echo -e "\n${CYAN}${BOLD}==> Starting OpenClaw gateway  ${YELLOW}(Ctrl+C to stop)${RESET}\n"
exec openclaw gateway
