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
| `GET context`                               | Cuenta, proceso operativo validado y reloj del servidor; sin parámetros ni caché               |
| `GET agenda?date=YYYY-MM-DD`                | Agenda, hasta 100; para más, listado paginado                                                  |
| `GET ?from=...&to=...&page=1&limit=25`      | Rango obligatorio, máximo 93 días y 100 filas por página                                       |
| `GET :id`, `GET :id/history?page=1`         | Detalle e historial paginado                                                                   |
| `GET :id/people?kind=TEACHER`               | Catálogo mínimo de personas para un parte autorizado                                           |
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

### Contexto operativo para frontend

`GET /api/class-session-records/context`, roles explícitos administrador/monitor/supervisor, devuelve exactamente `{accountId,process,serverNow}`: ID UUID de la cuenta validada, esquema académico seleccionado y reloj PostgreSQL ISO UTC. Usa `records.context` y `records.now`, no datos aportados por el navegador, con `Cache-Control: private, no-store`. No admite parámetros; `x-schema` sigue prohibido. Rechaza cuenta desactivada, rol no operativo, proceso no académico o JWT de otro proceso.

Es imprescindible porque `/auth/user-info` no expone proceso y el JWT administrador está firmado para `core_schema`, mientras sus partes pertenecen a `runtime.schemaRouting.adminSchema`. El cliente no debe deducir ese proceso desde el token ni recibir facultad para elegirlo: consulta este endpoint antes de crear la clave de caché cuenta/proceso y usa `serverNow` para calibrar el reloj, manteniendo al servidor como autoridad del cierre. No cambia el contrato de autenticación ni otorga recursos adicionales.

El [harness local de navegador](../test/records-browser.md) ejercita los controladores reales, cookie/JWT/guards/contexto y GCS emulado, sin OAuth ni rutas de prueba en módulos productivos.

### Precondiciones de proceso y cuenta, no selectores

Todas las lecturas y escrituras de `/class-session-records` y `/class-session-files` aceptan dos headers opcionales, independientes:

- **`X-Class-Session-Context`**: `process` devuelto por `GET /class-session-records/context`, comparado exactamente con el proceso ya seleccionado en `RequestContext.routing` para el rol autenticado.
- **`X-Class-Session-Account`**: `accountId` del mismo endpoint, comparado exactamente con `principal.userId` autenticado por JWT y cuenta vigente, nunca con un ID elegido por el navegador.

Un guard compartido comprueba ambos antes de interceptores de archivos, controladores o consultas operativas. Ningún header escoge un cliente Prisma, cuenta/actor, otro esquema ni modifica el runtime. `x-schema` permanece prohibido y no cambia su semántica.

Si cualquiera de los headers está presente y no coincide (incluidos vacío o valores múltiples), devuelve **409** con `code: "CLASS_SESSION_CONTEXT_CHANGED"` y mensaje de actualización de contexto, sin leer ni mutar partes/archivos. La autenticación, rol, mantenimiento y cuenta activa siguen siendo requisitos previos; los headers no los sustituyen. Si se omiten, conserva compatibilidad con clientes existentes, que no obtienen esta protección frente a contexto obsoleto.

**Única excepción: `GET /class-session-records/context`**, que ignora ambos headers para recuperar la identidad operativa vigente aun si cambió la cuenta o el proceso. No acepta parámetros de selección. CORS autoriza ambos headers únicamente para el origen frontend ya configurado.

Motivo: el JWT administrador sigue siendo válido en core mientras el runtime puede cambiar de proceso entre consultar contexto y operar sobre un ID que también existe en otro esquema. El frontend debe enviar la precondición en todas las operaciones de partes/evidencias salvo `/context`, incluidos GET y descarga; ante ese 409, actualizar contexto, cancelar/invalidar la caché anterior y conservar el borrador identificado con su proceso original, **sin reintentar la escritura sobre el nuevo proceso**. Así una respuesta de otro proceso tampoco cae en una clave de caché antigua. No evita ni pretende revertir una petición ya ejecutada antes de que el proceso cambie.

