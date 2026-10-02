#!/bin/sh
# Daily PostgreSQL backup for the Docker stack.
#
# - Writes a gzip-compressed plain-SQL dump with a UTC timestamp in the filename to
#   /backups (a private Docker volume that only this container mounts).
# - Writes to "<name>.part" first and renames afterwards, so an interrupted run can never
#   leave a half-written file that looks like a valid backup.
# - Deletes dumps older than BACKUP_RETENTION_DAYS, but only after a successful new dump.
# - Runs the job once at start and then every BACKUP_INTERVAL_SECONDS. This keeps the
#   schedule inside the container (no cron daemon, no host configuration), and the restart
#   policy brings it back after a reboot.
#
# Restoring is documented in docs/BACKUP-RESTORE.md. A backup is only proven once a restore
# has been tested.
set -eu

: "${POSTGRES_HOST:=postgres}"
: "${POSTGRES_PORT:=5432}"
: "${POSTGRES_DB:?POSTGRES_DB is required}"
: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${PGPASSWORD:?PGPASSWORD is required}"
: "${BACKUP_DIR:=/backups}"
: "${BACKUP_RETENTION_DAYS:=14}"
: "${BACKUP_INTERVAL_SECONDS:=86400}"

export PGPASSWORD

log() {
  # Container logs go to stdout; never print the password or the connection string.
  echo "[backup] $(date -u +%Y-%m-%dT%H:%M:%SZ) $*"
}

run_backup() {
  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  target="${BACKUP_DIR}/${POSTGRES_DB}-${timestamp}.sql.gz"

  log "dumping ${POSTGRES_DB} from ${POSTGRES_HOST}:${POSTGRES_PORT}"
  if pg_dump \
    --host="${POSTGRES_HOST}" \
    --port="${POSTGRES_PORT}" \
    --username="${POSTGRES_USER}" \
    --dbname="${POSTGRES_DB}" \
    --no-owner \
    --no-privileges \
    | gzip -9 >"${target}.part"; then
    mv "${target}.part" "${target}"
    log "wrote $(basename "${target}") ($(wc -c <"${target}") bytes)"
    # Only prune once a fresh dump exists, so a failing job never removes the last backup.
    deleted="$(find "${BACKUP_DIR}" -maxdepth 1 -type f -name "${POSTGRES_DB}-*.sql.gz" \
      -mtime "+${BACKUP_RETENTION_DAYS}" -print -delete | wc -l)"
    log "retention ${BACKUP_RETENTION_DAYS} days: removed ${deleted} old backup(s)"
  else
    rm -f "${target}.part"
    log "ERROR: pg_dump failed; keeping existing backups"
    return 1
  fi
}

log "starting: interval ${BACKUP_INTERVAL_SECONDS}s, retention ${BACKUP_RETENTION_DAYS} days"
while true; do
  # A failing run must not kill the loop: the next attempt follows after the interval and
  # the error is visible in `docker compose logs backup`.
  run_backup || log "backup attempt failed"
  sleep "${BACKUP_INTERVAL_SECONDS}"
done
