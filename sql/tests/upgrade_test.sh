#!/bin/bash
# Simula la actualización de una BD antigua con datos y comprueba que no se pierde nada
cd "$(dirname "$0")"; [ -z "$SKIP_ENSURE" ] && ./ensure_pg.sh
PSQL=${PSQL:-/usr/local/lib/python3.12/dist-packages/pgserver/pginstall/bin/psql}
PGARGS=${PGARGS:--h /tmp/pgt/data -U postgres}
$PSQL $PGARGS -d postgres -q -c "DROP DATABASE IF EXISTS legacy" -c "CREATE DATABASE legacy"
./run.sh legacy stubs_supabase.sql >/dev/null; ./run.sh legacy legacy_schema.sql >/dev/null
./prepare_install.sh
./run.sh legacy /tmp/install_ready.sql 2>&1 | grep "ERROR:" && { echo "✗ FALLÓ la actualización"; exit 1; }
echo "✓ instalación sin errores sobre BD antigua"
./run.sh legacy /tmp/install_ready.sql 2>&1 | grep "ERROR:" && { echo "✗ FALLÓ la 2ª ejecución"; exit 1; }
echo "✓ y es idempotente (2ª ejecución sin errores)"
$PSQL $PGARGS -d legacy -Atc "select case when exists(select 1 from profiles where id='bbbbbbbb-0000-0000-0000-000000000009' and role='user') then '✓ usuario sin perfil recuperado (respaldo de auth.users)' else '✗ no se creó el perfil del usuario huérfano' end"
