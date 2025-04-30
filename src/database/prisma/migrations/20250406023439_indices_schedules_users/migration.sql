/*
  Warnings:

  - A unique constraint covering the columns `[shift_id,period]` on the table `hour_sessions` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "user_profiles" ALTER COLUMN "user_id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "area_course_hours_area_id_idx" ON "area_course_hours"("area_id");

-- CreateIndex
CREATE INDEX "area_course_hours_course_id_idx" ON "area_course_hours"("course_id");

-- CreateIndex
CREATE INDEX "classes_area_id_idx" ON "classes"("area_id");

-- CreateIndex
CREATE INDEX "classes_shift_id_idx" ON "classes"("shift_id");

-- CreateIndex
CREATE INDEX "classes_monitor_id_idx" ON "classes"("monitor_id");

-- CreateIndex
CREATE INDEX "hour_sessions_shift_id_idx" ON "hour_sessions"("shift_id");

-- CreateIndex
CREATE INDEX "hour_sessions_period_idx" ON "hour_sessions"("period");

-- CreateIndex
CREATE UNIQUE INDEX "hour_sessions_shift_id_period_key" ON "hour_sessions"("shift_id", "period");

-- CreateIndex
CREATE INDEX "monitors_supervisor_id_idx" ON "monitors"("supervisor_id");

-- CreateIndex
CREATE INDEX "schedules_class_id_idx" ON "schedules"("class_id");

-- CreateIndex
CREATE INDEX "schedules_course_id_idx" ON "schedules"("course_id");

-- CreateIndex
CREATE INDEX "schedules_hour_session_id_idx" ON "schedules"("hour_session_id");

-- CreateIndex
CREATE INDEX "schedules_teacher_id_idx" ON "schedules"("teacher_id");

-- CreateIndex
CREATE INDEX "shifts_name_idx" ON "shifts"("name");

-- CreateIndex
CREATE INDEX "teachers_course_id_idx" ON "teachers"("course_id");
