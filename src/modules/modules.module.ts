import { Module } from '@nestjs/common';
import { AreaModule } from './areas/area.module';
import { AreaCourseHourModule } from './area-course-hour/area-course-hour.module';
import { CourseModule } from './courses/course.module';
import { SedeModule } from './sedes/sede.module';
import { ShiftModule } from './shifts/shift.module';
import { HourSessionModule } from './hour-session/hour-session.module';
import { UsersModule } from './users/users.module';
import { UserProfileModule } from './user-profile/user-profile.module';
import { TeacherModule } from './teachers/teacher.module';
import { CoordinatorModule } from './coordinators/coordinator.module';
import { SupervisorModule } from './supervisors/supervisor.module';
import { MonitorModule } from './monitors/monitor.module';
import { ClassModule } from './classes/class.module';
import { ScheduleModule } from './schedules/schedules.module';

@Module({
  imports: [
    AreaModule, AreaCourseHourModule, CourseModule, SedeModule, ShiftModule,
    HourSessionModule, UsersModule, UserProfileModule, TeacherModule,
    CoordinatorModule, SupervisorModule, MonitorModule, ClassModule, ScheduleModule,
  ],
})
export class ModulesModule {}
