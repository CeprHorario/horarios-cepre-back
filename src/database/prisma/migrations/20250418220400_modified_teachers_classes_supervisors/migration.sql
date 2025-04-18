/*
  Warnings:

  - You are about to drop the column `is_active` on the `teachers` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "classes" ADD COLUMN     "url_classroom" VARCHAR(64);

-- AlterTable
ALTER TABLE "supervisors" ADD COLUMN     "shift_id" SMALLINT;

-- AlterTable
ALTER TABLE "teachers" DROP COLUMN "is_active";

-- AlterTable
ALTER TABLE "user_profiles" ALTER COLUMN "dni" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "supervisors" ADD CONSTRAINT "supervisors_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