El mismo problema ocurre si otra pestaña cambia la cookie de cuenta dentro del mismo proceso: dos administradores pueden tener acceso al mismo parte y una intención anterior no debe ejecutarse con el actor nuevo. Enviar también la cuenta esperada vincula cada petición al contexto de su borrador/caché. Ante 409 de cuenta, conservarlo bajo cuenta/proceso originales y no trasladarlo ni reintentarlo con la nueva identidad. La precondición no revoca ni cancela una petición que ya fue autenticada y empezó antes del cambio de cookie.

### Catálogos autorizados

Los listados generales `/teachers`, `/teachers/search`, `/monitors`, `/monitors/search` y `/classes` no declaran acceso directo de monitor/supervisor: sus GET dependen de permisos de BD que no deben suponerse ni ampliarse para partes. `/monitors/:userId/teachers` sí comprueba el recurso, pero solo devuelve docentes del horario semanal de ese monitor, no todos los posibles reemplazantes. `/hour-sessions` ya permite monitor/supervisor y administración; administración conserva los catálogos generales de aulas/bloques para recuperaciones.

`GET /class-session-records/:id/people` es específico de partes, con permiso `class-session-records.people` y acceso explícito administrador/monitor/supervisor. Reutiliza cuenta activa, JWT, selección del proceso y autorización del parte; otro monitor/supervisor recibe 404, docente/coordinador siguen prohibidos aun con permisos globales. No acepta `schema`, `courseId` ni otros filtros de catálogos generales.

No requiere migración ni sincronizar/ampliar permisos de los catálogos generales.

- `kind` obligatorio: `TEACHER` o `MONITOR`.
- `search` opcional, hasta 100 caracteres; busca sin distinguir mayúsculas en nombre, apellido o correo operativo.
- `page` desde 1, `limit` por defecto 25 y máximo 100; orden estable por ID ascendente.
- Docentes activos exclusivamente del curso fotografiado en el parte; monitores activos del mismo proceso. Se incluyen titulares para seleccionar efectivos, no solo reemplazantes.
- Respuesta exacta: `{ "data": [{ "id": "UUID de Teacher/Monitor", "name": "Nombre Apellido", "email": "correo operativo" }], "total": 1, "page": 1, "limit": 25 }`. `name` puede ser vacío si no hay perfil; usar el correo como etiqueta alternativa. No se exponen cuenta de usuario, teléfono, DNI, correo personal, credenciales ni perfil completo.
- Consultar no modifica versión ni reabre plazos. Los anulados solo son consultables por administración. El catálogo **no promete disponibilidad** ni autoriza cobertura: las escrituras existentes revalidan curso, actividad, cobertura y conflictos de horario en su transacción.

### Contrato JSON consumido por frontend

Las respuestas son directas, sin envoltorio global. Salvo reportes, los campos son `camelCase`. IDs de partes/coberturas/habilitaciones/revisiones/alertas/eventos son enteros; personas, cuentas, aulas, archivos y operación masiva usan UUID string; curso/turno/área/bloque horario son enteros. Los instantes se serializan ISO UTC; `date`, `startsOn` y `endsOn` también salen como ISO a medianoche UTC aunque las peticiones usan `YYYY-MM-DD`: extraer la fecha académica antes de formatear, sin desplazarla al día anterior en Lima.

**Parte escalar** (devuelto también por `PATCH`, corrección, anulación/restauración, asociación de captura y recuperación):

