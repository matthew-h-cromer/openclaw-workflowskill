#!/usr/bin/env bash
set -euo pipefail

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

# Workspace personality / state / runs / skills
rm -rf "$OPENCLAW_DIR/workspace/personality" \
       "$OPENCLAW_DIR/workspace/state" \
       "$OPENCLAW_DIR/workspace/workflow-runs" \
       "$OPENCLAW_DIR/workspace/skills"
ok "Removed workspace personality, state, workflow-runs, skills"

# Cron
rm -rf "$OPENCLAW_DIR/cron"
ok "Removed cron directory"

# Config backups
rm -f "$OPENCLAW_DIR"/*.bak "$OPENCLAW_DIR"/*.backup
ok "Removed config backups"

# Update-check cache
rm -f "$OPENCLAW_DIR/update-check.json"
ok "Removed update-check cache"

# Canvas
rm -rf "$OPENCLAW_DIR/canvas"
ok "Removed canvas"

# Extensions (remove all installed plugins so there are no stale references)
rm -rf "$OPENCLAW_DIR/extensions"
ok "Removed extensions directory"

# Remove stale plugins.load.paths from config so the gateway doesn't try to
# load leftover dev symlinks or old npm installs
if [ -f "$OPENCLAW_DIR/openclaw.json" ]; then
  # Use node to strip the key in-place (available anywhere Node is installed)
  node -e "
    const fs = require('fs');
    const path = '$OPENCLAW_DIR/openclaw.json';
    const cfg = JSON.parse(fs.readFileSync(path, 'utf8'));
    if (cfg.plugins) delete cfg.plugins['load.paths'];
    fs.writeFileSync(path, JSON.stringify(cfg, null, 2) + '\n');
  " 2>/dev/null || true
  ok "Cleared plugins.load.paths from openclaw.json"
fi

echo -e "${YELLOW}    (Kept: openclaw.json, auth-profiles.json, identity/, devices/, completions/)${RESET}"
echo -e "${YELLOW}    Install the plugin fresh: openclaw plugins install openclaw-workflowskill${RESET}"

# ---------------------------------------------------------------------------
# 3. Start gateway (foreground — Ctrl+C to stop)
# ---------------------------------------------------------------------------
echo -e "\n${CYAN}${BOLD}==> Starting OpenClaw gateway  ${YELLOW}(Ctrl+C to stop)${RESET}\n"
exec openclaw gateway
