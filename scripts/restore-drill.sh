#!/usr/bin/env bash
# Restore drill (specification §11, A14): restores the newest backup into a scratch
# database, compares it with the live one and reports the time against the RTO target.
#
# Requires DRILL_DATABASE_URL: an EMPTY database whose name contains "drill", owned by the
# application role. The drill refuses the live database and clears the scratch one afterwards.
#
#   BACKUP_PASSPHRASE_FILE=~/.secrets/backup.pass DRILL_DATABASE_URL=postgresql://.../class_grading_drill scripts/restore-drill.sh
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
: "${BACKUP_PASSPHRASE_FILE:?Set BACKUP_PASSPHRASE_FILE.}" "${DRILL_DATABASE_URL:?Set DRILL_DATABASE_URL to an empty scratch database.}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups/class_grading}"
live="${DATABASE_URL%%\?*}"; drill="${DRILL_DATABASE_URL%%\?*}"
db_name() { local path="${1##*/}"; echo "${path%%\?*}"; }
[ "$live" != "$drill" ] || { echo "Refusing: the drill database is the live database." >&2; exit 1; }
[[ "$(db_name "$drill")" == *drill* ]] || { echo "Refusing: the drill database name must contain 'drill'." >&2; exit 1; }

latest="$(ls -1t "$BACKUP_DIR"/class_grading-*.dump.enc 2>/dev/null | head -1)"
[ -n "$latest" ] || { echo "No backup found in $BACKUP_DIR" >&2; exit 1; }
( cd "$BACKUP_DIR" && sha256sum -c --quiet "$(basename "$latest").sha256" ) || { echo "Checksum mismatch for $latest" >&2; exit 1; }
existing=$(psql "$drill" -At -c "select count(*) from pg_tables where schemaname = 'public'")
[ "$existing" = 0 ] || { echo "Refusing: the drill database is not empty." >&2; exit 1; }

started=$(date +%s)
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:$BACKUP_PASSPHRASE_FILE" -in "$latest" \
  | pg_restore --no-owner --no-privileges --exit-on-error -d "$drill"
seconds=$(( $(date +%s) - started ))

# Row counts move while the live system runs, so a backup can trail it; the drill reports both.
query='select (select max(migration_name) from "_prisma_migrations" where finished_at is not null) as migration,
  (select count(*) from "User") as users, (select count(*) from "Attempt") as attempts,
  (select count(*) from "AttemptAnswer") as answers, (select count(*) from "ScoreRevision") as scores,
  (select count(*) from "AuditLog") as audit'
echo "Backup:   $(basename "$latest")"
echo "Restored: $(psql "$drill" -At -F ' | ' -c "$query")"
echo "Live:     $(psql "$live" -At -F ' | ' -c "$query")"
echo "Restore took ${seconds}s (target: under 3600s)"

# Leave the scratch database empty for the next drill.
psql "$drill" -q -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
echo "Drill database cleared."