- Enteros: `id`, `hourSessionId`, `shiftId`, `areaId`, `courseId`, `period`, `pedagogicalMinutes`, `version`; enteros o null: `scheduleId`, `originalRecordId`.
- UUID string: `classId`; UUID o null: `titularTeacherId`, `effectiveTeacherId`, `titularMonitorId`, `effectiveMonitorId`, `monitorAccountId`, `supervisorId`, `initialFileId`, `finalFileId`.
- ISO string: `date`, `scheduledStart`, `scheduledEnd`, `shiftEnd`, `editDeadline`, `createdAt`, `updatedAt`; ISO o null: `actualStart`, `actualEnd`, `initialAssociatedAt`, `finalAssociatedAt`, `deletedAt`.
- String: `origin` (`REGULAR/RECOVERY`), `teachingStatus` (`UNCONFIRMED/TAUGHT/NOT_TAUGHT/INTERRUPTED`), `titularOutcome` (`UNKNOWN/PRESENT/ABSENT/PLANNED_REPLACEMENT`); string o null: `incidents`, `deletionReason`.
- JSON: `snapshot`, `effectiveSnapshot`, `timingPolicy`; JSON o null: `initialAssociatedBy`, `finalAssociatedBy`, `deletedBy`.
- `snapshot`: `className`, `area`, `shift`, `course`, `teacher`, `monitor`; personas fotografiadas con `{id,email,name}` (recuperaciones pueden conservar además `userId`). `effectiveSnapshot` tiene claves `TEACHER`/`MONITOR` cuando se declaran, con `{id,userId,email,name}` o null. No confundir fotografía histórica con catálogo actual.
- `timingPolicy`: `version`, `latenessToleranceMinutes`, `replacementWaitMinutes`, `alertThresholdMinutes`, `continuityGapMinutes`; parámetros numéricos o null.

**Listado/agenda**: `{data,total,page,limit}`. Cada fila es el parte escalar más `coverages` (solo `PENDING/AUTHORIZED`), `reviews` (última, array de 0/1), `completeness` (`COMPLETE/INCOMPLETE`) y `reviewStatus` (`PENDING/CONFORMING/OBSERVED`). Agenda es página 1, límite 100; no omitir paginación cuando `total > 100`. **Detalle**: parte escalar más todas las `coverages` por ID ascendente, todas las `reviews` y `grants` por ID descendente, y esos dos estados calculados. No incluye relaciones `teacher`, `class`, archivos completos ni una clasificación de puntualidad; esta última procede del reporte, no de una inferencia del cliente.

Objetos relacionados, con todos sus campos:

```text
Actor = {id,origin,email,role,schema}
Coverage = {id,recordId,kind,teacherId,monitorId,mode,status,personSnapshot,
            operationId,requestedBy,requestedAt,resolvedBy,resolvedAt,reason}
Review = {id,recordId,recordVersion,supervisorId,result,comments,files,actor,createdAt}
Grant = {id,recordId,accountId,expiresAt,reason,grantedBy,createdAt,revokedAt,revokedBy}
AuditEvent = {id,recordId,action,actor,before,after,reason,createdAt}
Alert = {id,recordId,type,supervisorId,createdAt,acknowledgedAt,acknowledgedBy}
```

Actores son JSON `Actor`; automatización usa `role:"system"`, `origin:"system"` e ID `system:class-session-records`. `Coverage.personSnapshot` es `{id,userId,email,name}`; `kind` es `TEACHER/MONITOR`, `mode` es `PLANNED/EMERGENCY`, `status` es `PENDING/AUTHORIZED/REJECTED/REVOKED`; `teacherId`/`monitorId` y resolución no aplicables son null. `Review.files` es un array `{id,generation,checksum}` de archivos disponibles fotografiados; `comments` admite null. Revocación y acuse no realizados son null.

**Historial**: array directo `AuditEvent[]`, no `{data,total}`; 50 por página, ID descendente. **Alertas**: array directo `Alert[]`, 50 por página, ID descendente; incluye acuses realizados, no trae parte incrustado ni total. `type` actual: `NO_START_CONFIRMATION`. Acusar devuelve `Alert` y es idempotente; no significa resolución del problema. **Configuración GET/PATCH**: `{id,enabled,startsOn,endsOn,latenessToleranceMinutes,replacementWaitMinutes,alertThresholdMinutes,continuityGapMinutes,version,updatedBy,updatedAt}`; no incluye `reason` ni `expectedVersion` de la petición.

