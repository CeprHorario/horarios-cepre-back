# Harness local para navegador — partes

**Solo pruebas locales**, separado de desarrollo y de la aplicación productiva. No iniciar frontend desde este harness.

## Arrancar desde la raíz `cepr/`

Requiere Docker y dependencias locales declaradas del backend (`npm ci` dentro de `compose.records.yaml` si faltan).

```sh
docker compose -f backend/compose.records.yaml up -d db gcs
docker compose -f backend/compose.records.yaml run --rm --no-deps backend npm run prisma:generate
docker compose -f backend/compose.records.yaml -f backend/test/compose.records.browser.yaml up -d --wait backend
```

- API: `http://127.0.0.1:3000/api`.
- `RECORDS_BROWSER_FRONTEND_ORIGIN` permite cambiar el origen del frontend manteniendo HTTP `127.0.0.1` como restricción; por defecto conserva5174. Cambiar la publicación Docker del backend no cambia su puerto interno3000.
- Frontend permitido por CORS/CSRF: **`http://127.0.0.1:5174`**, no `localhost:5174`. El puerto 5173 se reserva al túnel ajeno existente; no detenerlo ni reutilizarlo. Esta selección solo cambia el harness, no la configuración productiva.
- Fixtures y controles: `http://127.0.0.1:3000/__test/fixtures`.
- En el navegador, visitar `http://127.0.0.1:3000/__test/session?role=monitor` y después el frontend. También admite `supervisor` y `admin`.
- La sesión usa la cookie real `cepr-session`, HttpOnly, SameSite=Lax, path `/`, 8 horas. No se devuelve el JWT en JSON ni se imprime. Secreto aleatorio efímero por arranque; nunca usar estas sesiones fuera del harness.
- Frontend consulta normalmente `/api/auth/user-info`, `/api/system/status` y `/api/class-session-records/context`; no consumir controles como API productiva.
- Las escrituras con cookie requieren `Origin: http://127.0.0.1:5174` y `X-Requested-With: ceprunsa`, igual que la aplicación. Evitar herramientas que impriman encabezados de cookie o tokens.
- En toda lectura/escritura de partes y archivos salvo `GET /api/class-session-records/context`, enviar `X-Class-Session-Context` con el proceso esperado y `X-Class-Session-Account` con la cuenta esperada. Cambiar el proceso administrativo o la cookie de cuenta con `/__test/session` provoca 409 `CLASS_SESSION_CONTEXT_CHANGED` si la petición conserva el valor anterior, incluso en el mismo proceso/ID. Recuperar contexto es posible con headers antiguos; nunca repetir automáticamente una escritura con la identidad nueva. Los headers no seleccionan proceso ni actor.

## Qué se ejecuta realmente

Reutiliza `SessionFilesFixture` y la composición de `class-session-records.e2e-spec.ts`: Nest y controladores/servicios reales de auth, estado runtime, partes, archivos, aulas y bloques; JWT firmado, guards de autenticación/autorización, `RequestContext`, interceptores de esquema/errores, configuración HTTP/CORS/CSRF real, PrismaPg/PostgreSQL 18 y GCS emulado.

No importa `AuthModule` completo, ya que instalaría estrategias OAuth y clientes externos innecesarios. En su lugar registra `AuthController`, `AuthService` y los proveedores reales necesarios. Solo runtime/registro de esquemas y almacén de revocación se sustituyen por fixtures locales; permisos generales devuelven false, conservando el acceso explícito por rol. La revocación se conserva por hash en memoria para probar logout. OAuth está bloqueado con 404 y no hay estrategia ni credenciales reales de Google. Los controles no pertenecen a ningún módulo productivo.

El servidor permanente usa un proceso Node 24 normal (`test/records-browser.cjs`), no un test Jest bloqueado: así recibe SIGTERM y puede limpiar recursos. El runner usa hooks públicos de Node para resolver los dos aliases existentes y transpilar únicamente TS local con el TypeScript ya instalado; no instala dependencias ni genera artefactos productivos. Jest se usa solo para el smoke finito.

Barreras obligatorias antes de crear datos:

