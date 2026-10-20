-- Multiple-select questions ("select all that apply"), scored all-or-nothing.

-- CreateEnum
CREATE TYPE "AnswerMode" AS ENUM ('SINGLE', 'MULTIPLE');

-- AlterTable
ALTER TABLE "QuestionVersion" ADD COLUMN     "answerMode" "AnswerMode" NOT NULL DEFAULT 'SINGLE';

-- AlterTable: one answer-key row per correct option.
ALTER TABLE "QuestionAnswerKey" DROP CONSTRAINT "QuestionAnswerKey_pkey",
ADD CONSTRAINT "QuestionAnswerKey_pkey" PRIMARY KEY ("questionVersionId", "correctOptionId");

-- AlterTable
ALTER TABLE "AttemptAnswer" ADD COLUMN     "selectedOptionIds" UUID[] DEFAULT ARRAY[]::UUID[];

-- AlterTable
ALTER TABLE "AnswerMutation" ADD COLUMN     "selectedOptionIds" UUID[] DEFAULT ARRAY[]::UUID[];

-- Rules Prisma cannot describe. A selection is either one option (SINGLE) or a set (MULTIPLE),
-- never both; a set has at most six distinct, non-null IDs.
ALTER TABLE "AttemptAnswer" ADD CONSTRAINT "AttemptAnswer_valid_selection" CHECK (
  "selectedOptionIds" IS NOT NULL AND cardinality("selectedOptionIds") <= 6
  AND array_position("selectedOptionIds", NULL) IS NULL
  AND ("selectedOptionId" IS NULL OR cardinality("selectedOptionIds") = 0));
ALTER TABLE "AnswerMutation" ADD CONSTRAINT "AnswerMutation_valid_selection" CHECK (
  "selectedOptionIds" IS NOT NULL AND cardinality("selectedOptionIds") <= 6
  AND array_position("selectedOptionIds", NULL) IS NULL
  AND ("selectedOptionId" IS NULL OR cardinality("selectedOptionIds") = 0));

-- Arrays cannot carry foreign keys, so a trigger proves every selected option was shown
-- for that attempt question, and that the selection shape matches the question's mode.
CREATE FUNCTION check_option_selection() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE mode "AnswerMode";
BEGIN
  SELECT v."answerMode" INTO mode FROM "AttemptQuestion" q JOIN "QuestionVersion" v ON v.id = q."questionVersionId" WHERE q.id = NEW."attemptQuestionId";
  IF mode = 'MULTIPLE' AND NEW."selectedOptionId" IS NOT NULL THEN
    RAISE EXCEPTION 'Multiple-select answers use selectedOptionIds' USING ERRCODE = '23514';
  END IF;
  IF mode = 'SINGLE' AND cardinality(NEW."selectedOptionIds") > 0 THEN
    RAISE EXCEPTION 'Single-answer questions accept one selectedOptionId' USING ERRCODE = '23514';
  END IF;
  IF cardinality(NEW."selectedOptionIds") > 0 THEN
    IF (SELECT count(DISTINCT x) FROM unnest(NEW."selectedOptionIds") AS x) <> cardinality(NEW."selectedOptionIds") THEN
      RAISE EXCEPTION 'Selected options must be distinct' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(NEW."selectedOptionIds") AS x WHERE NOT EXISTS (
      SELECT 1 FROM "AttemptOption" o WHERE o."attemptQuestionId" = NEW."attemptQuestionId" AND o."questionOptionId" = x)) THEN
      RAISE EXCEPTION 'Selected options must have been shown for this question' USING ERRCODE = '23503';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "AttemptAnswer_selection" BEFORE INSERT OR UPDATE ON "AttemptAnswer"
  FOR EACH ROW EXECUTE FUNCTION check_option_selection();
CREATE TRIGGER "AnswerMutation_selection" BEFORE INSERT ON "AnswerMutation"
  FOR EACH ROW EXECUTE FUNCTION check_option_selection();

-- Activation: SINGLE needs exactly one key; MULTIPLE needs at least one key and three options.
CREATE OR REPLACE FUNCTION protect_question_version() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE option_count integer; key_count integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'DRAFT' THEN RAISE EXCEPTION 'Active/retired question versions cannot be deleted' USING ERRCODE = '23514'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' AND NEW."status" <> 'DRAFT' THEN
    RAISE EXCEPTION 'Create a draft before activating a question' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."status" <> 'DRAFT' THEN
    IF (to_jsonb(NEW) - 'status' - 'updatedAt' - 'recordVersion') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'updatedAt' - 'recordVersion')
       OR NEW."status" = 'DRAFT' OR (OLD."status" = 'RETIRED' AND NEW."status" <> 'RETIRED') THEN
      RAISE EXCEPTION 'Create a new question version to change activated content' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW."status" = 'ACTIVE' AND (TG_OP = 'INSERT' OR OLD."status" = 'DRAFT') THEN
    SELECT count(*) INTO option_count FROM "QuestionOption" WHERE "questionVersionId" = NEW."id";
    SELECT count(*) INTO key_count FROM "QuestionAnswerKey" WHERE "questionVersionId" = NEW."id";
    IF option_count NOT BETWEEN 2 AND 6 OR NEW."activatedAt" IS NULL
       OR (NEW."answerMode" = 'SINGLE' AND key_count <> 1)
       OR (NEW."answerMode" = 'MULTIPLE' AND (key_count < 1 OR option_count < 3)) THEN
      RAISE EXCEPTION 'Activation needs 2-6 options and one key (or, for multiple-select, 3-6 options and at least one key)' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
