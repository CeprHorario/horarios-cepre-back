# Preparación y verificación local · BE-04 / V-01–08

Documento en curso,2026-11-04. **No es autorización ni evidencia de despliegue.**
Contrato de ejecución en `/home/joel/.opencode/plan/cepr-finalizacion-autonoma/`;
08-PROGRESO es el estado canónico,10-TRASPASO el punto de reanudación.

## Entorno separado

Desde `backend/`, usar un nombre Compose que no pertenezca a otro trabajo.
Esta ejecución creó `cepr-finalizacion-local` y su volumen nuevo; no publica DB/GCS.
Nunca reutilizar dumps, bases, cookies ni credenciales reales.

```sh
docker compose -p cepr-finalizacion-local -f compose.records.yaml up -d db gcs
docker compose -p cepr-finalizacion-local -f compose.records.yaml run --rm --no-deps backend npm run prisma:validate
docker compose -p cepr-finalizacion-local -f compose.records.yaml run --rm --no-deps backend npm run prisma:generate
docker compose -p cepr-finalizacion-local -f compose.records.yaml run --rm --no-deps backend npm run typecheck
docker compose -p cepr-finalizacion-local -f compose.records.yaml run --rm --no-deps backend npm run lint
docker compose -p cepr-finalizacion-local -f compose.records.yaml run --rm --no-deps backend npm run build
docker compose -p cepr-finalizacion-local -f compose.records.yaml run --rm --no-deps backend npm run test:records:all
docker compose -p cepr-finalizacion-local -f compose.records.yaml run --rm --no-deps backend npm run test:records:volume
```

El runner crea una base aleatoria y retira exclusivamente la suya al finalizar;
primero aprovisiona el catálogo público. Las suites directas sin ese catálogo no
son equivalentes. No ejecutar `down -v`, prune ni borrar volúmenes ajenos.

## Harness de navegador propio

Crear un override propio como el de esta ejecución (no cambiar el override3000
del usuario). En backend, `compose.records.yaml` más:

```yaml
services:
  backend:
    command: [node, test/records-browser.cjs]
    environment:
      RECORDS_BROWSER_HARNESS: serve
      RECORDS_BROWSER_FRONTEND_ORIGIN: http://127.0.0.1:5189
      RECORDS_BROWSER_FINALIZATION: '1'
    ports: ['127.0.0.1:3109:3000']
```

Conservar el healthcheck de `test/compose.records.browser.yaml`, que consulta
`http://127.0.0.1:3000/__test/fixtures` dentro del contenedor. Esperar salud antes
del navegador. El override real de esta ejecución está en
`/tmp/opencode/cepr-finalizacion-20261104/compose.browser.yaml`.
`RECORDS_BROWSER_FINALIZATION=1` agrega coordinación por curso y recursos ajenos
solo al harness, sin nuevas rutas productivas ni cambios al fixture protegido.

```sh
docker compose -p cepr-finalizacion-local -f compose.records.yaml -f /tmp/opencode/cepr-finalizacion-20261104/compose.browser.yaml up -d --wait backend
docker compose -p cepr-finalizacion-local -f compose.records.yaml exec -T backend node test/finalization-seed.cjs 61
docker compose -p cepr-finalizacion-local -f compose.records.yaml exec -T backend node test/finalization-seed.cjs inspect
```

`seed` modifica únicamente la semana sintética del proceso aleatorio conocido;
prepara cargas coherentes y candidatos. `inspect` es solo lectura y permite
comparar cargas con conteos SQL. No ejecutar durante otra suite mutante. Los
controles del harness exigen Host loopback; usar `exec`, no una llamada al servicio
DNS desde otro contenedor. Cambiar de proceso/rol siempre con controles sintéticos.

Al reiniciar solo este backend se recrean sus fixtures y se retiran sus esquemas
previos. Antes de reiniciar comprobar que no haya test/subida propios en curso.
No detener servidores o puertos ajenos. Al concluir, detener solo este servicio
con el mismo nombre Compose y override; SIGTERM conserva la limpieza del harness.

## Preparación operativa, sin ejecutarla en entornos reales

Orden existente: configurar variables por nombre; generar Prisma; migrar tablas
globales con `npm run drizzle:migrate`; compilar; ejecutar el runner académico
`npm run prisma:migrate:deploy`; configurar runtime externo; iniciar aplicación.
`prisma migrate deploy` genérico **no sustituye** el registro académico por esquema;
no mezclar historiales ni cambiar migraciones/checksums antiguos.

Variables/precondiciones: `DATABASE_URL`, `DB_POOL_MAX`, `NODE_ENV`, `PORT`,
`JWT_SECRET`, `JWT_EXPIRES_IN`, `REDIRECT_FRONT`, variables Google OAuth,
ADC/proyecto Firestore y bucket privado GCS, según `.env.example` y validación.
No copiar valores secretos en documentación. Umbrales institucionales nullable se
conservan: no rellenarlos para mostrar una demo.

Comprobar `/api/health` (solo vida HTTP), sesión/contexto, runtime y conectividad
de DB/almacenamiento mediante las herramientas autorizadas de cada entorno.
El harness sustituye OAuth/Firestore/revocación distribuida por fixtures: no
acredita IAM, ADC ni credenciales productivas.

Recuperación: conservar artefacto anterior y respaldos del entorno; detener el
lote defectuoso y restaurar según su procedimiento, nunca resetear el árbol ni
«reparar» datos con clamps. Una respuesta de sustitución perdida se resuelve con
relectura, sin reenvío automático. La precondición protege contra doble carga.

## Evidencia de esta ejecución, todavía no cierre

- Baseline y logs en `/tmp/opencode/cepr-finalizacion-20261104/`.
- Nueva regresión backend:6 aprovisionamiento +208 pruebas;19 omitidas opt-in.
  Volumen ejecutado aparte:6 aprovisionamiento +2 pruebas de volumen.
  V0 externo y dumps reales están excluidos, no aprobados.
- E2:53 controles Chromium integrados; API real y conteoSQL independiente.
- [Evidencia frontend](../../frontend/docs/modernizacion/evidence/finalizacion-20261104/).
- Firefox/WebKit y lector de pantalla no disponibles: bloqueo de esos controles,
  no certificación integral ni entrega local completa.
