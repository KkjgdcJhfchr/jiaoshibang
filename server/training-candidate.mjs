import { randomUUID } from 'node:crypto';
import { redactDirectIdentifiers, stablePrivateHash } from './security.mjs';

export function buildTrainingCandidate({ user, lessonPlan, consentAt, rightsConfirmed, privacySalt }) {
  const createdAt = new Date().toISOString();
  const consentEventId = `consent_${randomUUID()}`;
  const sampleId = `sample_${randomUUID()}`;
  const redacted = redactDirectIdentifiers(lessonPlan);
  const schemaRedactionCategories = normalizeRedactionCategories(redacted.categories);
  const plan = redacted.value;
  const metadata = plan.metadata || {};
  const knowledgePoints = collectKnowledgePoints(plan);
  const dedupeHash = stablePrivateHash(JSON.stringify(plan), privacySalt);
  const chapterFingerprint = stablePrivateHash(
    `${metadata.subject || ''}|${metadata.grade || ''}|${metadata.textbookEdition || ''}|${metadata.chapterTitle || ''}`,
    privacySalt,
  );
  const ownerRef = `usr_hash_${stablePrivateHash(user.id, privacySalt).slice(0, 32)}`;

  const sample = {
    schemaVersion: 'training-sample.v1',
    sampleId,
    taskType: 'lesson_plan_sft',
    candidateStatus: 'pending',
    sourceCategory: 'user_interaction',
    authorization: {
      serviceProcessing: true,
      trainingAllowed: true,
      legalBasis: 'explicit_user_opt_in',
      scopes: {
        rawSource: false,
        ocrText: false,
        finalPlan: true,
        revisionHistory: false,
        explicitPreferences: false,
        syntheticDerivatives: false,
      },
      consentEventId,
      policyVersion: 'training-consent.v1',
      evidenceRef: `consent-event://${consentEventId}`,
      grantedAt: consentAt,
      revokedAt: null,
    },
    rights: {
      rightsHolder: '',
      sourceTitle: metadata.chapterTitle || metadata.lessonTitle || '',
      licenseId: '',
      uploaderAttestation: Boolean(rightsConfirmed),
      allowedUses: {
        inference: false,
        projectRag: false,
        tenantRag: false,
        globalRag: false,
        modelTraining: false,
        distillation: false,
        derivatives: false,
        redistribution: false,
      },
      territories: [],
      validFrom: null,
      validUntil: null,
      attributionRequired: false,
      attributionText: '',
      reviewStatus: 'pending',
      reviewedBy: '',
      reviewedAt: null,
    },
    privacy: {
      containsPersonalData: redacted.count > 0,
      containsMinorData: false,
      deidentificationStatus: 'pending',
      rulesetVersion: 'direct-identifiers.v1',
      removedCategories: schemaRedactionCategories,
      reversibleMappingStored: false,
      residualRisk: 'medium',
      reviewStatus: 'pending',
      reviewedBy: '',
      reviewedAt: null,
    },
    quality: {
      hardGates: [{ code: 'manual_review_required', passed: false, evidence: '候选样本尚未经过人工审核' }],
      allHardGatesPassed: false,
      dimensions: emptyQualityDimensions(),
      overallScore: 0,
      graderVersions: [],
      humanReview: {
        status: 'not_reviewed',
        reviewerId: '',
        reviewedAt: null,
        notes: '',
      },
    },
    eligibility: {
      eligible: false,
      reasons: ['等待版权、隐私和质量人工审核'],
      dedupeHash,
      semanticClusterId: '',
      splitGroupKey: `chapter_${chapterFingerprint.slice(0, 32)}`,
      fixedEvalExcluded: true,
      poisoningRisk: 'medium',
      approvedAt: null,
    },
    payload: {
      kind: 'generation_sft',
      instruction: '根据经审核的教材章节上下文生成结构化、可执行的完整教案。',
      input: {
        chapterContext: {
          chapterSnapshotId: `chapter_${chapterFingerprint.slice(0, 32)}`,
          subject: metadata.subject || '未指定学科',
          grade: metadata.grade || '未指定年级',
          textbookEdition: metadata.textbookEdition || '',
          chapterTitle: metadata.chapterTitle || metadata.lessonTitle || '未指定章节',
          sourceSummary: plan.sourceSummary || '',
          knowledgePoints,
          sourceRefs: [],
        },
        teacherContext: {
          durationMinutes: Number(metadata.durationMinutes) || 45,
          classProfile: metadata.classProfile || '',
          preferences: [],
          language: metadata.language || 'zh-CN',
        },
        retrievedChunks: [],
      },
      targetLessonPlan: plan,
    },
    datasetMemberships: [],
    createdAt,
    updatedAt: createdAt,
  };

  return {
    reviewStatus: 'pending_review',
    ownerRef,
    redactionCount: redacted.count,
    redactionCategories: redacted.categories,
    createdAt,
    sample,
  };
}

function normalizeRedactionCategories(categories) {
  const allowed = new Set([
    'name', 'student_id', 'government_id', 'phone', 'email', 'social_account', 'school', 'class',
    'address', 'precise_location', 'grade_or_comment', 'health', 'family_or_financial', 'face',
    'signature', 'file_metadata', 'other',
  ]);
  const mapped = categories.map((category) => {
    if (allowed.has(category)) return category;
    if (/identity|idcard/.test(category)) return 'government_id';
    if (/phone|mobile|telephone/.test(category)) return 'phone';
    if (/teachername|studentname|username/.test(category)) return 'name';
    if (/school/.test(category)) return 'school';
    if (/class/.test(category)) return 'class';
    if (/account|user/.test(category)) return 'social_account';
    return 'other';
  });
  return [...new Set(mapped)].sort();
}

export function publicTrainingCandidate(candidate) {
  const sample = candidate.sample;
  const chapter = sample.payload?.input?.chapterContext || {};
  return {
    sampleId: sample.sampleId,
    status: candidate.reviewStatus,
    candidateStatus: sample.candidateStatus,
    taskType: sample.taskType,
    subject: chapter.subject || '',
    grade: chapter.grade || '',
    chapterTitle: chapter.chapterTitle || '',
    consentGrantedAt: sample.authorization?.grantedAt || null,
    redactionCount: candidate.redactionCount || 0,
    createdAt: candidate.createdAt,
  };
}

function collectKnowledgePoints(plan) {
  const values = [
    ...(Array.isArray(plan.keyPoints) ? plan.keyPoints : []),
    ...(Array.isArray(plan.coreCompetencies) ? plan.coreCompetencies : []),
    ...(Array.isArray(plan.exercises)
      ? plan.exercises.flatMap((exercise) => Array.isArray(exercise?.knowledgePoints) ? exercise.knowledgePoints : [])
      : []),
  ].map((value) => String(value || '').trim()).filter(Boolean);
  return [...new Set(values)].slice(0, 100).length
    ? [...new Set(values)].slice(0, 100)
    : ['待人工审核'];
}

function emptyQualityDimensions() {
  return {
    sourceFaithfulness: 0,
    objectiveAlignment: 0,
    lessonFeasibility: 0,
    explanationClarity: 0,
    engagementDesign: 0,
    exerciseQuality: 0,
    differentiationAndAssessment: 0,
    languageAndFormat: 0,
  };
}
