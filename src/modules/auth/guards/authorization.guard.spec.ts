import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsService } from '../../permissions/permissions.service';
import { AuthorizationGuard } from './authorization.guard';
import { Role } from '../decorators/authorization.decorator';

describe('Lectura de coordinación general sin concesiones de escritura', () => {
  function check(role:string, method:string, permission:string, adminOnly=false) {
    const guard=new AuthorizationGuard({get:()=>({permission,roles:[Role.ADMIN,Role.COORDINATOR,Role.TEACHER],adminOnly})} as unknown as Reflector,
      {checkPermission:()=>Promise.resolve(true)} as unknown as PermissionsService);
    const context={getHandler:()=>null,switchToHttp:()=>({getRequest:()=>({method,user:{role,userId:'account'}})})} as unknown as ExecutionContext;
    return guard.canActivate(context);
  }
  it('lee solicitudes/documentos e incidencias, incluso con permisos históricos amplios', async()=>{
    for(const permission of ['operations.context','operations.requests.list','operations.requests.detail','operations.requests.pdf','operations.requests.docx','incidences.context','incidences.list','incidences.history'])
      await expect(check('coordinador','GET',permission,permission==='incidences.history')).resolves.toBe(true);
    for(const [method,permission] of [['POST','operations.requests.create'],['PATCH','operations.requests.decide'],['POST','incidences.create'],['PATCH','incidences.resolve'],['GET','class-session-records.list'],['GET','incidences.people']])
      await expect(check('coordinador',method,permission)).rejects.toThrow();
  });
  it('conserva la revisión de curso y las solicitudes del docente sin exponer sus incidencias',async()=>{
    await expect(check('coordinador-1','PATCH','operations.requests.decide')).resolves.toBe(true);
    await expect(check('coordinador-1','GET','incidences.list')).rejects.toThrow();
    await expect(check('profesor','POST','operations.requests.create')).resolves.toBe(true);
    await expect(check('profesor','GET','incidences.list')).rejects.toThrow();
  });
});
