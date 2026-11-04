# Sustitución semanal de docente · BE-01/02

`PATCH /api/schedules/reemplazar/profesor`, solo administración:

```json
{"classId":"UUID","courseId":1,"expectedTeacherId":"UUID","teacherId":"UUID"}
```

Devuelve `{classId,courseId,previousTeacherId,teacherId,updatedSchedules}` (200).
UUID/curso o compatibilidad inválidos:400; rol autenticado prohibido:403;
recurso ajeno/inexistente:404; origen cambiado/mezclado, carga incoherente o
contención agotada:409. La ruta conserva401 para falta de autenticación.
La traducción401→403 se limita a esta ruta y a una identidad ya validada por los
guards; no modifica el guard compartido ni permite ejecutar el controlador.

Una transacción serializable reutiliza los reintentos de asignación. Lee todos
los bloques del curso y ambos docentes, valida propietario esperado, actividad
del candidato, curso, cobertura, cruces reales y capacidad. Comprueba cargas
contra los horarios existentes, actualiza condicionalmente todos los bloques y
ajusta ambas cargas por el conteo real. Cualquier fallo revierte todo. Retirar al
titular no exige que siga activo. No modifica Partes ni reemplazos RN/RE.

Un reenvío con el origen anterior devuelve409; una respuesta perdida exige releer,
no reintentar automáticamente. Asignar y desasignar anteriores siguen disponibles.

`POST /schedules/load-with-courses` fue retirado: era un handler sin binding de
body y un servicio que devolvía su argumento. No se encontraron consumidores
funcionales en fuentes/clientes/scripts; solo referencias de contratos V0 y un
negativo401 histórico, conservados como historia. No se afirma conocer clientes
externos. Crear procesos sigue por AdmissionsService.create → applyStructure →
initialDataSchema, en su transacción existente; no hay migración nueva.

Pruebas: `test/schedule-replacement.e2e-spec.ts` mediante
`node test/run-records-tests.cjs test/schedule-replacement.e2e-spec.ts` dentro del
Compose aislado; disponibilidad y clases conservan sus suites. HTTP real por
`frontend/tests/run-finalization.mjs backend` con el harness sintético.