**Reporte de detalle**: `{data,total,page,limit}`, filas con estas claves exactas en `snake_case`:

```text
id,date,class_id,hour_session_id,shift_id,area_id,course_id,origin,original_record_id,
snapshot,effective_snapshot,titular_teacher_id,authorized_teacher_id,
requested_teacher_id,teacher_replacement_snapshot,effective_teacher_id,
titular_monitor_id,authorized_monitor_id,requested_monitor_id,
monitor_replacement_snapshot,effective_monitor_id,teacher_replacement_mode,
teacher_replacement_authorization,monitor_replacement_mode,
monitor_replacement_authorization,scheduled_start,scheduled_end,actual_start,
actual_end,period,pedagogical_minutes,pedagogical_blocks,scheduled_minutes,
actual_minutes,actual_clock_hours,timing_policy,timing_kind,timing_classification,
arrival_delay_minutes,resumption_delay_minutes,titular_outcome,titular_absent,
teaching_status,incidents,completeness,review_status,version,deleted_at
```

Las columnas SQL `numeric` (`scheduled_minutes`, `actual_minutes`, `actual_clock_hours`, `arrival_delay_minutes`, `resumption_delay_minutes`) llegan como **string decimal**, o null si no aplica; no asumir números JSON. `pedagogical_blocks` es el entero 1 y `titular_absent` es booleano. `timing_kind`: `PENDING/ARRIVAL/RESUMPTION/CONTINUATION/UNCONFIGURED`; clasificación: `PENDING/LATE/ON_TIME/CONTINUATION/UNCONFIGURED`. Las personas/coberturas ausentes son null. No contiene evidencias ni `editDeadline`.

**Resumen**: objeto directo `{records,absent_blocks,absent_teacher_days,authorized_replacement_blocks,executed_replacement_blocks,pending_replacement_blocks,late_arrivals,late_resumptions,incident_records,incomplete_records,pending_reviews,scheduled_minutes,actual_minutes,actual_clock_hours}`. Aquí los conteos y sumas son números JSON; `scheduled_minutes` es 0 sin filas, `actual_minutes`/`actual_clock_hours` pueden ser null sin intervalos reales. No calcular totales desde una página del detalle.

**Archivo subido**: `{id,recordId,bucket,objectName,generation,originalName,contentType,size,checksum,uploadedBy,uploadedAt,status,deletedAt,deletedBy,deletionReason}`. Éxito devuelve `status:"AVAILABLE"`, `generation` string exacta y `checksum` SHA-256; no incluye URL pública ni cambia versión. `GET :fileId/content` devuelve binario PNG autenticado, no JSON. Asociación devuelve el parte escalar actualizado; usar esa versión para la siguiente mutación.

### Escrituras, versiones y cierre

