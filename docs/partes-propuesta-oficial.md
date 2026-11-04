# Partes — ejecución de la propuesta oficial

Encargo: `/home/joel/.opencode/plan/cepr-partes-propuesta-oficial.md` (2026-11-03).
Este documento distingue implementación, verificación y límites; no autoriza despliegue.

## Baseline protegido (F0)

- Backend de partida: `c33139f`; Frontend: `bb139dd`. Se conservaron todos los cambios
  previos, incluidos runtime-config y `.env.example`; no se hizo commit ni reset.
- Referencia HTML SHA-256: `f5d84474e8dcd80caec39ba8b0ba6fac1fe2ac259578e06c46369541aa4872e5`.
- Las 15 capturas oficiales y el HTML son de solo lectura. La comprobación
  `sha256sum --check docs/partes-propuesta-referencia.sha256` pasa para las 16 huellas.
- Nest 12.1.3 / Prisma 7.10.1; React 19 / Vite 6; PostgreSQL 18 y GCS emulado con
  `compose.records.yaml`. El harness permanente del usuario no se reinició.

## Mapa de impacto

- Lectura: controller → contexto/runtime → scope histórico fotografiado → workspace.
- Escritura: controller → mutate → lock del parte → scope → versión/plazo → cambio
  → revalidación → trigger → auditoría, todo en transacción.
- Capturas: validación PNG → subida privada → metadata disponible → asociación
  versionada independiente. Originales retenidos; retirada únicamente lógica.
- Habilitación/revocación: mismo lock del parte que las escrituras; cuenta concreta
  elegible, vencimiento y motivo propio en cada operación excepcional.
- La autorización de avisos no amplía los lectores de Partes. Docentes y
  coordinadores siguen prohibidos incluso con permisos globales; solo reciben
  resúmenes/avisos sin payload de la hoja.
- Los consumidores de `authorizeRecord` (archivos, seguimiento, incidencias y
  journal) conservan el filtro de recurso al ampliar supervisión.

## Estado de entrega

**Implementación funcional y portado visual verificados en el harness local;
congelada para el refactor visual posterior, no desplegada.** Los límites de
alcance/datos se declaran abajo. La referencia no se modificó.

### Completado

- Workspace A (`GET /class-session-records/workspace`) con contexto, selección,
  catálogos mínimos, filas, policy, capturas y revisión vigente; sin N+1.
  Una jornada normal usa **9 operaciones Prisma** tanto con 7 como con 105 filas.
- Miniaturas B (`GET /class-session-files/thumbnails`) por lote de 32, generación
  exacta y acceso autorizado por recurso. La derivada se genera al subir usando el
  buffer validado; si falla no invalida el PNG. Original/checksum retenidos.
- Horas, estado y observaciones se guardan por editor, sin reenviar los campos de
  otros editores; los borradores sobreviven al cierre del modal, cambio de editor,
  navegación y mantenimiento, con descarte explícito.
- Capturas: preparación local, un solo Guardar que sube y asocia, retirada lógica,
  previsualización íntegra y ampliación. La asociación revalida versión, plazo,
  sesión y generación; un fallo no produce evidencia ficticia.
- Propuesta RN/RE por correo: idempotente por actor/payload, pendiente y sin
  asignar efectivo ni confirmar dictado. Solo administración autoriza, revalidando
  disponibilidad y sin doble ocupación.
- Habilitación excepcional posterior al cierre para monitor/supervisor elegibles,
  con motivo propio por operación, vencimiento y revocación serializada; el cierre
  original permanece intacto. El servidor revalida `policy`; el navegador no decide.
- Sustitución de monitor por supervisión/administración mediante cobertura; no
  reasigna aula ni cuenta. Revocar conserva el trabajo/efectivo ya ejecutado.
- Notas privadas de jornada paginadas, editables y retirables, con autor snapshot;
  ausentes del workspace del monitor. Observaciones de clase con tipo, autor, hora
  del servidor y sin reordenamientos que generen eventos espurios.
- Avisos persistentes, deduplicados y dirigidos a administración, supervisor,
  monitor, docentes elegibles y coordinación del curso correcto. El job temporal
  es idempotente por etapa/destinatario y no infiere ausencia ni sanción.
- Listener PostgreSQL dedicado por instancia con reconexión y resync; SSE compartido
  para la campana y Partes, heartbeat de seguridad, cierre por cambio de contexto y
  fallback único. El eco propio no duplica la carga de la jornada.
- Portado oficial: tabla de siete bloques, chips, timeline exterior, fila actual,
  cuatro editores, chips de estado/cobertura, observaciones por tipo, capturas,
  visor y ayudas con popover/CSS anchors. Se midió Arial en la referencia (CDP) y
  se aplicó solo a Partes; el resto del producto conserva su tipografía.
- Acciones privadas de supervisión y administración bajo la entrada contextual
  «Más opciones»; revisión, historial y operaciones no alteran la hoja ordinaria.

