#!/bin/bash
# Banco de pruebas completo: BD limpia → stubs de Supabase → instalador → pruebas
cd "$(dirname "$0")"; [ -z "$SKIP_ENSURE" ] && ./ensure_pg.sh
PSQL=${PSQL:-/usr/local/lib/python3.12/dist-packages/pgserver/pginstall/bin/psql}
PGARGS=${PGARGS:--h /tmp/pgt/data -U postgres}
DB=mirai_t
$PSQL $PGARGS -d postgres -q -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB" 2>/dev/null
./prepare_install.sh
./run.sh $DB stubs_supabase.sql >/dev/null || { echo "FALLO en stubs"; exit 1; }
./run.sh $DB /tmp/install_ready.sql 2>&1 | grep "ERROR:" && { echo "FALLO en install"; exit 1; }
./run.sh $DB tests.sql -o /dev/null > /tmp/tests_out.txt 2>&1
grep "ERROR:" /tmp/tests_out.txt | head -5
$PSQL $PGARGS -d $DB -Atc "select count(*) filter (where ok)||' OK / '||count(*) filter (where not ok)||' FALLAN (total '||count(*)||')' from test.results"
FAILS=$($PSQL $PGARGS -d $DB -Atc "select count(*) from test.results where not ok")
$PSQL $PGARGS -d $DB -Atc "select '  ✗ '||name from test.results where not ok"
[ "$FAILS" = "0" ] || exit 1
