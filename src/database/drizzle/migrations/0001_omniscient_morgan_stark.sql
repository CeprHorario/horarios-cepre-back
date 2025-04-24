ALTER TABLE "admission_processes" ADD COLUMN "started" date DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "admission_processes" ADD COLUMN "finished" date DEFAULT now() NOT NULL;