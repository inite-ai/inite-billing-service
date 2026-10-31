#!/usr/bin/env bash
# Applies docs/catalog/family-subscriptions-2026-10.json to production billing,
# by hand, after the billing release that carries this file is deployed.
#
#   scripts/catalog/apply-family-subscriptions.sh            dry run (rolled back)
#   scripts/catalog/apply-family-subscriptions.sh --apply    commit
#
# Run from a checkout of this repo at the deployed commit. Nothing is copied
# onto the host: the catalogue and apply-family-subscriptions.js go over ssh on
# stdin to `node -` inside the inite-billing-service container, which uses
# billing's own Prisma client and DATABASE_URL.
#
# Every run first saves the rows it may touch (services without their keys,
# products, prices) to /root/billing-catalog-backup-<UTC time>.json on the
# host, mode 600, and stops if that fails. The apply is one transaction:
# all or nothing. It prints only `code | type | active | amount | currency`.
set -euo pipefail

HOST="${BILLING_HOST:-root@143.198.50.15}"
CONTAINER="inite-billing-service"
MODE="dry-run"
case "${1:-}" in
  --apply) MODE="apply" ;;
  ""|--dry-run) MODE="dry-run" ;;
  *) echo "usage: $0 [--dry-run|--apply]" >&2; exit 2 ;;
esac

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CATALOG="$HERE/../../docs/catalog/family-subscriptions-2026-10.json"
JS="$HERE/apply-family-subscriptions.js"
[ -f "$CATALOG" ] && [ -f "$JS" ] || { echo "run from a checkout of inite-billing-service" >&2; exit 2; }

payload() {
  printf 'globalThis.CATALOG = '
  cat "$CATALOG"
  printf ';\nglobalThis.MODE = %s;\n' "'$1'"
  cat "$JS"
}

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP="${BILLING_BACKUP_DIR:-/root}/billing-catalog-backup-${STAMP}.json"

# 1. Backup. Written to a .part file first and renamed only when node exits 0
#    and the file is not empty, so a half backup never looks like a whole one.
payload backup | ssh "$HOST" "set -eu; umask 077; \
  docker exec -i -w /app $CONTAINER node - > '$BACKUP.part'; \
  test -s '$BACKUP.part'; chmod 600 '$BACKUP.part'; mv '$BACKUP.part' '$BACKUP'"
echo "backup: $HOST:$BACKUP (mode 600)" >&2

# 2. Apply, or a dry run that rolls back.
payload "$MODE" | ssh "$HOST" "docker exec -i -w /app $CONTAINER node -"
