#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOK_PATH="$ROOT_DIR/.git/hooks/pre-push"

cat > "$HOOK_PATH" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel)"
cd "$ROOT_DIR"

echo "[pre-push] running repo guard..."
bash scripts/repo-guard.sh develop

echo "[pre-push] running update verification gate..."
bash scripts/verify-update.sh
EOF

chmod +x "$HOOK_PATH"
echo "Installed pre-push hook with repo guard + update verification gate."
