-- Prisma does not represent CHECK constraints, partial indexes or triggers.
-- Keep these rules in migrations; do not replace migrate deploy with db push.
BEGIN;

CREATE UNIQUE INDEX "User_single_admin" ON "User" ("isAdmin") WHERE "isAdmin";
CREATE UNIQUE INDEX "Attempt_one_active_per_assignment"
  ON "Attempt" ("assignmentId") WHERE "status" = 'ACTIVE';
CREATE INDEX "Attempt_expiry_sweep" ON "Attempt" ("expiresAt", "id") WHERE "status" = 'ACTIVE';
CREATE INDEX "Job_pending_claim" ON "Job" ("availableAt", "id") WHERE "status" = 'PENDING';
CREATE INDEX "Job_expired_lease" ON "Job" ("leaseUntil", "id") WHERE "status" = 'RUNNING';

ALTER TABLE "User" ADD CONSTRAINT "User_normalized_email"
  CHECK ("email" = lower(btrim("email")) AND length("email") > 3);
ALTER TABLE "User" ADD CONSTRAINT "User_nonempty_name" CHECK (length(btrim("displayName")) > 0);
ALTER TABLE "Session" ADD CONSTRAINT "Session_valid_expiry" CHECK ("expiresAt" > "authenticatedAt");
ALTER TABLE "EmailLoginChallenge" ADD CONSTRAINT "Challenge_valid_window" CHECK (
  "expiresAt" > "issuedAt" AND "expiresAt" <= "issuedAt" + interval '2 minutes'
  AND "resendAvailableAt" >= "issuedAt" + interval '30 seconds'
  AND "failedAttempts" BETWEEN 0 AND 5);
ALTER TABLE "EmailLoginChallenge" ADD CONSTRAINT "Challenge_valid_purpose" CHECK (
  ("purpose" = 'LOGIN' AND "targetAttemptId" IS NULL AND "requestingSessionId" IS NULL)
  OR ("purpose" = 'TAKEOVER' AND "targetAttemptId" IS NOT NULL AND "requestingSessionId" IS NOT NULL));
ALTER TABLE "EmailLoginChallenge" ADD CONSTRAINT "Challenge_valid_grant" CHECK (
  ("grantHash" IS NULL AND "grantExpiresAt" IS NULL AND "grantConsumedAt" IS NULL)
  OR ("purpose" = 'TAKEOVER' AND "grantHash" IS NOT NULL AND "consumedAt" IS NOT NULL
      AND "grantExpiresAt" IS NOT NULL AND "grantExpiresAt" > "consumedAt"
      AND "grantExpiresAt" <= "consumedAt" + interval '2 minutes'));
ALTER TABLE "AuthRateLimitBucket" ADD CONSTRAINT "RateLimit_valid_bucket"
  CHECK ("count" >= 0 AND "expiresAt" > "windowStart");
ALTER TABLE "QuestionVersion" ADD CONSTRAINT "QuestionVersion_valid_values"
  CHECK ("version" > 0 AND "expectedSeconds" > 0 AND length(btrim("prompt")) > 0
    AND length(btrim("objective")) > 0 AND length(btrim("explanation")) > 0);
ALTER TABLE "QuestionVersion" ADD CONSTRAINT "QuestionVersion_code_context"
  CHECK ("kind" <> 'CODE' OR ("code" IS NOT NULL AND "language" IS NOT NULL AND "runtimeContext" IS NOT NULL));
ALTER TABLE "QuestionOption" ADD CONSTRAINT "QuestionOption_valid_position"
  CHECK ("position" BETWEEN 1 AND 6 AND length(btrim("content")) > 0);
ALTER TABLE "BlueprintSlot" ADD CONSTRAINT "BlueprintSlot_valid_values"
  CHECK ("position" > 0 AND ("maxSeconds" IS NULL OR "maxSeconds" > 0));
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_valid_settings" CHECK (
  "durationSeconds" > 0 AND "passPercent" BETWEEN 0 AND 100
  AND "maxOverlapPercent" BETWEEN 0 AND 100 AND "recordVersion" > 0 AND "scoringRevision" > 0
  AND "openAt" <= "latestStartAt"
  AND "latestStartAt" + "durationSeconds" * interval '1 second' <= "hardCloseAt");
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_release_requires_publish"
  CHECK ("releasedAt" IS NULL OR ("publishedAt" IS NOT NULL AND "releasedAt" >= "publishedAt"));
