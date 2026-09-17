#!/usr/bin/env bash
# pg_dump backup for AIGTM. Usage:
#   DATABASE_URL=postgres://... ./scripts/backup.sh [outdir]
# Writes <outdir>/aigtm-YYYYMMDD-HHMMSS.dump (custom format, compressed).
# Restore:  pg_restore --clean --if-exists -d "$DATABASE_URL" file.dump
# Schedule via cron/systemd; for managed Postgres rely on provider PITR too.
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
OUT_DIR="${1:-backups}"
mkdir -p "$OUT_DIR"

STAMP="$(date -u +%Y%m%d-%H%M%S)"
OUT="$OUT_DIR/aigtm-$STAMP.dump"

pg_dump --format=custom --compress=6 --file="$OUT" "$DATABASE_URL"
echo "backup written: $OUT"