- `expectedVersion` es entero obligatorio en edición/asociación/corrección/anulación/restauración/revisión/habilitación/resolución/revocación. Conflicto de versión devuelve 409: recargar y conservar el borrador; no reintentar silenciosamente.
- Edición/asociación/anulación/restauración/corrección y cada cobertura creada/resuelta incrementan la versión del parte. Subida, revisión, habilitación/revocación y acuse **no** la incrementan. Después de cobertura se debe invalidar detalle/listado: su respuesta es `{operationId,data:Coverage[]}`, no partes actualizados. Resolver devuelve `Coverage`; habilitar/revocar devuelve `Grant`; revisar devuelve `Review`.
- Ordinaria: monitor de la cuenta fotografiada (y administración según controladores), bloque iniciado, no anulado y reloj **estrictamente anterior** a `editDeadline`, o habilitación no revocada con `expiresAt > reloj` de esa misma cuenta y parte. Una habilitación no concede lectura a otra cuenta, ni sustituye el cierre original.
- Supervisor solo revisa su recurso; revisión explícita `confirmed:true`, versión vigente, independientemente del cierre ordinario. Administración no sustituye esa revisión. Resolución de cobertura y acuse tampoco dependen del plazo de edición del monitor.
- Monitor solicita exclusivamente emergencia y recibe `PENDING`; administración crea `AUTHORIZED` para `PLANNED/EMERGENCY`. Solo `PENDING -> AUTHORIZED/REJECTED` o `AUTHORIZED -> REVOKED`. Seleccionar un efectivo distinto del titular exige cobertura `PENDING/AUTHORIZED` de la misma persona y tipo; no se asigna efectivo al solicitar/autorizar. Docente efectivo activo y del curso; monitor efectivo activo.
- `actualStart/actualEnd` admiten null; fin no anterior al inicio ni hechos futuros. `UNCONFIRMED` no acredita ausencia. Anulación no equivale a falta. Motivo administrativo obligatorio (3–2000 caracteres); no se amplía el horario semanal.
- Subida multipart ordinaria usa exactamente `file` (no `archivo`), sin otros campos; extraordinaria usa `file` y `reason`. Subida y asociación son operaciones separadas con revalidación de plazo; no mostrar una subida huérfana como captura registrada.

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

Adición del catálogo para frontend (2026-10-29): `typecheck`, lint completo, build y `test:records` correctos en `compose.records.yaml` con Node 24; **63 pruebas del módulo** pasan. Las tres nuevas regresiones cubren selección mínima/curso/actividad/búsqueda/paginación, rol/recurso/proceso sin permisos generales y validación/cierre/anulación sin mutaciones de lectura. Se confirmó también la serialización decimal del reporte detallado. No se volvió a ejecutar la regresión completa de la rama ni la imagen de producción para esta adición.

Verificación de integración frontend (2026-10-29, posterior): contexto y precondiciones de proceso/cuenta cubiertos en **68 pruebas del módulo**. Lint, typecheck y build correctos; `test:records:all` completo pasa: **156 pruebas** (6 de aprovisionamiento +150 de regresiones), con14 omisiones explícitas (11 comparativas V0 +3 smoke opt-in). Smoke aislado del harness: **3/3**, incluido retraso de respuesta después de una subida real. Frontend verificado con navegador Chromium contra Nest/PostgreSQL/GCS locales; evidencia y reproducción en `frontend/docs/partes.md`. No se repitió la construcción de imagen de producción ni se validaron credenciales/IAM productivos.

Contexto y harness de navegador (2026-10-29): el endpoint añade dos regresiones de cuenta/rol/proceso/reloj/caché y cuenta inactiva; `test:records` pasa **65/65**. El smoke independiente del harness pasa **2/2**, incluidas barreras de entorno/destino y recorridos reales con cookie, CORS/CSRF, archivos/GCS, revisión tras cierre, cobertura, conflicto, habilitación, mantenimiento y cambio de proceso administrativo sin cambiar el JWT core.

También pasan typecheck, lint completo y build. El runner Node permanente se comprobó por HTTP desde el host y con parada SIGTERM real: Nest/pools cerrados y los tres esquemas aleatorios propios retirados; el servidor se reinicia con fixtures nuevos para la revisión de navegador. Sin cambios ni arranque del frontend.

Precondición de proceso (2026-10-29): `test:records` pasa **66/66**; smoke del harness **2/2**, comprobando el cambio de runtime administrador con IDs coincidentes, ausencia de consultas/mutaciones operativas con contexto obsoleto, protección de todas las rutas de evidencias, recuperación de `/context`, compatibilidad sin header y preflight CORS.

Precondición de cuenta (2026-10-29): `test:records` pasa **68/68**, incluyendo dos administradores con mismo rol/proceso y cambio monitor/administración sin lectura, subida, asociación ni mutación con cuenta esperada anterior; actor auditado de la cuenta correcta. Smoke **2/2** con cambio real de cookie y preflight de ambos headers, typecheck, lint y build correctos.