ALTER TABLE "SetItem" ADD CONSTRAINT "SetItem_valid_position" CHECK ("position" > 0);
ALTER TABLE "AssessmentAssignment" ADD CONSTRAINT "Assignment_valid_settings" CHECK (
  "durationSeconds" > 0 AND "allowedAttemptCount" > 0 AND "recordVersion" > 0
  AND "openAt" <= "latestStartAt"
  AND "latestStartAt" + "durationSeconds" * interval '1 second' <= "hardCloseAt");
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_valid_values" CHECK (
  "attemptNumber" > 0 AND "currentGeneration" > 0 AND "recordVersion" > 0
  AND "passPercent" BETWEEN 0 AND 100 AND "startedAt" < "expiresAt"
  AND "expiresAt" <= "hardCloseAt" AND "acknowledgedAt" <= "startedAt");
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_terminal_state" CHECK (
  ("status" = 'ACTIVE' AND "terminalAt" IS NULL AND "submittedAt" IS NULL AND "submissionReceiptId" IS NULL)
  OR ("status" = 'SUBMITTED' AND "terminalAt" IS NOT NULL AND "submittedAt" IS NOT NULL
      AND "submittedAt" >= "startedAt" AND "submittedAt" < "expiresAt" AND "submissionReceiptId" IS NOT NULL)
  OR ("status" = 'EXPIRED' AND "terminalAt" IS NOT NULL AND "terminalAt" >= "expiresAt" AND "submittedAt" IS NULL)
  OR ("status" = 'VOIDED' AND "terminalAt" IS NOT NULL AND "terminalReason" IS NOT NULL AND length(btrim("terminalReason")) > 0));
ALTER TABLE "AttemptOption" ADD CONSTRAINT "AttemptOption_valid_position" CHECK ("displayPosition" BETWEEN 1 AND 6);
ALTER TABLE "AttemptAnswer" ADD CONSTRAINT "AttemptAnswer_positive_revision"
  CHECK ("revision" > 0 AND "sessionGeneration" > 0 AND "lastSequence" > 0);
ALTER TABLE "AttemptSession" ADD CONSTRAINT "AttemptSession_positive_generation" CHECK ("generation" > 0);
ALTER TABLE "AnswerMutation" ADD CONSTRAINT "AnswerMutation_positive_revision"
  CHECK ("sessionGeneration" > 0 AND "sequence" > 0 AND "resultRevision" > 0);
ALTER TABLE "AttemptEvent" ADD CONSTRAINT "AttemptEvent_valid_interval"
  CHECK ("clientEndedAt" IS NULL OR ("clientOccurredAt" IS NOT NULL AND "clientEndedAt" >= "clientOccurredAt"));
ALTER TABLE "ScoreRevision" ADD CONSTRAINT "ScoreRevision_valid_score" CHECK (
  "scoringRevision" > 0 AND "rawCorrect" >= 0 AND "availablePoints" >= "rawCorrect"
  AND (("availablePoints" = 0 AND "passed" IS NULL) OR ("availablePoints" > 0 AND "passed" IS NOT NULL)));
ALTER TABLE "ItemExclusion" ADD CONSTRAINT "ItemExclusion_reason"
  CHECK ("scoringRevision" > 1 AND length(btrim("reason")) > 0);
ALTER TABLE "ReviewCase" ADD CONSTRAINT "ReviewCase_resolution" CHECK (
  ("status" = 'OPEN' AND "resolvedAt" IS NULL)
  OR ("status" = 'RESOLVED' AND "resolvedAt" IS NOT NULL AND "disposition" IS NOT NULL
      AND "resolution" IS NOT NULL AND length(btrim("resolution")) > 0));
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_reason" CHECK (length(btrim("reason")) > 0);
ALTER TABLE "Job" ADD CONSTRAINT "Job_valid_values" CHECK (
  "attempts" >= 0
  AND (("kind" = 'RESCORE' AND "assessmentId" IS NOT NULL AND "scoringRevision" IS NOT NULL AND "scoringRevision" > 1) OR "kind" = 'RETENTION')
  AND (("status" = 'RUNNING' AND "leaseUntil" IS NOT NULL AND "leaseToken" IS NOT NULL)
    OR ("status" <> 'RUNNING' AND "leaseUntil" IS NULL AND "leaseToken" IS NULL)));

-- Freeze assessed question content after the owner's activation check.
CREATE FUNCTION protect_question_version() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
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
    IF (to_jsonb(NEW) - 'status' - 'updatedAt') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'updatedAt')
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
CREATE TRIGGER "QuestionVersion_protect" BEFORE INSERT OR UPDATE OR DELETE ON "QuestionVersion"
  FOR EACH ROW EXECUTE FUNCTION protect_question_version();

