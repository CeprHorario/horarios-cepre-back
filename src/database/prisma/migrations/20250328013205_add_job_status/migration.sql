/*
  Warnings:

  - You are about to drop the column `job_shift_type` on the `teachers` table. All the data in the column will be lost.
  - You are about to drop the column `address` on the `user_profiles` table. All the data in the column will be lost.
  - Added the required column `job_status` to the `teachers` table without a default value. This is not possible if the table is not empty.
  - Made the column `scheduled_hours` on table `teachers` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateEnum
CREATE TYPE "job_statuses" AS ENUM ('FULL_TIME', 'PART_TIME', 'FREE_TIME');

-- AlterTable
ALTER TABLE "teachers" DROP COLUMN "job_shift_type",
ADD COLUMN     "is_coordinator" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "job_status" "job_statuses" NOT NULL,
ALTER COLUMN "scheduled_hours" SET NOT NULL,
ALTER COLUMN "scheduled_hours" SET DEFAULT 0;

-- AlterTable
ALTER TABLE "user_profiles" DROP COLUMN "address";

-- DropEnum
DROP TYPE "job_shift_types";
