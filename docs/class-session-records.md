# Partes operativos — feat/update

## Adaptación a esta rama

Base revisada: `feat/update`, commit `dac1591`. Se conservan Node 24, Nest 12, Prisma 7.10.1, `PrismaPg`, PostgreSQL 18, el cliente generado en `src/generated/prisma` y las mejoras de seguridad/asignaciones/importaciones de la rama. No se restauraron los archivos compartidos antiguos de `main`.

- `ClassSessionRecord` / tabla `class_session_records`: **ID entero autoincremental**, excepción explícita del contrato original; único por fecha + aula + bloque, incluso anulado.
- Modelo **`File`**, delegado Prisma **`file`**, tabla física **`files`**: ID `DEFAULT uuidv7()`, como las otras entidades UUID de esta rama. No existe el modelo `SessionFile`.
- `File.recordId` es **opcional**: un archivo de otro módulo no necesita un parte. La API `/class-session-files` sigue siendo exclusivamente de evidencias y rechaza archivos sin parte o de otro parte. No se introdujo una API genérica de archivos sin política de acceso.
- Las operaciones masivas de reemplazo también generan su UUIDv7 mediante PostgreSQL. Se mantienen los UUID existentes sin convertir personas/importaciones ni tocar datos previos.
- La autenticación conserva el JWT firmado con `schema`, verificación de cuenta activa, cookies, expiración, revocación y protección de escritura existentes. No se introduce el campo antiguo `authSchema` ni se reemplaza `JwtStrategy`.
- Se reutiliza `RequestContext`; no hay cliente `default` ni una fábrica paralela. `PrismaPg` califica las consultas ORM, no el SQL crudo: las transacciones del módulo fijan `search_path` únicamente en su conexión; las vistas se consultan con esquema explícito y los triggers conservan el esquema de instalación.

## Entorno y pruebas reproducibles

Desde `backend/`, con Docker:

```sh
docker compose -f compose.records.yaml run --rm --no-deps backend npm ci --no-audit --no-fund
docker compose -f compose.records.yaml up -d db gcs
docker compose -f compose.records.yaml run --rm --no-deps backend npm run prisma:validate
docker compose -f compose.records.yaml run --rm --no-deps backend npm run prisma:generate
docker compose -f compose.records.yaml run --rm --no-deps backend npm run typecheck
docker compose -f compose.records.yaml run --rm --no-deps backend npm run lint
docker compose -f compose.records.yaml run --rm --no-deps backend npm run build
docker compose -f compose.records.yaml run --rm --no-deps backend npm run test:records
docker compose -f compose.records.yaml run --rm --no-deps backend npm run test:records:all
docker build --target production -t cepr-records-production .
```

`compose.records.yaml` usa PostgreSQL 18 y `fake-gcs-server:1.52.3`, sin publicar DB/GCS al host y sin reutilizar el volumen de desarrollo. El backend usa la versión Node 24 de la rama. `npm ci` instala únicamente las dependencias declaradas; no se requieren instalaciones globales.

- `test:records`: pruebas del módulo con esquemas aleatorios en la base local de pruebas; incluye PostgreSQL real, el adaptador Prisma real, JWT/guards/contexto reales y GCS emulado.
- `test:records:all`: crea una **base nueva aleatoria** en ese PostgreSQL aislado, ejecuta primero el aprovisionamiento y después las regresiones de toda la rama, habilitando asignaciones, importaciones y auditoría de seguridad. Elimina solo esa base al terminar. Rechaza un destino distinto de `compose.records.yaml`. Los artefactos de seguridad van a una carpeta temporal, no al repositorio.
- Las pruebas comparativas de `test/modules.e2e-spec.cjs` necesitan la aplicación V0 y `REFERENCE_URL`; no forman parte de este comando ni se presentan como verificadas.
- Sin las variables opt-in, Jest omite las suites de integración que requieren DB/emulador; eso no sustituye la ejecución anterior.

El despliegue completo sigue requiriendo OAuth, Firestore/runtime, ADC y datos de autorización existentes. Las pruebas sustituyen el documento runtime/registro por fixtures, no afirman haber validado las credenciales productivas. Los objetos del emulador se conservan en buckets únicos de prueba.

Para desarrollo se amplió `compose.dev.yaml` con GCS, sin sustituir el Dockerfile distroless de la rama. Para crear idempotentemente el bucket local tras levantar GCS:

```sh
docker compose -f compose.dev.yaml run --rm --no-deps backend node -e 'fetch(process.env.STORAGE_EMULATOR_HOST+"/storage/v1/b",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:process.env.GCS_BUCKET})}).then(r=>{if(!r.ok&&r.status!==409)throw new Error("GCS HTTP "+r.status)})'
```

## Creación y actualización de esquemas

En `feat/update` **ya no existe** `drizzle/sql/schema.sql`: `AdmissionsService` crea el esquema con `applyStructure` y después ejecuta `initialDataSchema` en la misma conexión/transacción. La migración aditiva `20261028000000_class_session_records` instala tablas, índices, checks, triggers y vista a través de ese mecanismo existente y su registro de checksums.

