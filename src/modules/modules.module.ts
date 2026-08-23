import { Module } from '@nestjs/common';

import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';

import { AreaModule } from './areas/area.module';
import { AreaCourseHourModule } from './area-course-hour/area-course-hour.module';
import { ClassModule } from './classes/class.module';
import { HourSessionModule } from './hour-session/hour-session.module';
import { ScheduleModule } from './schedules/schedules.module';
import { SedeModule } from './sedes/sede.module';
import { ShiftModule } from './shifts/shift.module';
import { RolesModule } from './roles/roles.module';
import { PermissionsModule } from './permissions/permissions.module';
import { CourseModule } from '@modules/courses/course.module';

// Guard de Autorización
import { AuthorizationGuard } from './auth/guards/authorization.guard';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';

import { UserProfileModule } from './user-profile/user-profile.module';
import { SupervisorModule } from '@modules/supervisors/supervisor.module';
import { MonitorModule } from '@modules/monitors/monitor.module';
import { TeacherModule } from '@modules/teachers/teacher.module';
import { CoordinatorModule } from '@modules/coordinators/coordinator.module';

import { AdmissionsModule } from './admissions/admissions.module';
import { AuthGlobalGuard } from './auth/guards/auth-global.guard';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { SchemaManagerModule } from '@database/schema-manager/schema-manager.module';
import { SchemaManagerInterceptor } from '@database/schema-manager/schema-manager.interceptor';
import { PrismaExceptionInterceptor } from '@database/prisma/interceptors/exception.interceptor';
import { AlsModule } from './shared/als.module';

@Module({
  imports: [
    SchemaManagerModule,
    AlsModule,

    AdmissionsModule,
    RolesModule,
    PermissionsModule,

    AuthModule,
    UsersModule,
    UserProfileModule,

    AreaModule,
    AreaCourseHourModule,
    CourseModule,
    ClassModule,
    HourSessionModule,
    ScheduleModule,
    SedeModule,
    ShiftModule,

    SupervisorModule,
    MonitorModule,
    TeacherModule,
    CoordinatorModule,
  ],

  exports: [
    SchemaManagerModule,
    AlsModule,

    AdmissionsModule,
    RolesModule,
    PermissionsModule,

    AuthModule,
    UsersModule,
    UserProfileModule,

    AreaModule,
    AreaCourseHourModule,
    CourseModule,
    ClassModule,
    HourSessionModule,
    ScheduleModule,
    SedeModule,
    ShiftModule,

    SupervisorModule,
    MonitorModule,
    TeacherModule,
    CoordinatorModule,
  ],
  providers: [
    JwtAuthGuard,
    AuthorizationGuard,
    { provide: APP_GUARD, useClass: AuthGlobalGuard },
    { provide: APP_INTERCEPTOR, useClass: SchemaManagerInterceptor },
    { provide: APP_INTERCEPTOR, useClass: PrismaExceptionInterceptor },
  ],
})
export class ModulesModule {}
