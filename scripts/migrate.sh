#!/bin/sh
set -e

INIT_MIGRATION=20260322051612_init

echo "Running database migrations..."

# `prisma db execute` reports success or failure but not rows, so each probe is
# a DO block that raises when the condition it is testing holds. Exit status is
# the answer.
probe() {
  npx prisma db execute --stdin >/dev/null 2>&1
}

# A probe that fails because the database is unreachable would be read as a
# finding below, so answer that question first and let `migrate deploy` report
# a connection problem in its own words.
if ! probe <<'SQL'
SELECT 1;
SQL
then
  echo "Database is not reachable — letting prisma migrate deploy report it."
  npx prisma migrate deploy
  echo "Migrations complete."
  exit 0
fi

# ── Refuse to run over an unfinished migration ─────────────────────────────
#
# This used to be `DELETE FROM billing._prisma_migrations WHERE finished_at IS
# NULL`, on every container start. That row is Prisma's record that a migration
# began and never finished, and deleting it tells `migrate deploy` to run the
# whole file again — over a database where some of its statements already
# applied. It also deleted the row of a migration another container was running
# at that moment, which is exactly what happens when two deploys overlap.
# Failing here instead is the point: a half-applied schema needs a person, not
# a retry.
if ! probe <<SQL
DO \$\$
DECLARE unfinished INT;
BEGIN
  IF to_regclass('billing._prisma_migrations') IS NULL THEN RETURN; END IF;
  SELECT COUNT(*) INTO unfinished
    FROM billing._prisma_migrations
   WHERE finished_at IS NULL AND rolled_back_at IS NULL;
  IF unfinished > 0 THEN
    RAISE EXCEPTION 'unfinished migrations: %', unfinished;
  END IF;
END \$\$;
SQL
then
  echo "ERROR: the migration history has an unfinished migration." >&2
  echo "" >&2
  echo "Either another deploy is migrating right now — wait for it — or one" >&2
  echo "failed partway and left the schema half-applied. Inspect it with:" >&2
  echo "" >&2
  echo "  npx prisma migrate status" >&2
  echo "" >&2
  echo "then, once you know whether its statements landed, record the answer:" >&2
  echo "" >&2
  echo "  npx prisma migrate resolve --applied   <migration_name>   # it did" >&2
  echo "  npx prisma migrate resolve --rolled-back <migration_name> # it did not" >&2
  exit 1
fi

# ── Baseline a database that predates the migration history ────────────────
#
# Only for a schema built by `prisma db push`: the tables are there, the init
# migration is not recorded, and `migrate deploy` would fail on its first
# CREATE TABLE. Both conditions are checked. Marking init applied
# unconditionally — which is what ran here on every boot — would tell an empty
# database that it already has a schema, and the service would come up against
# no tables at all.
if probe <<'SQL'
SELECT 1 FROM billing.services LIMIT 1;
SQL
then
  if ! probe <<SQL
DO \$\$
BEGIN
  IF to_regclass('billing._prisma_migrations') IS NULL THEN RETURN; END IF;
  IF EXISTS (
    SELECT 1 FROM billing._prisma_migrations WHERE migration_name = '${INIT_MIGRATION}'
  ) THEN
    RAISE EXCEPTION 'init already recorded';
  END IF;
END \$\$;
SQL
  then
    echo "Schema exists and ${INIT_MIGRATION} is already recorded — no baseline needed."
  else
    echo "Existing schema with no migration history — baselining ${INIT_MIGRATION}."
    npx prisma migrate resolve --applied "${INIT_MIGRATION}"
  fi
fi

npx prisma migrate deploy

echo "Migrations complete."
