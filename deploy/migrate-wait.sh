#!/bin/sh
set -eu

if [ "${EMBEDDED_POSTGRES:-off}" = "on" ]; then
  printf '%s\n' 'Waiting for embedded PostgreSQL to accept connections.'
  readiness_checks=0
  # Each probe waits at most one second, followed by a one-second retry delay.
  # Bound the wait to 60 probes (at most about two minutes).
  until /usr/bin/pg_isready --quiet --host=127.0.0.1 --port=5432 \
    --username=postgres --dbname=postgres --timeout=1; do
    readiness_checks=$((readiness_checks + 1))
    if [ "$readiness_checks" -ge 60 ]; then
      printf '%s\n' 'Embedded PostgreSQL readiness timed out after 60 checks; migrations were not run.' >&2
      exit 1
    fi
    sleep 1
  done
  printf '%s\n' 'Embedded PostgreSQL is accepting connections; running migrations.'
fi

# Preserve the official migration command, user, working directory, and embedded-only behavior.
exec /etc/s6-overlay/scripts/migrate.sh
