-- DROP TYPE "Weekday";

CREATE TYPE "Weekday" AS ENUM (
	'MONDAY',
	'TUESDAY',
	'WEDNESDAY',
	'THURSDAY',
	'FRIDAY',
	'SATURDAY',
	'SUNDAY');

-- DROP TYPE "job_statuses";

CREATE TYPE "job_statuses" AS ENUM (
	'FULL_TIME',
	'PART_TIME',
	'FREE_TIME');

-- DROP SEQUENCE area_course_hours_id_seq;

CREATE SEQUENCE area_course_hours_id_seq
	INCREMENT BY 1
	MINVALUE 1
	MAXVALUE 2147483647
	START 1
	CACHE 1
	NO CYCLE;
-- DROP SEQUENCE areas_id_seq;

CREATE SEQUENCE areas_id_seq
	INCREMENT BY 1
	MINVALUE 1
	MAXVALUE 32767
	START 1
	CACHE 1
	NO CYCLE;
-- DROP SEQUENCE courses_id_seq;

CREATE SEQUENCE courses_id_seq
	INCREMENT BY 1
	MINVALUE 1
	MAXVALUE 32767
	START 1
	CACHE 1
	NO CYCLE;
-- DROP SEQUENCE hour_sessions_id_seq;

CREATE SEQUENCE hour_sessions_id_seq
	INCREMENT BY 1
	MINVALUE 1
	MAXVALUE 32767
	START 1
	CACHE 1
	NO CYCLE;
-- DROP SEQUENCE schedules_id_seq;

CREATE SEQUENCE schedules_id_seq
	INCREMENT BY 1
	MINVALUE 1
	MAXVALUE 2147483647
	START 1
	CACHE 1
	NO CYCLE;
-- DROP SEQUENCE sedes_id_seq;

CREATE SEQUENCE sedes_id_seq
	INCREMENT BY 1
	MINVALUE 1
	MAXVALUE 32767
	START 1
	CACHE 1
	NO CYCLE;
-- DROP SEQUENCE shifts_id_seq;

CREATE SEQUENCE shifts_id_seq
	INCREMENT BY 1
	MINVALUE 1
	MAXVALUE 32767
	START 1
	CACHE 1
	NO CYCLE;-- "_prisma_migrations" definition


-- areas definition

-- Drop table

-- DROP TABLE areas;

CREATE TABLE areas (
	id smallserial NOT NULL,
	"name" varchar(48) NOT NULL,
	description varchar(255) NULL,
	CONSTRAINT areas_pkey PRIMARY KEY (id)
);
CREATE UNIQUE INDEX areas_name_key ON areas USING btree (name);


-- courses definition

-- Drop table

-- DROP TABLE courses;

CREATE TABLE courses (
	id smallserial NOT NULL,
	"name" varchar(48) NOT NULL,
	color varchar(7) NULL,
	description varchar(255) NULL,
	CONSTRAINT courses_pkey PRIMARY KEY (id)
);
CREATE UNIQUE INDEX courses_name_key ON courses USING btree (name);


-- sedes definition

-- Drop table

-- DROP TABLE sedes;

CREATE TABLE sedes (
	id smallserial NOT NULL,
	"name" varchar(48) NOT NULL,
	description varchar(255) NULL,
	phone varchar(20) NULL,
	CONSTRAINT sedes_pkey PRIMARY KEY (id)
);
CREATE UNIQUE INDEX sedes_name_key ON sedes USING btree (name);


-- shifts definition

-- Drop table

-- DROP TABLE shifts;

CREATE TABLE shifts (
	id smallserial NOT NULL,
	"name" varchar(48) NOT NULL,
	start_time time(6) NULL,
	end_time time(6) NULL,
	CONSTRAINT shifts_pkey PRIMARY KEY (id)
);
CREATE INDEX shifts_name_idx ON shifts USING btree (name);


-- users definition

-- Drop table

-- DROP TABLE users;

