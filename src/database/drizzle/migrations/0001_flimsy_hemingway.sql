ALTER TABLE "admission_processes" ADD COLUMN "session_minutes" smallint DEFAULT 40 NOT NULL;--> statement-breakpoint
ALTER TABLE "admission_processes" ADD COLUMN "break_minutes" smallint DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "admission_processes" ADD CONSTRAINT "session_minutes_range" CHECK ("admission_processes"."session_minutes" BETWEEN 1 AND 180);--> statement-breakpoint
ALTER TABLE "admission_processes" ADD CONSTRAINT "break_minutes_range" CHECK ("admission_processes"."break_minutes" BETWEEN 0 AND 120);