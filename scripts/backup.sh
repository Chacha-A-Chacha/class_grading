#!/usr/bin/env bash
# Encrypted logical backup of the application database (specification §11).
#
# Reads DATABASE_URL from .env. Requires BACKUP_PASSPHRASE_FILE (a file holding the
# passphrase, readable only by this user). Optional: BACKUP_DIR (default
# ~/backups/class_grading), BACKUP_KEEP_DAYS (default 14) and BACKUP_REMOTE, an
# scp/rsync target such as user@host:/path, for the off-host copy the specification asks for.
#
#   BACKUP_PASSPHRASE_FILE=~/.secrets/backup.pass scripts/backup.sh
#
# Restore: openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass file:PASSFILE -in X.dump.enc | pg_restore -d URL
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
: "${BACKUP_PASSPHRASE_FILE:?Set BACKUP_PASSPHRASE_FILE to a file holding the backup passphrase.}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups/class_grading}"
BACKUP_KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
[ -r "$BACKUP_PASSPHRASE_FILE" ] || { echo "Cannot read $BACKUP_PASSPHRASE_FILE" >&2; exit 1; }

# pg_dump rejects Prisma's ?schema= parameter.
url="${DATABASE_URL%%\?*}"
umask 077
mkdir -p "$BACKUP_DIR"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
out="$BACKUP_DIR/class_grading-$stamp.dump.enc"
started=$(date +%s)
# Written to .part first, so an interrupted run never leaves a file that looks complete.
pg_dump --format=custom --compress=6 --no-owner --no-privileges "$url" \
  | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "file:$BACKUP_PASSPHRASE_FILE" -out "$out.part"
mv "$out.part" "$out"
( cd "$BACKUP_DIR" && sha256sum "$(basename "$out")" > "$(basename "$out").sha256" )
echo "Backup $(basename "$out") ($(du -h "$out" | cut -f1)) in $(( $(date +%s) - started ))s"

if [ -n "${BACKUP_REMOTE:-}" ]; then
  scp -q -o BatchMode=yes "$out" "$out.sha256" "$BACKUP_REMOTE" && echo "Copied off-host to $BACKUP_REMOTE"
fi
# Local copies older than the keep period are removed; off-host retention is managed there.
find "$BACKUP_DIR" -name 'class_grading-*.dump.enc*' -mtime +"$BACKUP_KEEP_DAYS" -delete
