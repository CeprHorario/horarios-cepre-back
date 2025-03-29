-- DROP SCHEMA proceso_dev;

CREATE SCHEMA proceso_dev AUTHORIZATION postgres;

-- DROP TYPE proceso_dev."Weekday";

CREATE TYPE proceso_dev."Weekday" AS ENUM (
	'MONDAY',
	'TUESDAY',
	'WEDNESDAY',
	'THURSDAY',
	'FRIDAY',
	'SATURDAY',
	'SUNDAY');

-- DROP TYPE proceso_dev."job_shift_types";

CREATE TYPE proceso_dev."job_shift_types" AS ENUM (
	'FULL_TIME',
	'PART_TIME');

-- DROP SEQUENCE proceso_dev.area_course_hours_id_seq;

CREATE SEQUENCE proceso_dev.area_course_hours_id_seq
	INCREMENT BY 1
	MINVALUE 1
	MAXVALUE 2147483647
	START 1
	CACHE 1
	NO CYCLE;
-- DROP SEQUENCE proceso_dev.areas_id_seq;

CREATE SEQUENCE proceso_dev.areas_id_seq
	INCREMENT BY 1
	MINVALUE 1
	MAXVALUE 32767
	START 1
	CACHE 1
	NO CYCLE;
-- DROP SEQUENCE proceso_dev.courses_id_seq;

CREATE SEQUENCE proceso_dev.courses_id_seq
	INCREMENT BY 1
	MINVALUE 1
	MAXVALUE 32767
	START 1
	CACHE 1
	NO CYCLE;
-- DROP SEQUENCE proceso_dev.hour_sessions_id_seq;

CREATE SEQUENCE proceso_dev.hour_sessions_id_seq
	INCREMENT BY 1
	MINVALUE 1
	MAXVALUE 32767
	START 1
	CACHE 1
	NO CYCLE;
-- DROP SEQUENCE proceso_dev.schedules_id_seq;

CREATE SEQUENCE proceso_dev.schedules_id_seq
	INCREMENT BY 1
	MINVALUE 1
	MAXVALUE 2147483647
	START 1
	CACHE 1
	NO CYCLE;
-- DROP SEQUENCE proceso_dev.sedes_id_seq;

CREATE SEQUENCE proceso_dev.sedes_id_seq
	INCREMENT BY 1
	MINVALUE 1
	MAXVALUE 32767
	START 1
	CACHE 1
	NO CYCLE;
-- DROP SEQUENCE proceso_dev.shifts_id_seq;

CREATE SEQUENCE proceso_dev.shifts_id_seq
	INCREMENT BY 1
	MINVALUE 1
	MAXVALUE 32767
	START 1
	CACHE 1
	NO CYCLE;

-- proceso_dev.areas definition

-- Drop table

-- DROP TABLE proceso_dev.areas;

CREATE TABLE proceso_dev.areas (
	id smallserial NOT NULL,
	"name" varchar(48) NOT NULL,
	description varchar(255) NULL,
	CONSTRAINT areas_pkey PRIMARY KEY (id)
);
CREATE UNIQUE INDEX areas_name_key ON proceso_dev.areas USING btree (name);


-- proceso_dev.courses definition

-- Drop table

-- DROP TABLE proceso_dev.courses;

CREATE TABLE proceso_dev.courses (
	id smallserial NOT NULL,
	"name" varchar(48) NOT NULL,
	color varchar(7) NULL,
	description varchar(255) NULL,
	CONSTRAINT courses_pkey PRIMARY KEY (id)
);
CREATE UNIQUE INDEX courses_name_key ON proceso_dev.courses USING btree (name);


-- proceso_dev.sedes definition

-- Drop table

-- DROP TABLE proceso_dev.sedes;

CREATE TABLE proceso_dev.sedes (
	id smallserial NOT NULL,
	"name" varchar(48) NOT NULL,
	description varchar(255) NULL,
	phone varchar(20) NULL,
	CONSTRAINT sedes_pkey PRIMARY KEY (id)
);
CREATE UNIQUE INDEX sedes_name_key ON proceso_dev.sedes USING btree (name);


-- proceso_dev.shifts definition

-- Drop table

-- DROP TABLE proceso_dev.shifts;

