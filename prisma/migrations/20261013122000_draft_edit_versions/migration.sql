-- AlterTable
ALTER TABLE "QuestionVersion" ADD COLUMN     "recordVersion" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "QuestionVersion" ADD CONSTRAINT "QuestionVersion_positive_record_version"
  CHECK ("recordVersion" > 0);