CREATE TABLE users (
	id uuid NOT NULL,
	email varchar(48) NOT NULL,
	"password" varchar(128) NULL,
	is_active bool DEFAULT true NOT NULL,
	created_at timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	updated_at timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	last_login timestamp(3) NULL,
	google_id varchar(64) NULL,
	"role" varchar(48) NOT NULL,
	CONSTRAINT users_pkey PRIMARY KEY (id)
);
CREATE UNIQUE INDEX users_email_key ON users USING btree (email);
CREATE UNIQUE INDEX users_google_id_key ON users USING btree (google_id);
CREATE INDEX users_role_idx ON users USING btree (role);


-- area_course_hours definition

-- Drop table

-- DROP TABLE area_course_hours;

CREATE TABLE area_course_hours (
	id serial4 NOT NULL,
	area_id int2 NOT NULL,
	course_id int2 NOT NULL,
	total_hours int2 NOT NULL,
	CONSTRAINT area_course_hours_pkey PRIMARY KEY (id),
	CONSTRAINT area_course_hours_area_id_fkey FOREIGN KEY (area_id) REFERENCES areas(id) ON DELETE RESTRICT ON UPDATE CASCADE,
	CONSTRAINT area_course_hours_course_id_fkey FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX area_course_hours_area_id_course_id_key ON area_course_hours USING btree (area_id, course_id);
CREATE INDEX area_course_hours_area_id_idx ON area_course_hours USING btree (area_id);
CREATE INDEX area_course_hours_course_id_idx ON area_course_hours USING btree (course_id);


-- hour_sessions definition

-- Drop table

-- DROP TABLE hour_sessions;

CREATE TABLE hour_sessions (
	id smallserial NOT NULL,
	shift_id int2 NOT NULL,
	"period" int2 NOT NULL,
	start_time time(6) NOT NULL,
	end_time time(6) NOT NULL,
	duration_minutes int2 DEFAULT 40 NOT NULL,
	CONSTRAINT hour_sessions_pkey PRIMARY KEY (id),
	CONSTRAINT hour_sessions_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX hour_sessions_period_idx ON hour_sessions USING btree (period);
CREATE INDEX hour_sessions_shift_id_idx ON hour_sessions USING btree (shift_id);
CREATE UNIQUE INDEX hour_sessions_shift_id_period_key ON hour_sessions USING btree (shift_id, period);


-- supervisors definition

-- Drop table

-- DROP TABLE supervisors;

CREATE TABLE supervisors (
	id uuid NOT NULL,
	user_id uuid NOT NULL,
	created_at timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	updated_at timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	shift_id int2 NULL,
	CONSTRAINT supervisors_pkey PRIMARY KEY (id),
	CONSTRAINT supervisors_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE SET NULL ON UPDATE CASCADE,
	CONSTRAINT supervisors_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX supervisors_user_id_key ON supervisors USING btree (user_id);


-- teachers definition

-- Drop table

-- DROP TABLE teachers;

CREATE TABLE teachers (
	id uuid NOT NULL,
	user_id uuid NOT NULL,
	course_id int2 NOT NULL,
	max_hours int2 NULL,
	scheduled_hours int2 DEFAULT 0 NOT NULL,
	created_at timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	updated_at timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	is_coordinator bool DEFAULT false NOT NULL,
	job_status "job_statuses" NOT NULL,
	CONSTRAINT teachers_pkey PRIMARY KEY (id),
	CONSTRAINT teachers_course_id_fkey FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE RESTRICT ON UPDATE CASCADE,
	CONSTRAINT teachers_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX teachers_course_id_idx ON teachers USING btree (course_id);
CREATE UNIQUE INDEX teachers_user_id_key ON teachers USING btree (user_id);


-- user_profiles definition

-- Drop table

-- DROP TABLE user_profiles;

CREATE TABLE user_profiles (
	id uuid NOT NULL,
	user_id uuid NULL,
	dni varchar(10) NULL,
	first_name varchar(128) NOT NULL,
	last_name varchar(128) NOT NULL,
	phone varchar(15) NULL,
	phones_additional _varchar NULL,
	personal_email varchar(48) NULL,
	is_active bool DEFAULT true NOT NULL,
	created_at timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	updated_at timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT user_profiles_pkey PRIMARY KEY (id),
	CONSTRAINT user_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX user_profiles_dni_key ON user_profiles USING btree (dni);
CREATE UNIQUE INDEX user_profiles_personal_email_key ON user_profiles USING btree (personal_email);
CREATE UNIQUE INDEX user_profiles_user_id_key ON user_profiles USING btree (user_id);


-- monitors definition

-- Drop table

-- DROP TABLE monitors;

CREATE TABLE monitors (
	id uuid NOT NULL,
	user_id uuid NOT NULL,
	supervisor_id uuid NULL,
	created_at timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	updated_at timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT monitors_pkey PRIMARY KEY (id),
	CONSTRAINT monitors_supervisor_id_fkey FOREIGN KEY (supervisor_id) REFERENCES supervisors(id) ON DELETE RESTRICT ON UPDATE CASCADE,
	CONSTRAINT monitors_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX monitors_supervisor_id_idx ON monitors USING btree (supervisor_id);
CREATE UNIQUE INDEX monitors_user_id_key ON monitors USING btree (user_id);


-- classes definition

-- Drop table

-- DROP TABLE classes;

CREATE TABLE classes (
	id uuid NOT NULL,
	"name" varchar(48) NOT NULL,
	id_sede int2 NOT NULL,
	area_id int2 NOT NULL,
	shift_id int2 NOT NULL,
	monitor_id uuid NULL,
	capacity int2 DEFAULT 100 NOT NULL,
	url_meet varchar(48) NULL,
	url_classroom varchar(64) NULL,
	CONSTRAINT classes_pkey PRIMARY KEY (id),
	CONSTRAINT classes_area_id_fkey FOREIGN KEY (area_id) REFERENCES areas(id) ON DELETE RESTRICT ON UPDATE CASCADE,
	CONSTRAINT classes_id_sede_fkey FOREIGN KEY (id_sede) REFERENCES sedes(id) ON DELETE RESTRICT ON UPDATE CASCADE,
	CONSTRAINT classes_monitor_id_fkey FOREIGN KEY (monitor_id) REFERENCES monitors(id) ON DELETE SET NULL ON UPDATE CASCADE,
	CONSTRAINT classes_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX classes_area_id_idx ON classes USING btree (area_id);
CREATE INDEX classes_id_sede_idx ON classes USING btree (id_sede);
CREATE INDEX classes_monitor_id_idx ON classes USING btree (monitor_id);
CREATE UNIQUE INDEX classes_monitor_id_key ON classes USING btree (monitor_id);
CREATE INDEX classes_shift_id_idx ON classes USING btree (shift_id);


-- schedules definition

-- Drop table

-- DROP TABLE schedules;

CREATE TABLE schedules (
	id serial4 NOT NULL,
	class_id uuid NOT NULL,
	course_id int2 NOT NULL,
	hour_session_id int2 NOT NULL,
	teacher_id uuid NULL,
	"weekday" "Weekday" NOT NULL,
	CONSTRAINT schedules_pkey PRIMARY KEY (id),
	CONSTRAINT schedules_class_id_fkey FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE RESTRICT ON UPDATE CASCADE,
	CONSTRAINT schedules_course_id_fkey FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE RESTRICT ON UPDATE CASCADE,
	CONSTRAINT schedules_hour_session_id_fkey FOREIGN KEY (hour_session_id) REFERENCES hour_sessions(id) ON DELETE RESTRICT ON UPDATE CASCADE,
	CONSTRAINT schedules_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX schedules_class_id_idx ON schedules USING btree (class_id);
CREATE UNIQUE INDEX schedules_course_id_hour_session_id_teacher_id_weekday_key ON schedules USING btree (course_id, hour_session_id, teacher_id, weekday);
CREATE INDEX schedules_course_id_idx ON schedules USING btree (course_id);
CREATE INDEX schedules_hour_session_id_idx ON schedules USING btree (hour_session_id);
CREATE INDEX schedules_teacher_id_idx ON schedules USING btree (teacher_id);