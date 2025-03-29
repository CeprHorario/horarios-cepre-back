CREATE TABLE "admission_processes" (
	"id" "smallserial" PRIMARY KEY NOT NULL,
	"name" varchar(48) NOT NULL,
	"year" smallint NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"description" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "year" CHECK ("admission_processes"."year" BETWEEN 2020 AND 2100)
);
--> statement-breakpoint
CREATE TABLE "observations" (
	"id" serial PRIMARY KEY NOT NULL,
	"description" varchar(500),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"admission_process_id" "smallserial" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(48) NOT NULL,
	"path" varchar(128) NOT NULL,
	"method_http" varchar(16) NOT NULL,
	"description" varchar(255),
	"created_at" timestamp (3) DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "permissions_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" "smallserial" PRIMARY KEY NOT NULL,
	"name" varchar(48) NOT NULL,
	"description" varchar(255),
	"created_at" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles_permissions" (
	"role_id" smallint NOT NULL,
	"permission_id" integer NOT NULL,
	"created_at" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "roles_permissions_role_id_permission_id_pk" PRIMARY KEY("role_id","permission_id")
);
--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_admission_process_id_admission_processes_id_fk" FOREIGN KEY ("admission_process_id") REFERENCES "public"."admission_processes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles_permissions" ADD CONSTRAINT "roles_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles_permissions" ADD CONSTRAINT "roles_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "admission_process_name_unique" ON "admission_processes" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "role_name_unique" ON "roles" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "role_permission_unique" ON "roles_permissions" USING btree ("role_id","permission_id");