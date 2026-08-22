import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  AUTHORIZATION_METADATA_KEY,
  AuthorizationMetadata,
  Role,
} from '../decorators/authorization.decorator';
import { PermissionsService } from '@modules/permissions/permissions.service';
import {
  COORDINATOR_ROLE,
  parseCoordinatorRole,
} from '@modules/auth/utils/coordinator-role';

const COORDINATOR_READ_PERMISSION_PREFIXES = [
  'area.',
  'area-course-hour.',
  'auth.',
  'class.',
  'courses.',
  'hour-session.',
  'schedule.',
  'sede.',
  'shift.',
  'teacher.',
];

@Injectable()
export class AuthorizationGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private permissionsService: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Extraer el token del header de la petición
    const request = context.switchToHttp().getRequest<Request>();

    // ⚠️ Verificamos que `req.user` venga del JwtStrategy (ya validado)
    const user = request['user'] as { userId: string; role: string };
    if (!user || !user.role) {
      throw new UnauthorizedException('User role is missing');
    }
    const role = user.role;
    const coordinatorScope = parseCoordinatorRole(role);

    const metadata = this.reflector.get<AuthorizationMetadata>(
      AUTHORIZATION_METADATA_KEY,
      context.getHandler(),
    );
    if (!metadata) throw new UnauthorizedException();

    try {
      if (coordinatorScope.isCoordinator && request['method'] !== 'GET') {
        throw new UnauthorizedException();
      }

      if (
        coordinatorScope.isCoordinator &&
        request['method'] === 'GET' &&
        COORDINATOR_READ_PERMISSION_PREFIXES.some((prefix) =>
          metadata.permission.startsWith(prefix),
        )
      ) {
        return true;
      }

      // Verificar si el rol del usuario tiene permisos para acceder a la ruta y está en el enum Role
      const isRoleValid = Object.values(Role).includes(role as Role);
      if (isRoleValid && metadata.roles?.includes(role as Role)) return true;

      // Verificar si el rol del usuario tiene permisos y está en la base de datos
      const permissionRole = coordinatorScope.isCoordinator
        ? COORDINATOR_ROLE
        : role;
      const hasPermission = await this.permissionsService.checkPermission(
        permissionRole,
        metadata.permission,
      );

      if (hasPermission) return true;
    } catch {
      throw new UnauthorizedException();
    }

    throw new UnauthorizedException();
  }
}
