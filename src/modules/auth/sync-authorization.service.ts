import { ConflictException, Injectable } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { InstanceWrapper } from '@nestjs/core/injector/instance-wrapper';
import {
  AUTHORIZATION_METADATA_KEY,
  AuthorizationMetadata,
  Role,
} from './decorators/authorization.decorator';
import { DrizzleService } from '@database/drizzle/drizzle.service';
import { permissions, roles, rolesPermissions } from '@database/drizzle/schema';
import { eq, sql } from 'drizzle-orm';
//import path from 'path';
interface EndpointMetadata extends AuthorizationMetadata {
  method: string; // HTTP
  path: string; // Full path
}

@Injectable()
export class SyncAuthorizationService {
  constructor(
    private readonly drizzleService: DrizzleService,
    private readonly discoveryService: DiscoveryService,
    private readonly metadataScanner: MetadataScanner,
    private readonly reflector: Reflector,
  ) {}

  private httpMethods: { [key: number]: string } = {
    0: 'GET',
    1: 'POST',
    2: 'PUT',
    3: 'DELETE', //4: 'ALL', 5: 'PATCH', 6: 'OPTIONS', 7: 'HEAD',
    4: 'ALL',
    5: 'PATCH',
  };

  // async syncAuthorization() {
  async syncAuthorization() {
    const data = this.getAllEndpointMetadata();
    const grouped = new Map<string, EndpointMetadata[]>();
    const routes = new Map<string, string>();
    for (const endpoint of data) {
      const key = `${endpoint.method} ${endpoint.path}`;
      if (routes.has(key) && routes.get(key) !== endpoint.permission)
        throw new ConflictException(`Conflicting permission for ${key}`);
      routes.set(key, endpoint.permission);
      const group = grouped.get(endpoint.permission) ?? [];
      const policy = (item: EndpointMetadata) =>
        JSON.stringify({
          roles: [...new Set(item.roles)].sort(),
          adminOnly: item.adminOnly ?? false,
        });
      if (group.length && policy(group[0]) !== policy(endpoint))
        throw new ConflictException(
          `Conflicting roles for permission ${endpoint.permission}`,
        );
      group.push(endpoint);
      grouped.set(endpoint.permission, group);
    }

    return await this.drizzleService.db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext('authorization-sync'))`,
      );
      const existingRoles = await tx.select().from(roles);
      const missingRoles = Object.values(Role)
        .filter(
          (name) => !existingRoles.some((role) => role.name === String(name)),
        )
        .map((name) => ({ name, description: `Rol para ${name}` }));
      if (missingRoles.length)
        await tx.insert(roles).values(missingRoles).onConflictDoNothing();
      const insertedRoles = await tx.select().from(roles);

      // Mapa de roles
      const roleIdMap = Object.fromEntries(
        insertedRoles.map((role) => [role.name, role.id]),
      );

      const existingPermissions = await tx.select().from(permissions);
      for (const [name, endpoints] of grouped) {
        const previous = existingPermissions.find(
          (permission) => permission.name === name,
        );
        // Preserve a still-valid representative route; one permission may protect many routes.
        const endpoint =
          endpoints.find(
            (item) =>
              item.path === previous?.path &&
              item.method === previous.methodHttp,
          ) ??
          [...endpoints].sort((a, b) =>
            `${a.method} ${a.path}`.localeCompare(`${b.method} ${b.path}`),
          )[0];
        const values = {
          path: endpoint.path,
          methodHttp: endpoint.method,
          description: endpoint.description ?? null,
        };
        if (!previous)
          await tx
            .insert(permissions)
            .values({ name, ...values })
            .onConflictDoNothing();
        else if (
          previous.path !== values.path ||
          previous.methodHttp !== values.methodHttp ||
          previous.description !== values.description
        )
          await tx
            .update(permissions)
            .set({ ...values, updatedAt: new Date() })
            .where(eq(permissions.id, previous.id));
      }
      const insertedPermissions = await tx.select().from(permissions);

      // Mapa de permisos
      const permissionIdMap = Object.fromEntries(
        insertedPermissions.map((perm) => [perm.name, perm.id]),
      );

      // 4. Preparar relaciones directamente sin procesar datos innecesariamente
      const relationRecords: { roleId: number; permissionId: number }[] = [];

      // Optimizar la construcción de relationRecords
      for (const endpoints of grouped.values()) {
        const endpoint = endpoints[0];
        const permId = permissionIdMap[endpoint.permission];
        if (!permId) continue;

        for (const roleName of endpoint.roles ?? []) {
          const roleId = roleIdMap[roleName];
          if (roleId) {
            relationRecords.push({ roleId: roleId, permissionId: permId });
          }
        }
      }

      // Realizar una sola inserción masiva
      if (relationRecords.length > 0) {
        await tx
          .insert(rolesPermissions)
          .values(relationRecords)
          .onConflictDoNothing();
      }

      return {
        data,
        rolesCount: Object.values(Role).length,
        permissionsCount: grouped.size,
        relationsCount: relationRecords.length,
      };
    });
  }

  private getAllEndpointMetadata(): EndpointMetadata[] {
    const endpoints: EndpointMetadata[] = [];
    const controllers = this.discoveryService.getControllers();

    controllers.forEach((wrapper: InstanceWrapper<object>) => {
      const { instance, metatype } = wrapper;
      if (!instance || !metatype) return;

      const prototype = Object.getPrototypeOf(instance) as Record<
        string,
        (...args: unknown[]) => unknown
      >;
      this.metadataScanner
        .getAllMethodNames(prototype)
        .forEach((methodName: string) => {
          const methodHandler = prototype[methodName];

          const controllerPath = this.reflector.get<string>(
            PATH_METADATA,
            instance.constructor,
          );
          const methodPath = this.reflector.get<string>(
            PATH_METADATA,
            methodHandler,
          );
          const type = this.reflector.get<number>(
            METHOD_METADATA,
            methodHandler,
          );
          const decorator = this.reflector.get<AuthorizationMetadata>(
            AUTHORIZATION_METADATA_KEY,
            methodHandler,
          );

          if (decorator) {
            const fullPath = this.getFullPath(controllerPath, methodPath);

            endpoints.push({
              roles: decorator.roles,
              permission: decorator.permission,
              description: decorator.description,
              path: fullPath,
              method: this.httpMethods[type],
              adminOnly: decorator.adminOnly,
            });
          }
        });
    });

    return endpoints;
  }

  private getFullPath(controllerPath: string, methodPath: string): string {
    const normControllerPath = controllerPath.startsWith('/')
      ? controllerPath
      : `api/${controllerPath}`;
    const normMethodPath = methodPath.startsWith('/')
      ? methodPath
      : `/${methodPath}`;
    // Handle empty method path special case
    if (normMethodPath === '/') {
      return normControllerPath;
    }
    return `${normControllerPath}${normMethodPath}`;
  }
}
