#!/bin/bash
# Arranca el PostgreSQL de pruebas si no está activo
PSQL=/usr/local/lib/python3.12/dist-packages/pgserver/pginstall/bin/psql
if ! $PSQL -h /tmp/pgt/data -U postgres -d postgres -Atc "select 1" >/dev/null 2>&1; then
  rm -f /tmp/pgt/data/postmaster.pid /tmp/pgt/data/.s.PGSQL.5432.lock 2>/dev/null
  python3 -c "import pgserver; pgserver.get_server('/tmp/pgt/data', cleanup_mode=None)" >/dev/null 2>&1
  sleep 2
fi