- `NODE_ENV=test` y `RECORDS_BROWSER_HARNESS=serve|smoke`.
- `TEST_DATABASE_URL` idéntica a `DATABASE_URL`, usuario `cepr`, host Docker `db:5432`, base exacta `cepr_records_test` de `compose.records.yaml`.
- Emulador exacto `http://gcs:4443`; nunca ADC/GCS productivo.
- Configuración Jest propia sin `setup-env.ts`: ese setup normal no puede convertir accidentalmente un entorno productivo en uno aparentemente autorizado.

El proceso escucha `0.0.0.0:3000` **dentro del contenedor** para permitir el mapeo Docker, pero únicamente se publica **`127.0.0.1:3000` en el host**. Los controles verifican Host local y rechazan orígenes ajenos/cross-site. No cambiar la publicación a `0.0.0.0` del host ni desplegar este override en servidores. DB y GCS no publican puertos al host.

## Datos ficticios

Cada arranque crea dos procesos académicos aleatorios `a`/`b` y un esquema core aleatorio de fixture, sin tocar `public`, `core_schema` real ni procesos existentes. Los mismos IDs de cuenta/persona/aula/parte pueden existir en ambos procesos intencionadamente para verificar aislamiento de caché. Administración reside en el core del fixture y su JWT declara `core_schema`; el proceso operativo procede del runtime, como en producción.

`GET /__test/fixtures` entrega origen, fecha de Lima, nombres de los procesos, IDs de escenarios/personas/aula y cuentas ficticias. Nunca entrega secretos/tokens. Los IDs cambian al reiniciar, salvo los IDs enteros de parte que empiezan desde 1 por proceso.

| Escenario               | Contenido inicial por proceso                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------- |
| `editable`              | Sin confirmar, iniciado, plazo abierto, sin evidencias                                                  |
| `evidence`              | Dictado confirmado, efectivos declarados, dos PNG guardados/asociados en GCS, revisión conforme vigente |
| `closed`                | Plazo vencido, sin habilitación; admite revisión del supervisor y corrección administrativa             |
| `pendingReplacement`    | Emergencia solicitada por monitor, PENDING; no declara ejecución                                        |
| `authorizedReplacement` | Reemplazo planificado autorizado por administración; no declara ejecución                               |
| `future`                | Bloque todavía no iniciado; edición ordinaria prohibida                                                 |

Hay un docente titular y otro reemplazante del mismo curso, monitor titular y otro monitor, supervisores propio/ajeno, docente/coordinador para accesos prohibidos y administración. Todas las direcciones usan `test.invalid` o `browser.invalid`. Las capturas son PNG sintéticos, no personas ni documentos reales. Las alertas se generan con el servicio real sobre los bloques sin inicio confirmado. Las horas son relativas al arranque: los escenarios abiertos permanecen editables aproximadamente 3,5 horas; después reiniciar para nuevos fixtures.

## Controles locales

Prefijo `/__test`, fuera de `/api`. Los POST también deben llevar los encabezados de origen/CSRF anteriores cuando hay cookie.

