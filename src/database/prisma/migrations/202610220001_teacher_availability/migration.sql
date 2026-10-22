CREATE TABLE "teacher_availabilities" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "teacher_id" UUID NOT NULL,
  "weekday" "Weekday" NOT NULL,
  "start_minute" SMALLINT NOT NULL,
  "end_minute" SMALLINT NOT NULL,
  CONSTRAINT "teacher_availabilities_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "teacher_availabilities_valid_range" CHECK (
    "start_minute" >= 0 AND "start_minute" < "end_minute" AND "end_minute" <= 1440
  ),
  CONSTRAINT "teacher_availabilities_teacher_id_fkey" FOREIGN KEY ("teacher_id")
    REFERENCES "teachers"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "teacher_availabilities_teacher_id_weekday_start_minute_end_minute_key"
  ON "teacher_availabilities"("teacher_id", "weekday", "start_minute", "end_minute");
