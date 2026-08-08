#!/usr/bin/env bash
###############################################################################
# KEYFLOWOS nightly backup — pg_dump both databases + timestamped archive.
# Install on the VPS:  0 3 * * * /opt/keyflowos/scripts/deploy/backup.sh >> /var/log/keyflow-backup.log 2>&1
###############################################################################
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/keyflowos}"
BACKUP_DIR="${BACKUP_DIR:-$APP_DIR/backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"
KEEP_DAYS="${KEEP_DAYS:-14}"

cd "$APP_DIR"
mkdir -p "$BACKUP_DIR"

echo "[$STAMP] Starting backup..."

for DB in keyflow chatwoot; do
  docker compose --env-file .env.production -f docker-compose.production.yml exec -T db \
    pg_dump -U keyflow -d "$DB" --format=custom --compress=6 \
    > "$BACKUP_DIR/${DB}-${STAMP}.dump"
  echo "  ✓ $DB → backups/${DB}-${STAMP}.dump"
done

# Retention
find "$BACKUP_DIR" -name "*.dump" -mtime +"$KEEP_DAYS" -delete
echo "[$STAMP] Done. (kept last $KEEP_DAYS days)"