Para actualizar estructuras se conserva `npm run prisma:migrate:deploy` (usa el `deploy` de la rama); no se añade otro instalador ni se sincroniza autorización para instalar esta funcionalidad. `prisma migrate deploy` en una base nueva se prueba como segundo camino equivalente al aprovisionamiento `applyStructure`. No mezclar ambos registros de migración sobre el mismo esquema existente.

La migración aborta si hay duplicados de horario por aula/día/bloque. Se mantiene la regla previa de curso/docente/bloque. No se limpia ni reescribe información para forzar la instalación. No se ejecutó ningún despliegue sobre los esquemas actuales del usuario ni se reconstruyó `public`.

## Configuración operativa

El proceso se selecciona con `schemaRouting.adminSchema/userSchema` del runtime. Se rechaza `x-schema`; el JWT debe corresponder al proceso activo. El administrador se autentica en `core_schema` y su auditoría conserva ID, origen, correo y rol **sin FK académica local inválida**.

`GET/PATCH /api/class-session-records/configuration`, solo administración:

```json
{
  "expectedVersion": 1,
  "reason": "Activar seguimiento del proceso",
  "enabled": true,
  "startsOn": "2026-11-01",
  "endsOn": "2027-02-28",
  "latenessToleranceMinutes": null,
  "replacementWaitMinutes": null,
  "alertThresholdMinutes": null,
  "continuityGapMinutes": null
}
```

Los parámetros inicialmente nulos son pendientes institucionales, **no cinco minutos predeterminados**. La espera de reemplazo no autoriza ni acredita automáticamente una cobertura. El umbral de alerta controla la falta de confirmación de inicio; la tolerancia de llegada y el intervalo de continuidad son políticas distintas. Cada parte conserva su política aplicada y los cambios no reclasifican silenciosamente el histórico.

Activar `CLASS_RECORDS_TASK_ENABLED=true` antes de la jornada. Cada minuto se enumeran esquemas académicos registrados y habilitados, excluyendo core/public. La tarea respeta mantenimiento y requiere runtime válido; un proceso defectuoso no detiene los demás. Solo materializa bloques **futuros del día en Lima**: una caída que impide prepararlos no se soluciona reconstruyendo el pasado con el horario actual. Recuperaciones se programan explícitamente antes de su inicio, incluidos domingos, sin cambiar el horario semanal.

## API

Rutas relativas al prefijo global `/api`; Swagger utiliza la configuración y controles existentes de la rama. Cada método tiene autorización; las operaciones administrativas usan `adminOnly` y el servicio revalida el recurso. Docentes/coordinadores quedan prohibidos aun con permisos globales. El supervisor solo accede al monitor titular fotografiado al materializar, **sin filtro por turno**; el reemplazante no cambia el supervisor revisor.

Base `/class-session-records`:

| Método/ruta                                 | Uso                                                                                            |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `GET agenda?date=YYYY-MM-DD`                | Agenda, hasta 100; para más, listado paginado                                                  |
| `GET ?from=...&to=...&page=1&limit=25`      | Rango obligatorio, máximo 93 días y 100 filas por página                                       |
| `GET :id`, `GET :id/history?page=1`         | Detalle e historial paginado                                                                   |
| `PATCH :id`                                 | Registrar/corregir ordinariamente con `expectedVersion`                                        |
| `POST :id/corrections`                      | Corrección administrativa extraordinaria motivada                                              |
| `POST :id/cancel`, `POST :id/restore`       | Anulación/restauración lógica, versión y motivo                                                |
| `POST recoveries`                           | Fecha, aula, bloque, parte original, motivo                                                    |
| `POST replacements`                         | Individual/masivo: `targets[{recordId,expectedVersion}]`, `kind`, `personId`, `mode`, `reason` |
| `POST replacements/:id/resolve`             | Autorizar/rechazar pendiente o revocar autorizada, versión y motivo                            |
| `POST :id/grants`, `POST grants/:id/revoke` | Habilitar cuenta del salón hasta vencimiento, o revocar                                        |
| `POST :id/reviews`                          | Supervisor titular: versión, `CONFORMING/OBSERVED`, comentarios, `confirmed:true`              |
| `GET alerts`, `POST alerts/:id/acknowledge` | Alertas internas persistentes y acuse                                                          |
| `GET reports/detail`, `GET reports/summary` | Administración: detalle/resumen sin evidencias                                                 |

Filtros: `classId`, `teacherId` efectivo, `monitorId` titular, `shiftId`, `courseId`, `pendingReview=true`, `includeDeleted=true` solo admin. No permiten elegir otro esquema.

El cierre es **exclusivo**: al llegar a fin de turno +90 minutos ya no se permite editar ordinariamente. Reemplazos/subidas/correcciones no lo reinician. Se bloquea la fila, valida la versión y guarda modificación + auditoría atómicamente; un trigger reevalúa el reloj al escribir. La habilitación está limitada al parte/cuenta/vencimiento y no altera la lectura ni el cierre original. Restaurar o revisar no reabre.

