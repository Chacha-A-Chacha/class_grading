-- Audit follow-up, 14 October 2026. Rules Prisma cannot describe; keep them in SQL.

-- Admission numbers are stored trimmed and uppercase so the existing unique index
-- also rejects case/whitespace variants written outside the import service.
ALTER TABLE "User" ADD CONSTRAINT "User_normalized_admission" CHECK (
  "admissionNumber" IS NULL
  OR ("admissionNumber" = upper(btrim("admissionNumber")) AND length("admissionNumber") > 0));

-- A committed import keeps only its receipt; an uncommitted one holds an array of rows.
ALTER TABLE "StudentImport" ADD CONSTRAINT "StudentImport_valid_state" CHECK (
  "expiresAt" > "createdAt"
  AND ("rows" IS NULL OR jsonb_typeof("rows") = 'array')
  AND ("committedAt" IS NULL
       OR ("rows" IS NULL AND "result" IS NOT NULL AND cardinality("selection") > 0)));

-- recordVersion is optimistic-concurrency metadata, not assessed content; retiring an
-- activated version may increment it.
CREATE OR REPLACE FUNCTION protect_question_version() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE option_count integer;
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
    IF option_count NOT BETWEEN 2 AND 6 OR NEW."activatedAt" IS NULL
       OR NOT EXISTS (SELECT 1 FROM "QuestionAnswerKey" WHERE "questionVersionId" = NEW."id") THEN
      RAISE EXCEPTION 'Activation needs 2-6 options, one answer key and activatedAt' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Assessments are created as drafts. After publication, release is write-once, the
-- scoring revision only moves forward and archiving is final.
CREATE OR REPLACE FUNCTION protect_assessment_state() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'DRAFT' THEN RAISE EXCEPTION 'Published assessments cannot be deleted' USING ERRCODE = '23514'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'DRAFT' OR NEW."publishedAt" IS NOT NULL OR NEW."releasedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'Create a draft assessment before publishing' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."status" = 'DRAFT' AND NEW."releasedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Draft assessments cannot release results' USING ERRCODE = '23514';
  END IF;
  IF OLD."status" <> 'DRAFT' THEN
    IF NEW."status" = 'DRAFT' OR NEW."publishedAt" IS DISTINCT FROM OLD."publishedAt"
       OR (NEW."title", NEW."durationSeconds", NEW."passPercent", NEW."rulesVersion", NEW."rulesSnapshot", NEW."maxOverlapPercent")
          IS DISTINCT FROM (OLD."title", OLD."durationSeconds", OLD."passPercent", OLD."rulesVersion", OLD."rulesSnapshot", OLD."maxOverlapPercent") THEN
      RAISE EXCEPTION 'Published assessment settings are frozen' USING ERRCODE = '23514';
    END IF;
    IF (OLD."releasedAt" IS NOT NULL AND NEW."releasedAt" IS DISTINCT FROM OLD."releasedAt")
       OR NEW."scoringRevision" < OLD."scoringRevision"
       OR (OLD."status" = 'ARCHIVED' AND NEW."status" <> 'ARCHIVED') THEN
      RAISE EXCEPTION 'Release, scoring revision and archiving cannot be reversed' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER "Assessment_protect" ON "Assessment";
CREATE TRIGGER "Assessment_protect" BEFORE INSERT OR UPDATE OR DELETE ON "Assessment"
  FOR EACH ROW EXECUTE FUNCTION protect_assessment_state();

-- Hot rows during an exam: leave page space so lastSeenAt/current-answer updates can be
-- HOT (heap-only) updates that skip index writes. Applies to newly written pages.
ALTER TABLE "Attempt" SET (fillfactor = 80);
ALTER TABLE "AttemptAnswer" SET (fillfactor = 80);
