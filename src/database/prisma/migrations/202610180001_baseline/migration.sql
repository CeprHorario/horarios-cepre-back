-- CreateEnum
CREATE TYPE "job_statuses" AS ENUM ('FULL_TIME', 'PART_TIME', 'FREE_TIME');

-- CreateEnum
CREATE TYPE "Weekday" AS ENUM ('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "email" VARCHAR(48) NOT NULL,
    "password" VARCHAR(128),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_login" TIMESTAMP(3),
    "google_id" VARCHAR(64),
    "role" VARCHAR(48) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_profiles" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" UUID,
    "dni" VARCHAR(10),
    "first_name" VARCHAR(128) NOT NULL,
    "last_name" VARCHAR(128) NOT NULL,
    "phone" VARCHAR(15),
    "phones_additional" VARCHAR(15)[],
    "personal_email" VARCHAR(48),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teachers" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" UUID NOT NULL,
    "course_id" SMALLINT NOT NULL,
    "max_hours" SMALLINT,
    "scheduled_hours" SMALLINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_coordinator" BOOLEAN NOT NULL DEFAULT false,
    "job_status" "job_statuses" NOT NULL,

    CONSTRAINT "teachers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supervisors" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" UUID NOT NULL,
    "shift_id" SMALLINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supervisors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monitors" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" UUID NOT NULL,
    "supervisor_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "monitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "areas" (
    "id" SMALLSERIAL NOT NULL,
    "name" VARCHAR(48) NOT NULL,
    "description" VARCHAR(255),

    CONSTRAINT "areas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "area_course_hours" (
    "id" SERIAL NOT NULL,
    "area_id" SMALLINT NOT NULL,
    "course_id" SMALLINT NOT NULL,
    "total_hours" SMALLINT NOT NULL,

    CONSTRAINT "area_course_hours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courses" (
    "id" SMALLSERIAL NOT NULL,
    "name" VARCHAR(48) NOT NULL,
    "color" VARCHAR(7),
    "description" VARCHAR(255),

    CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sedes" (
    "id" SMALLSERIAL NOT NULL,
    "name" VARCHAR(48) NOT NULL,
    "description" VARCHAR(255),
    "phone" VARCHAR(20),

    CONSTRAINT "sedes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shifts" (
    "id" SMALLSERIAL NOT NULL,
    "name" VARCHAR(48) NOT NULL,
    "start_time" TIME(6),
    "end_time" TIME(6),

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classes" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "name" VARCHAR(48) NOT NULL,
    "id_sede" SMALLINT NOT NULL,
    "area_id" SMALLINT NOT NULL,
    "shift_id" SMALLINT NOT NULL,
    "monitor_id" UUID,
    "capacity" SMALLINT NOT NULL DEFAULT 100,
    "url_meet" VARCHAR(48),
    "url_classroom" VARCHAR(64),

    CONSTRAINT "classes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hour_sessions" (
    "id" SMALLSERIAL NOT NULL,
    "shift_id" SMALLINT NOT NULL,
    "period" SMALLINT NOT NULL,
    "start_time" TIME(6) NOT NULL,
    "end_time" TIME(6) NOT NULL,
    "duration_minutes" SMALLINT NOT NULL DEFAULT 40,

    CONSTRAINT "hour_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedules" (
    "id" SERIAL NOT NULL,
    "class_id" UUID NOT NULL,
    "course_id" SMALLINT NOT NULL,
    "hour_session_id" SMALLINT NOT NULL,
    "teacher_id" UUID,
    "weekday" "Weekday" NOT NULL,

    CONSTRAINT "schedules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_google_id_key" ON "users"("google_id");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE UNIQUE INDEX "user_profiles_user_id_key" ON "user_profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_profiles_dni_key" ON "user_profiles"("dni");

-- CreateIndex
CREATE UNIQUE INDEX "user_profiles_personal_email_key" ON "user_profiles"("personal_email");

-- CreateIndex
CREATE UNIQUE INDEX "teachers_user_id_key" ON "teachers"("user_id");

-- CreateIndex
CREATE INDEX "teachers_course_id_idx" ON "teachers"("course_id");

-- CreateIndex
CREATE UNIQUE INDEX "supervisors_user_id_key" ON "supervisors"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "monitors_user_id_key" ON "monitors"("user_id");

-- CreateIndex
CREATE INDEX "monitors_supervisor_id_idx" ON "monitors"("supervisor_id");

-- CreateIndex
CREATE UNIQUE INDEX "areas_name_key" ON "areas"("name");

-- CreateIndex
CREATE INDEX "area_course_hours_area_id_idx" ON "area_course_hours"("area_id");

-- CreateIndex
CREATE INDEX "area_course_hours_course_id_idx" ON "area_course_hours"("course_id");

-- CreateIndex
CREATE UNIQUE INDEX "area_course_hours_area_id_course_id_key" ON "area_course_hours"("area_id", "course_id");

-- CreateIndex
CREATE UNIQUE INDEX "courses_name_key" ON "courses"("name");

-- CreateIndex
CREATE UNIQUE INDEX "sedes_name_key" ON "sedes"("name");

-- CreateIndex
CREATE INDEX "shifts_name_idx" ON "shifts"("name");

-- CreateIndex
CREATE UNIQUE INDEX "classes_monitor_id_key" ON "classes"("monitor_id");

-- CreateIndex
CREATE INDEX "classes_id_sede_idx" ON "classes"("id_sede");

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
CREATE INDEX "schedules_class_id_idx" ON "schedules"("class_id");

-- CreateIndex
CREATE INDEX "schedules_course_id_idx" ON "schedules"("course_id");

-- CreateIndex
CREATE INDEX "schedules_hour_session_id_idx" ON "schedules"("hour_session_id");

-- CreateIndex
CREATE INDEX "schedules_teacher_id_idx" ON "schedules"("teacher_id");

-- CreateIndex
CREATE UNIQUE INDEX "schedules_course_id_hour_session_id_teacher_id_weekday_key" ON "schedules"("course_id", "hour_session_id", "teacher_id", "weekday");

-- AddForeignKey
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teachers" ADD CONSTRAINT "teachers_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teachers" ADD CONSTRAINT "teachers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supervisors" ADD CONSTRAINT "supervisors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supervisors" ADD CONSTRAINT "supervisors_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitors" ADD CONSTRAINT "monitors_supervisor_id_fkey" FOREIGN KEY ("supervisor_id") REFERENCES "supervisors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitors" ADD CONSTRAINT "monitors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "area_course_hours" ADD CONSTRAINT "area_course_hours_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "areas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "area_course_hours" ADD CONSTRAINT "area_course_hours_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classes" ADD CONSTRAINT "classes_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "areas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classes" ADD CONSTRAINT "classes_id_sede_fkey" FOREIGN KEY ("id_sede") REFERENCES "sedes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classes" ADD CONSTRAINT "classes_monitor_id_fkey" FOREIGN KEY ("monitor_id") REFERENCES "monitors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classes" ADD CONSTRAINT "classes_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hour_sessions" ADD CONSTRAINT "hour_sessions_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_hour_session_id_fkey" FOREIGN KEY ("hour_session_id") REFERENCES "hour_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "teachers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