| Método/ruta                             | Efecto                                                                                                                                                              |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /fixtures`                         | Manifest público únicamente local, IDs ficticios                                                                                                                    |
| `GET /session?role=monitor`             | Establece cookie real; admite `monitor`, `supervisor`, `admin`, `otherMonitor`, `otherSupervisor`, `teacher`, `coordinator`                                         |
| `POST /process?process=a&audience=both` | Selecciona solo el fixture `a`/`b` para runtime; audience `admin`, `user` o `both`                                                                                  |
| `POST /maintenance?enabled=true`        | Activa/desactiva mantenimiento del runtime; `/api/system/status` y guards reales lo reflejan                                                                        |
| `POST /close?process=a&recordId=1`      | Adelanta el cierre únicamente de un ID del manifest; no concede habilitación                                                                                        |
| `POST /concurrent?process=a&recordId=1` | Corrección administrativa real, auditada, incrementa versión y provoca conflicto con borrador antiguo                                                               |
| `GET/POST /hold-upload?enabled=true`    | Arma la retención de respuesta de la próxima subida exacta `POST /api/class-session-files/records/5`; `false` desarma futuras capturas, sin liberar una ya retenida |
| `GET /held-upload`                      | `{held:false}` mientras no hay respuesta terminada retenida; `{held:true,status:201}` cuando Nest/GCS terminó correctamente y solo falta entregar la respuesta      |
| `POST /release-upload`                  | Libera la respuesta retenida una sola vez; `{released:true}` o `{released:false}` si no hay ninguna lista                                                           |

Los cambios de proceso de usuario invalidan su JWT anterior: volver a `/__test/session` para emitir cookie del proceso activo. Cambiar solo `audience=admin` no exige renovar el JWT core, pero `/api/class-session-records/context` debe devolver el nuevo proceso y el frontend debe descartar la caché anterior. Cerrar sesión usa **`POST /api/auth/logout` real**, no un login/logout productivo alternativo.

### Recibir metadata de subida después de mantenimiento

1. Con cookie monitor, armar `/__test/hold-upload?enabled=true` y subir normalmente el PNG al parte **5** desde el navegador, sin `route.fetch` ni reconstruir multipart.
2. Consultar `/__test/held-upload` hasta `held:true`. `status:201` confirma que validación, Nest, PostgreSQL y GCS ya terminaron; no se retrasó ni repitió la ejecución. Otro status conserva el error real, no elude guards.
3. Activar mantenimiento con `POST /__test/maintenance?enabled=true` y esperar el desmontaje que quiera probarse.
4. `POST /__test/release-upload` entrega exactamente la respuesta original, incluida metadata JSON, aunque el mantenimiento ahora esté activo. Después desactivar mantenimiento para continuar la prueba.

El middleware intercepta exclusivamente `res.end` de una sola petición coincidente: no lee, consume ni reenvía el multipart. Mantiene únicamente la instancia de respuesta y su callback final en memoria; controles/logs no muestran cuerpos, cookies ni tokens. No asocia automáticamente la evidencia. La retención es de un solo uso; otras rutas/partes no la consumen, y rearmar con una respuesta pendiente devuelve 409. Desconexión, liberación o cierre del harness retiran la referencia; al cerrar también se libera una respuesta lista para no impedir la limpieza. Estos controles conservan las mismas restricciones Host/origen/CSRF de los controles locales existentes.

## Smoke independiente

No necesita un frontend ni servidor permanente; crea y elimina sus propios esquemas aleatorios:

```sh
docker compose -f backend/compose.records.yaml run --rm --no-deps -e RECORDS_BROWSER_HARNESS=smoke backend node --experimental-vm-modules node_modules/jest/bin/jest.js --config test/records-browser.jest.cjs --runInBand
```

Comprueba barreras de entorno/destino; sesión/cookie; auth/status/context reales; roles y proceso administrativo distinto al JWT core; CORS/CSRF y preflight de los headers de contexto/cuenta; listado y catálogo; subida/asociación/descarga PNG en GCS; conflicto de versión; cierre; revisión de cerrado; resolución de cobertura; habilitación/revocación; corrección extraordinaria; mantenimiento; cambio de proceso con IDs coincidentes y cambio de cuenta por cookie dentro del mismo proceso, bloqueando lecturas/escrituras/evidencias con precondición antigua; logout y rechazo de OAuth/control cross-site. Incluye una prueba separada de retención de respuesta: GCS disponible una sola vez antes de mantenimiento, cliente todavía pendiente, liberación con metadata original y consumo único de la retención. El smoke no modifica fixtures de un servidor ya abierto.

## Detener y limpiar

```sh
docker compose -f backend/compose.records.yaml -f backend/test/compose.records.browser.yaml stop backend
```

SIGTERM/SIGINT cierra Nest, desconecta pools y elimina exclusivamente los tres esquemas aleatorios del propio arranque. No usar `kill -9` ni eliminar volúmenes. Los objetos GCS permanecen en buckets únicos de prueba, como en las suites existentes; no se prueba IAM ni bucket productivo. DB/GCS pueden quedar encendidos para otras verificaciones; no se detiene ni inicia frontend.

Límite deliberado: este harness verifica el flujo de partes con identidades y runtime ficticios, no OAuth, Firestore, revocación distribuida ni la aplicación completa en producción.
