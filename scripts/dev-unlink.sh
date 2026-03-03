#!/usr/bin/env bash
set -euo pipefail

PLUGIN_DIR="$(cd "$(dirname "$0")/.." && pwd)"
EXTENSIONS_DIR="$HOME/.openclaw/extensions/openclaw-workflowskill"

# 1. Remove from openclaw loadPaths and config; --keep-files is critical since
#    installPath points to the local dev dir and must not be deleted
echo "Unlinking plugin from openclaw..."
openclaw plugins uninstall openclaw-workflowskill --keep-files --force

# 2. Reinstall from npm (delete stale dir first so install doesn't conflict)
echo "Reinstalling from npm..."
rm -rf "$EXTENSIONS_DIR"
openclaw plugins install openclaw-workflowskill

# 3. Restore npm workflowskill dependency
echo "Restoring npm workflowskill dependency..."
(cd "$PLUGIN_DIR" && npm unlink workflowskill && npm install)

echo ""
echo "Unlink complete. Restart the gateway to apply."