CREATE TABLE proceso_dev.shifts (
	id smallserial NOT NULL,
	"name" varchar(48) NOT NULL,
	start_time time(6) NULL,
	end_time time(6) NULL,
	CONSTRAINT shifts_pkey PRIMARY KEY (id)
);


-- proceso_dev.users definition

-- Drop table

-- DROP TABLE proceso_dev.users;

CREATE TABLE proceso_dev.users (
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
CREATE UNIQUE INDEX users_email_key ON proceso_dev.users USING btree (email);
CREATE UNIQUE INDEX users_google_id_key ON proceso_dev.users USING btree (google_id);
CREATE INDEX users_role_idx ON proceso_dev.users USING btree (role);


-- proceso_dev.area_course_hours definition

-- Drop table

-- DROP TABLE proceso_dev.area_course_hours;

CREATE TABLE proceso_dev.area_course_hours (
	id serial4 NOT NULL,
	area_id int2 NOT NULL,
	course_id int2 NOT NULL,
	total_hours int2 NOT NULL,
	CONSTRAINT area_course_hours_pkey PRIMARY KEY (id),
	CONSTRAINT area_course_hours_area_id_fkey FOREIGN KEY (area_id) REFERENCES proceso_dev.areas(id) ON DELETE RESTRICT ON UPDATE CASCADE,
	CONSTRAINT area_course_hours_course_id_fkey FOREIGN KEY (course_id) REFERENCES proceso_dev.courses(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX area_course_hours_area_id_course_id_key ON proceso_dev.area_course_hours USING btree (area_id, course_id);


-- proceso_dev.hour_sessions definition

-- Drop table

-- DROP TABLE proceso_dev.hour_sessions;

CREATE TABLE proceso_dev.hour_sessions (
	id smallserial NOT NULL,
	shift_id int2 NOT NULL,
	"period" int2 NOT NULL,
	start_time time(6) NOT NULL,
	end_time time(6) NOT NULL,
	duration_minutes int2 DEFAULT 40 NOT NULL,
	CONSTRAINT hour_sessions_pkey PRIMARY KEY (id),
	CONSTRAINT hour_sessions_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES proceso_dev.shifts(id) ON DELETE RESTRICT ON UPDATE CASCADE
);


-- proceso_dev.supervisors definition

-- Drop table

-- DROP TABLE proceso_dev.supervisors;

CREATE TABLE proceso_dev.supervisors (
	id uuid NOT NULL,
	user_id uuid NOT NULL,
	created_at timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	updated_at timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT supervisors_pkey PRIMARY KEY (id),
	CONSTRAINT supervisors_user_id_fkey FOREIGN KEY (user_id) REFERENCES proceso_dev.users(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX supervisors_user_id_key ON proceso_dev.supervisors USING btree (user_id);


-- proceso_dev.teachers definition

-- Drop table

-- DROP TABLE proceso_dev.teachers;

CREATE TABLE proceso_dev.teachers (
	id uuid NOT NULL,
	user_id uuid NOT NULL,
	course_id int2 NOT NULL,
	max_hours int2 NULL,
	scheduled_hours int2 NULL,
	created_at timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	updated_at timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	is_active bool DEFAULT true NOT NULL,
	job_shift_type proceso_dev."job_shift_types" NOT NULL,
	CONSTRAINT teachers_pkey PRIMARY KEY (id),
	CONSTRAINT teachers_course_id_fkey FOREIGN KEY (course_id) REFERENCES proceso_dev.courses(id) ON DELETE RESTRICT ON UPDATE CASCADE,
	CONSTRAINT teachers_user_id_fkey FOREIGN KEY (user_id) REFERENCES proceso_dev.users(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX teachers_user_id_key ON proceso_dev.teachers USING btree (user_id);


-- proceso_dev.user_profiles definition

-- Drop table

-- DROP TABLE proceso_dev.user_profiles;

CREATE TABLE proceso_dev.user_profiles (
	id uuid NOT NULL,
	user_id uuid NOT NULL,
	dni varchar(10) NOT NULL,
	first_name varchar(128) NOT NULL,
	last_name varchar(128) NOT NULL,
	phone varchar(15) NULL,
	phones_additional _varchar NULL,
	address varchar(255) NULL,
	personal_email varchar(48) NULL,
	is_active bool DEFAULT true NOT NULL,
	created_at timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	updated_at timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT user_profiles_pkey PRIMARY KEY (id),
	CONSTRAINT user_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES proceso_dev.users(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX user_profiles_dni_key ON proceso_dev.user_profiles USING btree (dni);
CREATE UNIQUE INDEX user_profiles_personal_email_key ON proceso_dev.user_profiles USING btree (personal_email);
CREATE UNIQUE INDEX user_profiles_user_id_key ON proceso_dev.user_profiles USING btree (user_id);


-- proceso_dev.monitors definition

-- Drop table

-- DROP TABLE proceso_dev.monitors;

CREATE TABLE proceso_dev.monitors (
	id uuid NOT NULL,
	user_id uuid NOT NULL,
	supervisor_id uuid NULL,
	created_at timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	updated_at timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT monitors_pkey PRIMARY KEY (id),
	CONSTRAINT monitors_supervisor_id_fkey FOREIGN KEY (supervisor_id) REFERENCES proceso_dev.supervisors(id) ON DELETE RESTRICT ON UPDATE CASCADE,
	CONSTRAINT monitors_user_id_fkey FOREIGN KEY (user_id) REFERENCES proceso_dev.users(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX monitors_user_id_key ON proceso_dev.monitors USING btree (user_id);


-- proceso_dev.classes definition

-- Drop table

-- DROP TABLE proceso_dev.classes;

CREATE TABLE proceso_dev.classes (
	id uuid NOT NULL,
	"name" varchar(48) NOT NULL,
	id_sede int2 NOT NULL,
	area_id int2 NOT NULL,
	shift_id int2 NOT NULL,
	monitor_id uuid NULL,
	capacity int2 DEFAULT 100 NOT NULL,
	url_meet varchar(48) NULL,
	CONSTRAINT classes_pkey PRIMARY KEY (id),
	CONSTRAINT classes_area_id_fkey FOREIGN KEY (area_id) REFERENCES proceso_dev.areas(id) ON DELETE RESTRICT ON UPDATE CASCADE,
	CONSTRAINT classes_id_sede_fkey FOREIGN KEY (id_sede) REFERENCES proceso_dev.sedes(id) ON DELETE RESTRICT ON UPDATE CASCADE,
	CONSTRAINT classes_monitor_id_fkey FOREIGN KEY (monitor_id) REFERENCES proceso_dev.monitors(id) ON DELETE SET NULL ON UPDATE CASCADE,
	CONSTRAINT classes_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES proceso_dev.shifts(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX classes_id_sede_idx ON proceso_dev.classes USING btree (id_sede);
CREATE UNIQUE INDEX classes_monitor_id_key ON proceso_dev.classes USING btree (monitor_id);


-- proceso_dev.schedules definition

-- Drop table

-- DROP TABLE proceso_dev.schedules;

CREATE TABLE proceso_dev.schedules (
	id serial4 NOT NULL,
	class_id uuid NOT NULL,
	course_id int2 NOT NULL,
	hour_session_id int2 NOT NULL,
	teacher_id uuid NULL,
	"weekday" proceso_dev."Weekday" NOT NULL,
	CONSTRAINT schedules_pkey PRIMARY KEY (id),
	CONSTRAINT schedules_class_id_fkey FOREIGN KEY (class_id) REFERENCES proceso_dev.classes(id) ON DELETE RESTRICT ON UPDATE CASCADE,
	CONSTRAINT schedules_course_id_fkey FOREIGN KEY (course_id) REFERENCES proceso_dev.courses(id) ON DELETE RESTRICT ON UPDATE CASCADE,
	CONSTRAINT schedules_hour_session_id_fkey FOREIGN KEY (hour_session_id) REFERENCES proceso_dev.hour_sessions(id) ON DELETE RESTRICT ON UPDATE CASCADE,
	CONSTRAINT schedules_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES proceso_dev.teachers(id) ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX schedules_course_id_hour_session_id_teacher_id_weekday_key ON proceso_dev.schedules USING btree (course_id, hour_session_id, teacher_id, weekday);