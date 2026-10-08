#!/bin/bash
# Uso: run.sh <db> <archivo.sql> [args psql]   (ON_ERROR_STOP)
PSQL=${PSQL:-/usr/local/lib/python3.12/dist-packages/pgserver/pginstall/bin/psql}
PGARGS=${PGARGS:--h /tmp/pgt/data -U postgres}
$PSQL $PGARGS -d "$1" -v ON_ERROR_STOP=1 -q -f "$2" "${@:3}" 2>&1
