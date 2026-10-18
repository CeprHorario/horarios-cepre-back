# Backend CEPRE v1

Base NestJS 12, Node.js 24 LTS y TypeScript 6. Incluye el Plan 1: modelos compatibles con v0, UUIDv7 generado por PostgreSQL, admisiones atómicas, autenticación, enrutamiento multiesquema y configuración operativa en Firestore. [Contrato, reconciliación e importación](docs/plan-1-compatibility.md).

El [Plan 2](docs/plan-2-authentication.md) añade protección del popup OAuth, tokens vinculados al proceso y sincronización incremental de permisos. Incluye el procedimiento de administrador inicial y la [matriz de acceso](docs/authorization-matrix.md).

## Desarrollo con Docker

```bash
cp .env.example .env
# Configurar JWT_SECRET en .env con un secreto propio (openssl rand -hex 32).
docker compose -f compose.dev.yaml up
```

Compose levanta el backend en modo watch y PostgreSQL 18. Configurar JWT, Google OAuth y Firestore en `.env`; el SDK usa Application Default Credentials. Para desarrollo dentro de Docker, proporcionar las credenciales al contenedor mediante un montaje externo o usar el emulador de Firestore. No incorporar credenciales a la imagen.

- Health: <http://localhost:8080/api/health>
- Swagger: <http://localhost:8080/swagger>
- OpenAPI: <http://localhost:8080/swagger/json>
- PostgreSQL: `localhost:5432`; credenciales locales en `.env.example`.
- Datos locales: `.volumes/postgres`, montado en `/var/lib/postgresql`. Usar un directorio nuevo para PostgreSQL 18, nunca el directorio de datos de PostgreSQL 17.

Desarrollo usa directamente la imagen oficial de Node 24. El único montaje `.:/app` comparte todo el proyecto, incluido `./node_modules`: las dependencias y el cliente Prisma generado quedan visibles para VS Code. El contenedor ejecuta `npm ci` desde el lockfile y después inicia Nest en modo watch. Usa el usuario `node` (UID/GID 1000, como el usuario local de este proyecto).

Para agregar dependencias desde el contenedor:

```bash
docker compose -f compose.dev.yaml exec backend npm install nombre-del-paquete
```

Los cambios en `package.json`, `package-lock.json` y `node_modules` aparecen directamente en el host. Si cambia el lockfile al actualizar el repositorio, `docker compose -f compose.dev.yaml restart backend` vuelve a instalarlo. El Dockerfile se utiliza únicamente para la imagen de producción.

Para detener los servicios conservando PostgreSQL:

```bash
docker compose -f compose.dev.yaml down
```

Las credenciales incluidas son solo de desarrollo. Si cambias usuario, contraseña o base, actualiza también `DATABASE_URL` para las herramientas ejecutadas desde el host. Compose reemplaza esa URL por la conexión interna a `db`. Si cambias `POSTGRES_PORT`, adapta el puerto de la URL del host. La imagen de PostgreSQL solo inicializa credenciales al crear un volumen vacío.

## Desarrollo sin contenedor del backend

Con Node.js 24.22 y npm 11:

```bash
cp .env.example .env
docker compose -f compose.dev.yaml up -d db
npm ci
npm run prisma:generate
npm run start:dev
```

## Base de datos

- Prisma: `src/database/prisma/schema.prisma`; genera el cliente TypeScript en `src/generated/prisma`, sin versionarlo. Se usa CommonJS para no exigir una migración ESM del código de negocio.
- Drizzle: `src/database/drizzle/schema.ts`, tablas globales en `public`.
- Configuraciones de las CLI: `prisma.config.ts` y `drizzle.config.ts` en la raíz.
- Se conservan `PrismaService.getClient()`, `getClientForSchema(schema)` y `DrizzleService.db`. `getClient()` exige un contexto de petición autorizado.

Los clientes Prisma usan un único pool compartido limitado por `DB_POOL_MAX`, con selección de esquema explícita en el adaptador. Drizzle dispone de otro pool global. Administradores se autentican en `core_schema`; Firestore puede seleccionar procesos distintos para administradores y usuarios. La selección queda fijada por petición.

Health comprueba que el proceso HTTP está vivo, no la disponibilidad de PostgreSQL. Los pools se abren bajo demanda y se cierran con el ciclo de vida de Nest.

No se aplican migraciones al arrancar o construir la imagen. Antes del primer uso, ejecutarlas como paso externo en este orden:

```bash
npm run prisma:generate
npm run drizzle:migrate
npm run build
npm run prisma:migrate:deploy
```

El comando académico usa el runner versionado compilado que también aprovisiona procesos desde la API. No ejecutar `prisma migrate deploy` directamente: el historial académico se aplica por esquema. Cada ORM administra sus propias tablas. Las CLI quedan fijadas en el lockfile; no usar Prisma 8 RC. Para generar cambios, consultar el procedimiento de reconciliación.

## Compatibilidad HTTP

Se conservan el prefijo `/api`, Swagger en `/swagger`, su JSON en `/swagger/json` y las opciones de `ValidationPipe` de v0: `whitelist`, `forbidNonWhitelisted` y `transform`, sin conversión implícita adicional. CORS admite `REDIRECT_FRONT` y `https://storage.googleapis.com`, con credenciales y `Authorization`.

Se migran `/api/admissions`, `/api/auth` y `/api/system`. JWT valida identidad y actividad en PostgreSQL; se mantienen mantenimiento, permisos y contratos de configuración. `/api/health` continúa independiente de las bases de datos. Los módulos académicos HTTP se migrarán por separado.

## Comprobaciones

```bash
npm run typecheck
npm run lint
npm run format:check
npm test -- --runInBand
npm run build
```

También se pueden ejecutar dentro del servicio: `docker compose -f compose.dev.yaml exec backend npm test -- --runInBand`.

Jest habilita módulos VM únicamente en los scripts de pruebas para cargar los paquetes ESM de Nest 12; la aplicación y el cliente generado siguen en CommonJS.

## Imagen de producción

```bash
docker build -t cepr-backend:local .
docker run --rm --env-file .env -e NODE_ENV=production -p 8080:8080 cepr-backend:local
```

El runtime es distroless Node.js 24 sobre Debian 13, ejecutado como usuario no root. Solo contiene `dist`, las dependencias de producción y `package.json`; no incluye npm, shell, herramientas de compilación ni archivos `.env`. Su comando ejecuta `dist/main.js` directamente.

La etapa de build excluye dependencias de desarrollo y opcionales: omitir solo desarrollo conserva Prisma CLI y TypeScript como peers opcionales, aumentando innecesariamente el runtime.

En producción se debe proporcionar una `DATABASE_URL` accesible desde el contenedor: `localhost` dentro de Docker no es el host ni el servicio `db` de otro proyecto Compose. Las migraciones deben ejecutarse como paso separado del despliegue, no desde distroless.
