#!/usr/bin/env bash
set -euo pipefail

RUNTIME_DIR="$HOME/Documents/workflowskill/runtime"
PLUGIN_DIR="$(cd "$(dirname "$0")/.." && pwd)"
EXTENSIONS_DIR="$HOME/.openclaw/extensions/openclaw-workflowskill"
OPENCLAW_JSON="$HOME/.openclaw/openclaw.json"

# 1. Validate runtime dir
if [[ ! -d "$RUNTIME_DIR" ]]; then
  echo "Error: runtime dir not found at $RUNTIME_DIR" >&2
  exit 1
fi

# 2. Clean up any old symlink-approach leftovers
if [[ -L "$EXTENSIONS_DIR" ]]; then
  echo "Cleaning up old symlink..."
  rm "$EXTENSIONS_DIR"
fi
if [[ -e "${EXTENSIONS_DIR}.npm-backup" ]]; then
  echo "Removing npm backup..."
  rm -rf "${EXTENSIONS_DIR}.npm-backup"
fi

# 3. Build workflowskill runtime
echo "Building workflowskill runtime..."
(cd "$RUNTIME_DIR" && npm run build)

# 4. Link workflowskill runtime into plugin node_modules (if not already)
if [[ ! -L "$PLUGIN_DIR/node_modules/workflowskill" ]]; then
  echo "Linking workflowskill runtime..."
  (cd "$RUNTIME_DIR" && npm link)
  (cd "$PLUGIN_DIR" && npm link workflowskill)
else
  echo "workflowskill already linked, skipping npm link"
fi

# 5. Register local plugin with openclaw via loadPaths.
#    openclaw plugins install --link probes the target dir even though it doesn't copy anything,
#    so it fails if ~/.openclaw/extensions/openclaw-workflowskill already exists.
#    Skip registration if the path is already in loadPaths (idempotent on re-runs).
ALREADY_LINKED=$(node -e "
  const fs = require('fs');
  try {
    const cfg = JSON.parse(fs.readFileSync('$OPENCLAW_JSON', 'utf8'));
    const paths = cfg?.plugins?.load?.paths ?? [];
    console.log(paths.includes('$PLUGIN_DIR') ? 'yes' : 'no');
  } catch { console.log('no'); }
")

if [[ "$ALREADY_LINKED" == "yes" ]]; then
  echo "Plugin already registered in loadPaths, skipping"
else
  if [[ -d "$EXTENSIONS_DIR" ]]; then
    echo "Removing existing extension dir so openclaw --link probe can succeed..."
    rm -rf "$EXTENSIONS_DIR"
  fi
  echo "Registering plugin with openclaw..."
  openclaw plugins install --link "$PLUGIN_DIR"
fi

echo ""
echo "Dev setup complete. Restart the gateway to apply."
