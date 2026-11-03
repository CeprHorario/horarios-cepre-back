CREATE TABLE "operation_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_id" uuid NOT NULL,
	"recipient_origin" varchar(48) NOT NULL,
	"process_schema" varchar(48) NOT NULL,
	"kind" varchar(32) NOT NULL,
	"title" varchar(160) NOT NULL,
	"message" text NOT NULL,
	"request_id" uuid,
	"dedupe_key" varchar(180) NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "person_incidences" DROP CONSTRAINT "person_incidence_role";--> statement-breakpoint
CREATE UNIQUE INDEX "operation_notification_dedupe" ON "operation_notifications" USING btree ("recipient_id","recipient_origin","dedupe_key");--> statement-breakpoint
CREATE INDEX "operation_notifications_recipient" ON "operation_notifications" USING btree ("recipient_id","recipient_origin","process_schema","created_at");--> statement-breakpoint
ALTER TABLE "person_incidences" ADD CONSTRAINT "person_incidence_role" CHECK ("person_incidences"."subject_role" IN ('profesor','monitor','supervisor','administrador','coordinador'));