### Límites declarados

- No se restauró el dump completo en staging. Se extrajeron por lista blanca y se
  anonimizaron las tablas necesarias con `test/import-parts-dump.mjs`; no se
  ejecutaron DDL, roles, contraseñas, perfiles ni objetos reales. Las identidades
  del manifest son sintéticas.
- No hay despliegue, migraciones sobre bases del usuario, OAuth/IAM productivo,
  correo/push externo ni pruebas en Firefox/WebKit.
- Los umbrales institucionales de tardanza/aviso no se inventaron. El escalado
  (`escalationDelayMinutes`) es nullable: `NULL` lo desactiva y no existe un valor
  predeterminado.
- La comparación visual es geométrica y de capturas revisadas; no es un umbral
  automático de similitud. A 1366/1440/1024/768 la fila queda a ~2,7 px de la
  referencia; a 1920 coincide. En 320 px, supervisor/administración añaden una
  fila de contexto por el acceso privado de seguimiento, una excepción funcional
  autorizada, no una diferencia de tabla.
- La suite de carreras se ejecuta con `playwright-core` gestionado en un runner de
  nodo. La CLI cerraba la sesión al retener una respuesta de subida; el runner de
  nodo verifica el retraso de red, la metadata pendiente y la ausencia de subida
  duplicada. Se declara como pase de Chromium, no de la CLI.
- El bundle principal sigue avisando por tamaño (>500 kB); es un límite previo del
  producto, no se atribuye solo a Partes.
- Las suites `modernizacion-browser` (operaciones/notificaciones/incidencias) no se
  repitieron: usan el harness permanente 3000/5174 y conservan selectores anteriores
  a la hoja oficial. La cobertura específica de Partes se migró a las seis suites
  propias; no se presenta esa regresión amplia como ejecutada en esta etapa.

## Contratos relevantes

- `GET /api/class-session-records/workspace?date=YYYY-MM-DD&classId=UUID&shiftId=N`.
  Respuesta `{context,selection,options,rows,policy,summary}`; cada fila añade
  `policy`, `initialCapture/finalCapture`, cobertura activa y revisión vigente.
  Solo S/A reciben el seguimiento privado. Solo hoy se materializa idempotentemente.
- `GET /api/class-session-files/thumbnails?refs=<JSON>`: 32 referencias máximo;
  `AVAILABLE` incluye WebP base64; `STALE/UNAVAILABLE` no incluye imagen; `no-store`.
- `POST .../captures/:slot/detach` con `{expectedVersion,reason?}`; administración
  siempre exige motivo.
- `PATCH /api/class-session-records/:id` con `{expectedVersion,classState:"RN"|"RE",
  replacementEmail,operationId,reason?}`: intención propia de Estado; reintentar la
  misma intención no duplica y otra intención con ese ID responde 409.
- Seguimiento privado: `GET/POST /monitor-observations`, `PATCH .../:id` y
  `POST .../:id/withdraw`; contexto `{date,classId,shiftId,monitorId}` y versión
  para editar/retirar. Lectura paginada de 25.
- Configuración operativa: `escalationDelayMinutes` nullable, validado 0–1440 en
  DTO y SQL; `NULL` desactiva el escalado. No se asigna un valor institucional.
- Avisos: `GET /operations/notifications/context`, lista, resolución y stream SSE
  compartido; roles de aviso incluyen docentes/coordinación sin abrir Partes.

## Verificación ejecutada

Fecha: 2026-11-03/04. Todo en el harness local aislado, PostgreSQL 18 y GCS emulado.

| Comando / prueba | Resultado |
| --- | --- |
| Backend `prisma:validate`, `prisma:generate`, `typecheck`, `lint` | Correctos |
| Backend `test:records:all` | 6 aprovisionamiento + 196 pruebas; 14 omitidas por opt-in |
| Backend `test:records:volume` (opt-in) | 2 pruebas; 64.974 partes |
| Importación anonimizada opt-in | 3 procesos; 833/616/700 partes; 0 duplicados; 700 sin supervisor en el tercero |
| Frontend `typecheck`, `lint`, `test:partes`, `build` | Correctos; 12 pruebas; lint con 11 avisos históricos |
| Navegador: monitor/supervisor | 9 recorridos |
| Navegador: administración | 8 recorridos |
| Navegador: aislamiento de proceso/cuenta | 3 recorridos |
| Navegador: pérdida de acceso | 3 recorridos |
| Navegador: propuesta RN/RE | 3 recorridos; el reintento posterior quedó fuera de la ventana del fixture |
| Navegador: carreras y mantenimiento | 2 recorridos con `playwright-core` (roles, retraso de subida, metadata y no duplicación) |
| Comparación visual Chromium | 21 comparaciones, tres roles × siete anchos; monitor con delta 0,1–4 px; supervisor/admin 320 px con +42 px por una fila extra de contexto privado; referencia intacta |
| Tooltip nativo (1366 y 320) | Visible, dentro del viewport y Escape lo cierra; popover auto, no `manual` |
| `sha256sum --check docs/partes-propuesta-referencia.sha256` | 16/16 coinciden |

