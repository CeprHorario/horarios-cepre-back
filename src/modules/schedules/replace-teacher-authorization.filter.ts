import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  UnauthorizedException,
} from '@nestjs/common';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../auth/authenticated-request';

/** La ruta nueva distingue rol prohibido de falta de sesión sin cambiar guards heredados. */
@Catch(UnauthorizedException)
export class ReplaceTeacherAuthorizationFilter implements ExceptionFilter {
  catch(exception: UnauthorizedException, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    const response = http.getResponse<Response>();
    if (request.user?.role && request.user.role !== 'administrador') {
      response.status(403).json({
        statusCode: 403,
        error: 'Forbidden',
        message: 'Solo administración puede sustituir el docente del salón',
      });
      return;
    }
    response.status(exception.getStatus()).json(exception.getResponse());
  }
}
