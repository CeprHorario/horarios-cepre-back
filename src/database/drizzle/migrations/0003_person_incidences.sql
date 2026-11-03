CREATE TABLE "person_incidence_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"incidence_id" uuid NOT NULL,
	"action" varchar(32) NOT NULL,
	"actor" jsonb NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "person_incidences" (
	"id" uuid PRIMARY KEY NOT NULL,
	"subject_dni" varchar(8) NOT NULL,
	"subject_role" varchar(16) NOT NULL,
	"subject_account_id" uuid NOT NULL,
	"subject_name" varchar(260) NOT NULL,
	"process_schema" varchar(48) NOT NULL,
	"record_id" integer,
	"class_id" uuid,
	"title" varchar(120) NOT NULL,
	"description" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"actor" jsonb NOT NULL,
	"actor_id" uuid NOT NULL,
	"actor_origin" varchar(48) NOT NULL,
	"status" varchar(16) DEFAULT 'OPEN' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "person_incidence_dni" CHECK ("person_incidences"."subject_dni" ~ '^[0-9]{8}$'),
	CONSTRAINT "person_incidence_role" CHECK ("person_incidences"."subject_role" IN ('profesor','monitor','supervisor')),
	CONSTRAINT "person_incidence_status" CHECK ("person_incidences"."status" IN ('OPEN','RESOLVED')),
	CONSTRAINT "person_incidence_version" CHECK ("person_incidences"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "person_incidence_events" ADD CONSTRAINT "person_incidence_events_incidence_id_person_incidences_id_fk" FOREIGN KEY ("incidence_id") REFERENCES "public"."person_incidences"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "person_incidence_events_incidence_idx" ON "person_incidence_events" USING btree ("incidence_id","id");--> statement-breakpoint
CREATE INDEX "person_incidences_dni_created_idx" ON "person_incidences" USING btree ("subject_dni","created_at");--> statement-breakpoint
CREATE INDEX "person_incidences_status_created_idx" ON "person_incidences" USING btree ("status","created_at");
--> statement-breakpoint
CREATE FUNCTION public.protect_incidence_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR TG_TABLE_NAME='person_incidence_events' THEN
    RAISE EXCEPTION 'INCIDENCE_HISTORY_IMMUTABLE';
  END IF;
  IF (to_jsonb(NEW)-'status'-'version'-'seen_at') IS DISTINCT FROM (to_jsonb(OLD)-'status'-'version'-'seen_at') THEN
    RAISE EXCEPTION 'INCIDENCE_HISTORY_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER incidence_history_guard BEFORE UPDATE OR DELETE ON public.person_incidences FOR EACH ROW EXECUTE FUNCTION public.protect_incidence_history();
--> statement-breakpoint
CREATE TRIGGER incidence_events_guard BEFORE UPDATE OR DELETE ON public.person_incidence_events FOR EACH ROW EXECUTE FUNCTION public.protect_incidence_history();
