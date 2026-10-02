# Backup job: the official PostgreSQL image, so `pg_dump` matches the server version
# exactly. Only the backup script is added, and /backups is pre-created with the right
# ownership so the named volume stays writable for the unprivileged `postgres` user.
FROM postgres:18.6-alpine

COPY deploy/backup/backup.sh /usr/local/bin/backup.sh
RUN chmod 0555 /usr/local/bin/backup.sh \
    && mkdir -p /backups \
    && chown postgres:postgres /backups

USER postgres
ENTRYPOINT ["/usr/local/bin/backup.sh"]