La cobertura no acredita ejecución. Se declaran docente/monitor efectivos y resultado del titular por separado. Monitor solo solicita emergencias; administración resuelve. No se modifica `Schedule.teacherId` ni `Teacher.scheduledHours`. Un rechazo/revocación conserva el trabajo ocurrido y no libera artificialmente una persona con ejecución solapada. Para una fecha completa/múltiples aulas se envían los bloques en `targets` (hasta 200); distintos reemplazantes utilizan operaciones separadas y trazables.

Base `/class-session-files` (evidencias, no API genérica de `File`):

| Método/ruta                                         | Uso                                                        |
| --------------------------------------------------- | ---------------------------------------------------------- |
| `POST records/:recordId`                            | Multipart `file`; devuelve metadata `File` disponible      |
| `GET :fileId/content`                               | Descarga íntegra, autenticada y sin caché                  |
| `POST records/:recordId/captures/:slot`             | `initial/final`: `{fileId,expectedVersion,reason?}`        |
| `POST records/:recordId/corrections/upload`         | Administración: multipart `file` y `reason` obligatorio    |
| `POST records/:recordId/corrections/captures/:slot` | Asociación extraordinaria con versión y motivo obligatorio |

La subida ordinaria acepta PNG estático de 8 bits, no entrelazado, <=4096 px/eje, <=10 MiB y <=64 MiB descomprimidos, validando estructura/CRC. Otros módulos pueden usar `File` con sus propios tipos y políticas; no se les impone el vínculo con partes ni el límite PNG de esta API. Ampliar formatos de evidencias requiere validadores equivalentes, no confiar solo en MIME.

Subida y asociación son instantes distintos. Subir antes del cierre no habilita asociar después. PENDING/FAILED no son evidencias completas; fallos GCS/PostgreSQL pueden dejar metadata u objetos huérfanos retenidos, nunca una captura válida. Objetos únicos con precondición de no sobrescritura y generación string exacta. No hay borrado físico ni sobrescritura desde la API; las evidencias sustituidas permanecen referenciadas y protegidas por el recurso. Capturas de anulados solo se consultan como admin; restaurar es necesario para corregirlas.

## Reportes, puntualidad y límites

`v_class_session_records_report`: una fila por parte; subconsultas de una fila impiden multiplicar joins. Separación de titular, solicitado, autorizado y efectivo; solicitudes no son dictado y una ausencia no desaparece al haber reemplazo.

Mismo docente y bloques consecutivos: una llegada; otro docente: nueva evaluación. Receso prolongado: reanudación separada. Un antecedente temporalmente incompleto del mismo docente deja pendiente la continuidad; anulados no determinan el tramo. Se distinguen bloques pedagógicos, minutos y horas de reloj. No hay pagos/descuentos. La revisión es por versión y conserva archivos revisados; una modificación deja pendiente la versión nueva.

Límites deliberados: la cuenta compartida y el monitor declarado no prueban identidad física; las solicitudes de imagen/revisiones explícitas no prueban atención humana ni autenticidad. GCS productivo requiere bucket privado, ADC, red e IAM apropiados; el emulador prueba flujos, **no** firmas/IAM/seguridad de producción.

## Comprobación del plan original en esta rama

`test/class-session-records.e2e-spec.ts` y `test/session-files.e2e-spec.ts` verifican los 21 casos mínimos originales: acceso de monitor propio/ajeno; supervisor entre turnos/ajeno; prohibición docente/coordinador con permisos globales; IDs coincidentes entre esquemas; idempotencia/duplicados; antes/límite/después del cierre; habilitaciones válidas/vencidas/revocadas; auditoría atómica; concurrencia; reemplazos individuales/masivos/múltiples aulas y curso; una tardanza por tramo/cambio docente; ausencia conservada; asociación tardía; evidencias anteriores; revisión por versión; alertas idempotentes sin llenado manual; domingo; anulación/restauración; totales sin joins duplicados.

Se añadieron regresiones de UUIDv7 SQL/Prisma, `File` sin parte y su rechazo como evidencia, aislamiento con el pool real de PrismaPg, errores independientes de tareas, capturas extraordinarias motivadas, continuidad tras anular/restaurar y conflictos con ejecución conservada. Las suites preexistentes de la rama comprueban además cookies/revocación, seguridad, asignaciones y lotes.

Verificación final (2026-10-29): Prisma validate/generate, typecheck, lint completo, build, Compose y construcción de imagen distroless OK. **148 pruebas pasan**, incluidas **60 del módulo**; 11 comparativas V0 omitidas explícitamente. La imagen `cepr-records-feat-update` carga los dos módulos compilados, expone el modelo `File` (no `SessionFile`) e incluye la migración SQL. La aserción preexistente de tres rutas `schedule.delete` se contrastó con `dac1591`: existen cuatro (tres probes y la ruta real); se corrigió el test sin cambiar autorización ni horarios.
