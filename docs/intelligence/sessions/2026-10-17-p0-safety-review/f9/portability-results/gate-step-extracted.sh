set -euo pipefail
RETURN=".agent-control/claude-return.yaml"
status="$(sed -n 's/^review_status:[[:space:]]*//p' "$RETURN" | head -n1 | tr -d '"')"

active_source_main="$(sed -n 's/^source_main:[[:space:]]*//p' ".agent-control/active-packet.yaml" | head -n1 | tr -d '"')"
return_source_main="$(sed -n 's/^source_main:[[:space:]]*//p' "$RETURN" | head -n1 | tr -d '"')"
expected_base="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
if [ "$active_source_main" != "$expected_base" ] || [ "$return_source_main" != "$expected_base" ]; then
  echo "::error::Non-draft impl/* PR must be revalidated against the current PR base SHA $expected_base"
  echo "::error::active source_main=$active_source_main return source_main=$return_source_main"
  exit 1
fi

case "$status" in
  READY_TO_MERGE|ACCEPT_FOR_ADMISSION)
    ;;
  *)
    echo "::error::Non-draft impl/* PR requires ChatGPT review_status READY_TO_MERGE or ACCEPT_FOR_ADMISSION; found: $status"
    exit 1
    ;;
esac
