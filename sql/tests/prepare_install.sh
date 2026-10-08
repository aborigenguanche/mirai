#!/bin/bash
# Genera /tmp/install_ready.sql. Si pg_trgm no existe (sandbox), omite las líneas marcadas @trgm.
PSQL=${PSQL:-/usr/local/lib/python3.12/dist-packages/pgserver/pginstall/bin/psql}
PGARGS=${PGARGS:--h /tmp/pgt/data -U postgres}
AVAIL=$($PSQL $PGARGS -d postgres -Atc "select count(*) from pg_available_extensions where name='pg_trgm'")
if [ "$AVAIL" = "0" ]; then grep -v '@trgm' "$(dirname "$0")/../INSTALL_COMPLETO.sql" > /tmp/install_ready.sql
else cp "$(dirname "$0")/../INSTALL_COMPLETO.sql" /tmp/install_ready.sql; fi
