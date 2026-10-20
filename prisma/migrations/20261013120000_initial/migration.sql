-- CreateEnum
CREATE TYPE "ChallengePurpose" AS ENUM ('LOGIN', 'TAKEOVER');

-- CreateEnum
CREATE TYPE "QuestionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "QuestionKind" AS ENUM ('CODE', 'THEORY');

-- CreateEnum
CREATE TYPE "ContentKind" AS ENUM ('TEXT', 'CODE');

-- CreateEnum
CREATE TYPE "Difficulty" AS ENUM ('EASY', 'MEDIUM', 'HARD');

-- CreateEnum
CREATE TYPE "AssessmentStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AttemptStatus" AS ENUM ('ACTIVE', 'SUBMITTED', 'EXPIRED', 'VOIDED');

-- CreateEnum
CREATE TYPE "EventKind" AS ENUM ('AWAY', 'SAVE_ERROR', 'CONNECTION_GAP', 'TAKEOVER');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateEnum
CREATE TYPE "ReviewDisposition" AS ENUM ('NO_ISSUE', 'TECHNICAL_ISSUE', 'NEEDS_FOLLOW_UP', 'POLICY_VIOLATION');

-- CreateEnum
CREATE TYPE "JobKind" AS ENUM ('RESCORE', 'RETENTION');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" VARCHAR(254) NOT NULL,
    "displayName" VARCHAR(120) NOT NULL,
    "admissionNumber" VARCHAR(80),
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "emailVerifiedAt" TIMESTAMPTZ(3),
    "disabledAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "authenticatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mfaVerifiedAt" TIMESTAMPTZ(3),
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminAuthenticator" (
    "userId" UUID NOT NULL,
    "encryptedTotpSecret" BYTEA NOT NULL,
    "recoveryCodeHashes" TEXT[],
    "confirmedAt" TIMESTAMPTZ(3),
    "lastUsedStep" BIGINT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AdminAuthenticator_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "EmailLoginChallenge" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "purpose" "ChallengePurpose" NOT NULL,
    "codeVerifier" CHAR(64) NOT NULL,
    "browserBindingHash" CHAR(64) NOT NULL,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "issuedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "resendAvailableAt" TIMESTAMPTZ(3) NOT NULL,
    "consumedAt" TIMESTAMPTZ(3),
    "invalidatedAt" TIMESTAMPTZ(3),
    "targetAttemptId" UUID,
    "requestingSessionId" UUID,
    "grantHash" CHAR(64),
    "grantExpiresAt" TIMESTAMPTZ(3),
    "grantConsumedAt" TIMESTAMPTZ(3),

    CONSTRAINT "EmailLoginChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthRateLimitBucket" (
    "scope" VARCHAR(40) NOT NULL,
    "subjectHash" CHAR(64) NOT NULL,
    "windowStart" TIMESTAMPTZ(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AuthRateLimitBucket_pkey" PRIMARY KEY ("scope","subjectHash","windowStart")
);

-- CreateTable
CREATE TABLE "Question" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retiredAt" TIMESTAMPTZ(3),

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionVersion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "questionId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "QuestionStatus" NOT NULL DEFAULT 'DRAFT',
    "kind" "QuestionKind" NOT NULL,
    "prompt" TEXT NOT NULL,
    "code" TEXT,
    "language" VARCHAR(40),
    "runtimeContext" TEXT,
    "objective" VARCHAR(160) NOT NULL,
    "difficulty" "Difficulty" NOT NULL,
    "expectedSeconds" INTEGER NOT NULL,
    "explanation" TEXT NOT NULL,
    "activatedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "QuestionVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionOption" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "questionVersionId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" "ContentKind" NOT NULL,
    "content" TEXT NOT NULL,

    CONSTRAINT "QuestionOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionAnswerKey" (
    "questionVersionId" UUID NOT NULL,
    "correctOptionId" UUID NOT NULL,

    CONSTRAINT "QuestionAnswerKey_pkey" PRIMARY KEY ("questionVersionId")
);

-- CreateTable
CREATE TABLE "Topic" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(80) NOT NULL,

    CONSTRAINT "Topic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionTopic" (
    "questionVersionId" UUID NOT NULL,
    "topicId" UUID NOT NULL,

    CONSTRAINT "QuestionTopic_pkey" PRIMARY KEY ("questionVersionId","topicId")
);

-- CreateTable
CREATE TABLE "Assessment" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" VARCHAR(200) NOT NULL,
    "status" "AssessmentStatus" NOT NULL DEFAULT 'DRAFT',
    "durationSeconds" INTEGER NOT NULL,
    "passPercent" DECIMAL(5,2) NOT NULL,
    "openAt" TIMESTAMPTZ(3) NOT NULL,
    "latestStartAt" TIMESTAMPTZ(3) NOT NULL,
    "hardCloseAt" TIMESTAMPTZ(3) NOT NULL,
    "rulesVersion" VARCHAR(80) NOT NULL,
    "rulesSnapshot" JSONB NOT NULL,
    "maxOverlapPercent" DECIMAL(5,2) NOT NULL DEFAULT 30,
    "releaseHeld" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMPTZ(3),
    "releasedAt" TIMESTAMPTZ(3),
    "scoringRevision" INTEGER NOT NULL DEFAULT 1,
    "recordVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Assessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlueprintSlot" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "assessmentId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "objective" VARCHAR(160) NOT NULL,
    "topicId" UUID NOT NULL,
    "kind" "QuestionKind" NOT NULL,
    "difficulty" "Difficulty" NOT NULL,
    "maxSeconds" INTEGER,

    CONSTRAINT "BlueprintSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentSet" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "assessmentId" UUID NOT NULL,
    "label" VARCHAR(80) NOT NULL,

    CONSTRAINT "AssessmentSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SetItem" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "setId" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "questionVersionId" UUID NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "SetItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentAssignment" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "assessmentId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "durationSeconds" INTEGER NOT NULL,
    "openAt" TIMESTAMPTZ(3) NOT NULL,
    "latestStartAt" TIMESTAMPTZ(3) NOT NULL,
    "hardCloseAt" TIMESTAMPTZ(3) NOT NULL,
    "allowedAttemptCount" INTEGER NOT NULL DEFAULT 1,
    "accommodationReason" TEXT,
    "revokedAt" TIMESTAMPTZ(3),
    "recordVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AssessmentAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attempt" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "assignmentId" UUID NOT NULL,
    "assessmentId" UUID NOT NULL,
    "setId" UUID NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "startRequestId" UUID NOT NULL,
    "status" "AttemptStatus" NOT NULL DEFAULT 'ACTIVE',
    "startedAt" TIMESTAMPTZ(3) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "hardCloseAt" TIMESTAMPTZ(3) NOT NULL,
    "submittedAt" TIMESTAMPTZ(3),
    "terminalAt" TIMESTAMPTZ(3),
    "terminalReason" TEXT,
    "submissionReceiptId" UUID,
    "passPercent" DECIMAL(5,2) NOT NULL,
    "rulesVersion" VARCHAR(80) NOT NULL,
    "rulesSnapshot" JSONB NOT NULL,
    "acknowledgedAt" TIMESTAMPTZ(3) NOT NULL,
    "currentGeneration" INTEGER NOT NULL DEFAULT 1,
    "recordVersion" INTEGER NOT NULL DEFAULT 1,
    "lastSeenAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttemptQuestion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "attemptId" UUID NOT NULL,
    "setId" UUID NOT NULL,
    "setItemId" UUID NOT NULL,
    "questionVersionId" UUID NOT NULL,
    "markedForReview" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "AttemptQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttemptOption" (
    "attemptQuestionId" UUID NOT NULL,
    "questionOptionId" UUID NOT NULL,
    "questionVersionId" UUID NOT NULL,
    "displayPosition" INTEGER NOT NULL,

    CONSTRAINT "AttemptOption_pkey" PRIMARY KEY ("attemptQuestionId","questionOptionId")
);

-- CreateTable
CREATE TABLE "AttemptAnswer" (
    "attemptQuestionId" UUID NOT NULL,
    "selectedOptionId" UUID,
    "revision" INTEGER NOT NULL,
    "acceptedAt" TIMESTAMPTZ(3) NOT NULL,
    "sessionGeneration" INTEGER NOT NULL,
    "lastSequence" INTEGER NOT NULL,

    CONSTRAINT "AttemptAnswer_pkey" PRIMARY KEY ("attemptQuestionId")
);

-- CreateTable
CREATE TABLE "AttemptSession" (
    "attemptId" UUID NOT NULL,
    "generation" INTEGER NOT NULL,
    "userSessionId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ(3),

    CONSTRAINT "AttemptSession_pkey" PRIMARY KEY ("attemptId","generation")
);

-- CreateTable
CREATE TABLE "AnswerMutation" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "attemptId" UUID NOT NULL,
    "attemptQuestionId" UUID NOT NULL,
    "clientMutationId" UUID NOT NULL,
    "selectedOptionId" UUID,
    "sessionGeneration" INTEGER NOT NULL,
    "sequence" INTEGER NOT NULL,
    "resultRevision" INTEGER NOT NULL,
    "payloadHash" CHAR(64) NOT NULL,
    "acceptedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AnswerMutation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttemptEvent" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "attemptId" UUID NOT NULL,
    "clientEventId" UUID NOT NULL,
    "kind" "EventKind" NOT NULL,
    "clientOccurredAt" TIMESTAMPTZ(3),
    "clientEndedAt" TIMESTAMPTZ(3),
    "serverReceivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "AttemptEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LateAnswerEvidence" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "attemptId" UUID NOT NULL,
    "clientMutationId" UUID NOT NULL,
    "clientOccurredAt" TIMESTAMPTZ(3),
    "serverReceivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" JSONB NOT NULL,
    "payloadHash" CHAR(64) NOT NULL,

    CONSTRAINT "LateAnswerEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoreRevision" (
    "attemptId" UUID NOT NULL,
    "scoringRevision" INTEGER NOT NULL,
    "rawCorrect" INTEGER NOT NULL,
    "availablePoints" INTEGER NOT NULL,
    "passed" BOOLEAN,
    "computedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScoreRevision_pkey" PRIMARY KEY ("attemptId","scoringRevision")
);

-- CreateTable
CREATE TABLE "ItemExclusion" (
    "assessmentId" UUID NOT NULL,
    "questionVersionId" UUID NOT NULL,
    "scoringRevision" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemExclusion_pkey" PRIMARY KEY ("assessmentId","questionVersionId")
);

-- CreateTable
CREATE TABLE "ReviewCase" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "attemptId" UUID NOT NULL,
    "status" "ReviewStatus" NOT NULL DEFAULT 'OPEN',
    "disposition" "ReviewDisposition",
    "reason" TEXT NOT NULL,
    "resolution" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMPTZ(3),

    CONSTRAINT "ReviewCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actorId" UUID,
    "action" VARCHAR(80) NOT NULL,
    "targetType" VARCHAR(80) NOT NULL,
    "targetId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kind" "JobKind" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "assessmentId" UUID,
    "scoringRevision" INTEGER,
    "deduplicationKey" VARCHAR(200) NOT NULL,
    "payload" JSONB,
    "availableAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMPTZ(3),
    "leaseToken" UUID,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_admissionNumber_key" ON "User"("admissionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmailLoginChallenge_grantHash_key" ON "EmailLoginChallenge"("grantHash");

-- CreateIndex
CREATE INDEX "EmailLoginChallenge_userId_purpose_issuedAt_idx" ON "EmailLoginChallenge"("userId", "purpose", "issuedAt");

-- CreateIndex
CREATE INDEX "EmailLoginChallenge_expiresAt_idx" ON "EmailLoginChallenge"("expiresAt");

-- CreateIndex
CREATE INDEX "EmailLoginChallenge_targetAttemptId_idx" ON "EmailLoginChallenge"("targetAttemptId");

-- CreateIndex
CREATE INDEX "EmailLoginChallenge_requestingSessionId_idx" ON "EmailLoginChallenge"("requestingSessionId");

-- CreateIndex
CREATE INDEX "AuthRateLimitBucket_expiresAt_idx" ON "AuthRateLimitBucket"("expiresAt");

-- CreateIndex
CREATE INDEX "QuestionVersion_status_objective_kind_difficulty_idx" ON "QuestionVersion"("status", "objective", "kind", "difficulty");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionVersion_questionId_version_key" ON "QuestionVersion"("questionId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionVersion_id_questionId_key" ON "QuestionVersion"("id", "questionId");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionOption_questionVersionId_position_key" ON "QuestionOption"("questionVersionId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionOption_id_questionVersionId_key" ON "QuestionOption"("id", "questionVersionId");

-- CreateIndex
CREATE INDEX "QuestionAnswerKey_correctOptionId_questionVersionId_idx" ON "QuestionAnswerKey"("correctOptionId", "questionVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "Topic_name_key" ON "Topic"("name");

-- CreateIndex
CREATE INDEX "QuestionTopic_topicId_questionVersionId_idx" ON "QuestionTopic"("topicId", "questionVersionId");

-- CreateIndex
CREATE INDEX "Assessment_status_openAt_idx" ON "Assessment"("status", "openAt");

-- CreateIndex
CREATE INDEX "BlueprintSlot_topicId_idx" ON "BlueprintSlot"("topicId");

-- CreateIndex
CREATE UNIQUE INDEX "BlueprintSlot_assessmentId_position_key" ON "BlueprintSlot"("assessmentId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentSet_assessmentId_label_key" ON "AssessmentSet"("assessmentId", "label");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentSet_id_assessmentId_key" ON "AssessmentSet"("id", "assessmentId");

-- CreateIndex
CREATE INDEX "SetItem_questionVersionId_questionId_idx" ON "SetItem"("questionVersionId", "questionId");

-- CreateIndex
CREATE UNIQUE INDEX "SetItem_setId_position_key" ON "SetItem"("setId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "SetItem_setId_questionId_key" ON "SetItem"("setId", "questionId");

-- CreateIndex
CREATE UNIQUE INDEX "SetItem_id_setId_questionVersionId_key" ON "SetItem"("id", "setId", "questionVersionId");

-- CreateIndex
CREATE INDEX "AssessmentAssignment_userId_assessmentId_idx" ON "AssessmentAssignment"("userId", "assessmentId");

-- CreateIndex
CREATE INDEX "AssessmentAssignment_assessmentId_hardCloseAt_idx" ON "AssessmentAssignment"("assessmentId", "hardCloseAt");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentAssignment_assessmentId_userId_key" ON "AssessmentAssignment"("assessmentId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentAssignment_id_assessmentId_key" ON "AssessmentAssignment"("id", "assessmentId");

-- CreateIndex
CREATE UNIQUE INDEX "Attempt_submissionReceiptId_key" ON "Attempt"("submissionReceiptId");

-- CreateIndex
CREATE INDEX "Attempt_assessmentId_status_idx" ON "Attempt"("assessmentId", "status");

-- CreateIndex
CREATE INDEX "Attempt_setId_assessmentId_idx" ON "Attempt"("setId", "assessmentId");

-- CreateIndex
CREATE UNIQUE INDEX "Attempt_assignmentId_attemptNumber_key" ON "Attempt"("assignmentId", "attemptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Attempt_assignmentId_startRequestId_key" ON "Attempt"("assignmentId", "startRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "Attempt_id_setId_key" ON "Attempt"("id", "setId");

-- CreateIndex
CREATE INDEX "AttemptQuestion_setItemId_setId_questionVersionId_idx" ON "AttemptQuestion"("setItemId", "setId", "questionVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "AttemptQuestion_attemptId_setItemId_key" ON "AttemptQuestion"("attemptId", "setItemId");

-- CreateIndex
CREATE UNIQUE INDEX "AttemptQuestion_id_questionVersionId_key" ON "AttemptQuestion"("id", "questionVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "AttemptQuestion_id_attemptId_key" ON "AttemptQuestion"("id", "attemptId");

-- CreateIndex
CREATE INDEX "AttemptOption_questionOptionId_questionVersionId_idx" ON "AttemptOption"("questionOptionId", "questionVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "AttemptOption_attemptQuestionId_displayPosition_key" ON "AttemptOption"("attemptQuestionId", "displayPosition");

-- CreateIndex
CREATE INDEX "AttemptSession_userSessionId_idx" ON "AttemptSession"("userSessionId");

-- CreateIndex
CREATE INDEX "AnswerMutation_attemptId_acceptedAt_id_idx" ON "AnswerMutation"("attemptId", "acceptedAt", "id");

-- CreateIndex
CREATE INDEX "AnswerMutation_attemptId_sessionGeneration_idx" ON "AnswerMutation"("attemptId", "sessionGeneration");

-- CreateIndex
CREATE UNIQUE INDEX "AnswerMutation_attemptId_clientMutationId_key" ON "AnswerMutation"("attemptId", "clientMutationId");

-- CreateIndex
CREATE UNIQUE INDEX "AnswerMutation_attemptQuestionId_sessionGeneration_sequence_key" ON "AnswerMutation"("attemptQuestionId", "sessionGeneration", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "AnswerMutation_attemptQuestionId_resultRevision_key" ON "AnswerMutation"("attemptQuestionId", "resultRevision");

-- CreateIndex
CREATE INDEX "AttemptEvent_attemptId_serverReceivedAt_id_idx" ON "AttemptEvent"("attemptId", "serverReceivedAt", "id");

-- CreateIndex
CREATE INDEX "AttemptEvent_serverReceivedAt_idx" ON "AttemptEvent"("serverReceivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AttemptEvent_attemptId_clientEventId_key" ON "AttemptEvent"("attemptId", "clientEventId");

-- CreateIndex
CREATE INDEX "LateAnswerEvidence_serverReceivedAt_idx" ON "LateAnswerEvidence"("serverReceivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LateAnswerEvidence_attemptId_clientMutationId_key" ON "LateAnswerEvidence"("attemptId", "clientMutationId");

-- CreateIndex
CREATE INDEX "ItemExclusion_questionVersionId_idx" ON "ItemExclusion"("questionVersionId");

-- CreateIndex
CREATE INDEX "ReviewCase_attemptId_status_idx" ON "ReviewCase"("attemptId", "status");

-- CreateIndex
CREATE INDEX "ReviewCase_status_createdAt_idx" ON "ReviewCase"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_targetType_targetId_createdAt_id_idx" ON "AuditLog"("targetType", "targetId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Job_deduplicationKey_key" ON "Job"("deduplicationKey");

-- CreateIndex
CREATE INDEX "Job_assessmentId_status_idx" ON "Job"("assessmentId", "status");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminAuthenticator" ADD CONSTRAINT "AdminAuthenticator_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailLoginChallenge" ADD CONSTRAINT "EmailLoginChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailLoginChallenge" ADD CONSTRAINT "EmailLoginChallenge_targetAttemptId_fkey" FOREIGN KEY ("targetAttemptId") REFERENCES "Attempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailLoginChallenge" ADD CONSTRAINT "EmailLoginChallenge_requestingSessionId_fkey" FOREIGN KEY ("requestingSessionId") REFERENCES "Session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionVersion" ADD CONSTRAINT "QuestionVersion_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionOption" ADD CONSTRAINT "QuestionOption_questionVersionId_fkey" FOREIGN KEY ("questionVersionId") REFERENCES "QuestionVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionAnswerKey" ADD CONSTRAINT "QuestionAnswerKey_questionVersionId_fkey" FOREIGN KEY ("questionVersionId") REFERENCES "QuestionVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionAnswerKey" ADD CONSTRAINT "QuestionAnswerKey_correctOptionId_questionVersionId_fkey" FOREIGN KEY ("correctOptionId", "questionVersionId") REFERENCES "QuestionOption"("id", "questionVersionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionTopic" ADD CONSTRAINT "QuestionTopic_questionVersionId_fkey" FOREIGN KEY ("questionVersionId") REFERENCES "QuestionVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionTopic" ADD CONSTRAINT "QuestionTopic_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlueprintSlot" ADD CONSTRAINT "BlueprintSlot_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlueprintSlot" ADD CONSTRAINT "BlueprintSlot_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentSet" ADD CONSTRAINT "AssessmentSet_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetItem" ADD CONSTRAINT "SetItem_setId_fkey" FOREIGN KEY ("setId") REFERENCES "AssessmentSet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetItem" ADD CONSTRAINT "SetItem_questionVersionId_questionId_fkey" FOREIGN KEY ("questionVersionId", "questionId") REFERENCES "QuestionVersion"("id", "questionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentAssignment" ADD CONSTRAINT "AssessmentAssignment_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentAssignment" ADD CONSTRAINT "AssessmentAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_assignmentId_assessmentId_fkey" FOREIGN KEY ("assignmentId", "assessmentId") REFERENCES "AssessmentAssignment"("id", "assessmentId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_setId_assessmentId_fkey" FOREIGN KEY ("setId", "assessmentId") REFERENCES "AssessmentSet"("id", "assessmentId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttemptQuestion" ADD CONSTRAINT "AttemptQuestion_attemptId_setId_fkey" FOREIGN KEY ("attemptId", "setId") REFERENCES "Attempt"("id", "setId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttemptQuestion" ADD CONSTRAINT "AttemptQuestion_setItemId_setId_questionVersionId_fkey" FOREIGN KEY ("setItemId", "setId", "questionVersionId") REFERENCES "SetItem"("id", "setId", "questionVersionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttemptOption" ADD CONSTRAINT "AttemptOption_attemptQuestionId_questionVersionId_fkey" FOREIGN KEY ("attemptQuestionId", "questionVersionId") REFERENCES "AttemptQuestion"("id", "questionVersionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttemptOption" ADD CONSTRAINT "AttemptOption_questionOptionId_questionVersionId_fkey" FOREIGN KEY ("questionOptionId", "questionVersionId") REFERENCES "QuestionOption"("id", "questionVersionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttemptAnswer" ADD CONSTRAINT "AttemptAnswer_attemptQuestionId_fkey" FOREIGN KEY ("attemptQuestionId") REFERENCES "AttemptQuestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttemptAnswer" ADD CONSTRAINT "AttemptAnswer_attemptQuestionId_selectedOptionId_fkey" FOREIGN KEY ("attemptQuestionId", "selectedOptionId") REFERENCES "AttemptOption"("attemptQuestionId", "questionOptionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttemptSession" ADD CONSTRAINT "AttemptSession_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "Attempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttemptSession" ADD CONSTRAINT "AttemptSession_userSessionId_fkey" FOREIGN KEY ("userSessionId") REFERENCES "Session"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnswerMutation" ADD CONSTRAINT "AnswerMutation_attemptQuestionId_attemptId_fkey" FOREIGN KEY ("attemptQuestionId", "attemptId") REFERENCES "AttemptQuestion"("id", "attemptId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnswerMutation" ADD CONSTRAINT "AnswerMutation_attemptQuestionId_selectedOptionId_fkey" FOREIGN KEY ("attemptQuestionId", "selectedOptionId") REFERENCES "AttemptOption"("attemptQuestionId", "questionOptionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnswerMutation" ADD CONSTRAINT "AnswerMutation_attemptId_sessionGeneration_fkey" FOREIGN KEY ("attemptId", "sessionGeneration") REFERENCES "AttemptSession"("attemptId", "generation") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttemptEvent" ADD CONSTRAINT "AttemptEvent_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "Attempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LateAnswerEvidence" ADD CONSTRAINT "LateAnswerEvidence_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "Attempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreRevision" ADD CONSTRAINT "ScoreRevision_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "Attempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemExclusion" ADD CONSTRAINT "ItemExclusion_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemExclusion" ADD CONSTRAINT "ItemExclusion_questionVersionId_fkey" FOREIGN KEY ("questionVersionId") REFERENCES "QuestionVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewCase" ADD CONSTRAINT "ReviewCase_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "Attempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