CREATE FUNCTION protect_question_child() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE version_id uuid; version_status "QuestionStatus";
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."questionVersionId" <> OLD."questionVersionId" THEN
    RAISE EXCEPTION 'Question children cannot move between versions' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN version_id := OLD."questionVersionId"; ELSE version_id := NEW."questionVersionId"; END IF;
  SELECT "status" INTO version_status FROM "QuestionVersion" WHERE "id" = version_id FOR UPDATE;
  IF version_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Options, keys and tags of activated questions are immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
CREATE TRIGGER "QuestionOption_protect" BEFORE INSERT OR UPDATE OR DELETE ON "QuestionOption"
  FOR EACH ROW EXECUTE FUNCTION protect_question_child();
CREATE TRIGGER "QuestionAnswerKey_protect" BEFORE INSERT OR UPDATE OR DELETE ON "QuestionAnswerKey"
  FOR EACH ROW EXECUTE FUNCTION protect_question_child();
CREATE TRIGGER "QuestionTopic_protect" BEFORE INSERT OR UPDATE OR DELETE ON "QuestionTopic"
  FOR EACH ROW EXECUTE FUNCTION protect_question_child();

-- Publication and content mutations serialize on the same assessment row.
CREATE FUNCTION protect_assessment_content() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE assessment_id uuid; parent_id uuid; assessment_status "AssessmentStatus";
BEGIN
  IF TG_TABLE_NAME = 'SetItem' THEN
    IF TG_OP = 'UPDATE' AND NEW."setId" <> OLD."setId" THEN
      RAISE EXCEPTION 'Set items cannot move between sets' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'DELETE' THEN parent_id := OLD."setId"; ELSE parent_id := NEW."setId"; END IF;
    SELECT "assessmentId" INTO assessment_id FROM "AssessmentSet" WHERE "id" = parent_id;
  ELSE
    IF TG_OP = 'UPDATE' AND NEW."assessmentId" <> OLD."assessmentId" THEN
      RAISE EXCEPTION 'Published content cannot move between assessments' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'DELETE' THEN assessment_id := OLD."assessmentId"; ELSE assessment_id := NEW."assessmentId"; END IF;
  END IF;
  SELECT "status" INTO assessment_status FROM "Assessment" WHERE "id" = assessment_id FOR UPDATE;
  IF assessment_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Published sets and blueprint slots are immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
CREATE TRIGGER "AssessmentSet_protect" BEFORE INSERT OR UPDATE OR DELETE ON "AssessmentSet"
  FOR EACH ROW EXECUTE FUNCTION protect_assessment_content();
CREATE TRIGGER "SetItem_protect" BEFORE INSERT OR UPDATE OR DELETE ON "SetItem"
  FOR EACH ROW EXECUTE FUNCTION protect_assessment_content();
CREATE TRIGGER "BlueprintSlot_protect" BEFORE INSERT OR UPDATE OR DELETE ON "BlueprintSlot"
  FOR EACH ROW EXECUTE FUNCTION protect_assessment_content();

CREATE FUNCTION protect_assessment_state() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'DRAFT' THEN RAISE EXCEPTION 'Published assessments cannot be deleted' USING ERRCODE = '23514'; END IF;
    RETURN OLD;
  END IF;
  IF OLD."status" <> 'DRAFT' THEN
    IF NEW."status" = 'DRAFT' OR NEW."publishedAt" IS DISTINCT FROM OLD."publishedAt"
       OR (NEW."title", NEW."durationSeconds", NEW."passPercent", NEW."rulesVersion", NEW."rulesSnapshot", NEW."maxOverlapPercent")
          IS DISTINCT FROM (OLD."title", OLD."durationSeconds", OLD."passPercent", OLD."rulesVersion", OLD."rulesSnapshot", OLD."maxOverlapPercent") THEN
      RAISE EXCEPTION 'Published assessment settings are frozen' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "Assessment_protect" BEFORE UPDATE OR DELETE ON "Assessment"
  FOR EACH ROW EXECUTE FUNCTION protect_assessment_state();

CREATE FUNCTION reject_history_update() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  RAISE EXCEPTION 'History is immutable; append a new record' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER "AnswerMutation_immutable" BEFORE UPDATE ON "AnswerMutation" FOR EACH ROW EXECUTE FUNCTION reject_history_update();
CREATE TRIGGER "ScoreRevision_immutable" BEFORE UPDATE ON "ScoreRevision" FOR EACH ROW EXECUTE FUNCTION reject_history_update();
CREATE TRIGGER "AuditLog_immutable" BEFORE UPDATE ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION reject_history_update();

COMMIT;
