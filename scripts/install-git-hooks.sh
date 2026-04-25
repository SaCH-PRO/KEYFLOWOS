#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOKS_DIR="$ROOT_DIR/.git/hooks"
PRE_PUSH_HOOK="$HOOKS_DIR/pre-push"

if [[ ! -d "$HOOKS_DIR" ]]; then
  echo "Missing .git/hooks directory. Are you inside a git repository?"
  exit 1
fi

cat > "$PRE_PUSH_HOOK" <<'HOOK'
#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel)"
cd "$ROOT_DIR"

echo "[pre-push] running repo guard..."
bash scripts/repo-guard.sh develop
HOOK

chmod +x "$PRE_PUSH_HOOK"
echo "Installed pre-push hook at $PRE_PUSH_HOOK"
