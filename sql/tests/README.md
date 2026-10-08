# Pruebas del SQL (PostgreSQL real)
- `full_test.sh`    → BD limpia + simulación de Supabase + instalador + 110 comprobaciones
                      (seguridad RLS, SM-2, sesiones, simulacro, cuenta, admin).
- `upgrade_test.sh` → actualiza una BD antigua con datos y comprueba idempotencia.
Requisitos: `pip install pgserver`. En el sandbox no existe `pg_trgm`, por eso las líneas
marcadas `-- @trgm` se omiten y `similarity()` se simula; en Supabase se ejecutan tal cual.