En total, **28 recorridos de navegador** (seis suites) además de 196 pruebas de
backend y 12 pruebas puras de Partes.

La suite completa crea y elimina sus propios esquemas aleatorios; no reinicia el
servidor permanente ni toca bases productivas. El error deliberado de un fixture
inválido en seguimiento demuestra que los demás procesos continúan.

### Benchmark de volumen

PostgreSQL 18 local, 64.974 partes sintéticas, una ejecución:

- Jornada de 7 bloques: 0,965 ms (`EXPLAIN ANALYZE`).
- Histórico del monitor (546 filas): 22,493 ms.
- Supervisor de 14 aulas: 14,253 ms.
- Administración de 119 aulas (833 filas): 1,658 ms.
- Endpoint A: 7 filas → 9 operaciones Prisma, 12.319 B JSON; 105 filas → 9
  operaciones, 167.161 B JSON. La primera lectura incluyó calentamiento (160,7 ms);
  la segunda, 44,3 ms. No es latencia productiva ni sustituye datos reales.
- No se añadió un índice nuevo: el único `(date,class_id,hour_session_id)` resuelve
  la hoja y el alcance recorre 65k filas en decenas de ms en esta copia. Revisar si
  el histórico crece o aparece contención de escritura.

### Presupuesto de navegador

- Build principal actual: 824,21 kB (gzip 246,71 kB); CSS 103,02 kB (gzip 19,84 kB).
  El build histórico documentado era 803,37 kB / gzip 240,39 kB; la comparación no
  aísla el coste de Partes y no se usa como objetivo de rendimiento.
- Carga fría: A + B, sin detalle por fila ni catálogos generales; auth/status/stream
  se contabilizan aparte en la medición de red.
- Diez minutos de SSE sano: **cumplidos**; 24 heartbeats, una conexión y cero GET
  repetidos de Partes/notificaciones por temporizador.
- Diez minutos de fallback: **cumplidos**; 3 listas de notificaciones y 3 lecturas
  de datos, sin sondeo por segundo. Recuperación de 65 s: **cero** GET posteriores
  al restablecer el stream. Los dos tramos se midieron en ejecuciones separadas con
  un runner de nodo que usa `playwright-core` gestionado; el corte de ruta no cierra
  una conexión SSE ya abierta, por eso el segundo tramo cierra el `EventSource`
  explícitamente y no se oculta esa diferencia de instrumentación.
- Carga fría: 1 workspace, 1 lote de miniaturas, 0 detalles por fila, 0 listas de
  notificaciones y solo auth/status/stream como llamadas de sesión.
- Runners reproducibles: `frontend/tests/partes-budget-node.cjs`,
  `partes-budget-fallback-node.cjs` y `partes-cold-node.cjs`, ejecutados con el
  `playwright-core` ya instalado por la CLI gestionada (`NODE_PATH`), sin instalar
  ni actualizar nada. Los dos tramos usan el harness 3107/5187.
- Un cambio externo debe invalidar como máximo una jornada; la implementación ya
  agrupa señales por 75 ms y revalida versiones antes de descargar.

## Puerta de entrega y límites

La puerta de Partes queda cerrada en el harness: fidelidad visual comparada, tres
roles con permisos reales, A/B y presupuesto medidos, migraciones/vista/índices
probados, reemplazos y sustituciones con autorización separada, capturas y
originales conservados, avisos persistentes y sin controles de reloj en el producto.
No se declara despliegue ni OAuth/IAM productivo.

Límites que no se ocultan:

1. El dump completo no se restauró en staging; se usó extracción por lista blanca y
   anonimización. Es una diferencia deliberada de alcance, no una importación real.
2. Las suites `modernizacion-browser` de operaciones/incidencias no se repitieron;
   usan el harness permanente y selectores anteriores a la hoja oficial. La
   cobertura de Partes sí se migró a las seis suites propias.
3. El reintento de propuesta RN/RE posterior a la ventana del fixture no se cuenta
   como pase; se conserva el resultado válido anterior y se documenta la condición.
4. No se probó Firefox/WebKit, lector de pantalla ni zoom 200 %; Chromium sí cubrió
   teclado, foco, Escape, tooltip, movimiento reducido y colores forzados.
5. No se contó con un contador independiente el número exacto de actualizaciones
   agrupadas provocadas por un cambio externo; la implementación agrupa señales por
   75 ms y revalida versiones antes de descargar. El presupuesto frío y de SSE sí
   está medido.

## Manifest de congelación

`docs/partes-congelacion.json` contiene el estado `congelado`, la referencia
inmutable y las 56 huellas de implementación/pruebas. Las huellas se regeneran
después de cualquier cambio de código; no sustituyen la revisión de la matriz.
