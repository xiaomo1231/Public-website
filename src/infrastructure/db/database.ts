import Dexie, { type EntityTable } from 'dexie'
import type { Project } from '@/entities/project/types'
import type { UserProfile } from '@/entities/user/types'
import type { AISettingsRow } from '@/entities/settings/types'
import type { CryptoKeyRow } from '../crypto/deviceKey'
import type { InviteKeyRecord } from '@/entities/invite/types'
import type { Document, DocumentBlobRow } from '@/entities/document/types'
import type { DocumentChunk } from '@/entities/chunk/types'
import type { ProcessingJob } from '@/entities/processingJob/types'
import type {
  Concept,
  CourseAnalysis,
  CourseExercise,
  CourseSymbol,
  Example,
  Formula,
  Prerequisite,
  Topic,
} from '@/entities/courseAnalysis/types'
import type { TutorSession } from '@/entities/tutorSession/types'
import type { TutorLesson } from '@/entities/tutorLesson/types'
import type { TranslationEntry } from '@/entities/translation/types'
import type { Question } from '@/entities/question/types'
import type { QuestionAttempt } from '@/entities/questionAttempt/types'
import type { Quiz } from '@/entities/quiz/types'
import type { KnowledgeMastery } from '@/entities/knowledgeMastery/types'
import type { Mistake } from '@/entities/mistake/types'
import { logger } from '../logger/logger'

/**
 * Single Dexie database for the entire app. Versioned schema lives here;
 * migrations append new versions.
 *
 * UI MUST NOT touch this module directly — go through repositories.
 */
export class AppDatabase extends Dexie {
  projects!: EntityTable<Project, 'id'>
  user!: EntityTable<UserProfile, 'id'>
  settings!: EntityTable<AISettingsRow, 'id'>
  inviteKeys!: EntityTable<InviteKeyRecord, 'code'>
  /** Non-extractable device keys used to encrypt local secrets at rest. */
  cryptoKeys!: EntityTable<CryptoKeyRow, 'id'>

  documents!: EntityTable<Document, 'id'>
  documentBlobs!: EntityTable<DocumentBlobRow, 'id'>
  chunks!: EntityTable<DocumentChunk, 'id'>
  processingJobs!: EntityTable<ProcessingJob, 'id'>

  courseAnalyses!: EntityTable<CourseAnalysis, 'id'>
  topics!: EntityTable<Topic, 'id'>
  concepts!: EntityTable<Concept, 'id'>
  formulas!: EntityTable<Formula, 'id'>
  symbols!: EntityTable<CourseSymbol, 'id'>
  examples!: EntityTable<Example, 'id'>
  courseExercises!: EntityTable<CourseExercise, 'id'>
  prerequisites!: EntityTable<Prerequisite, 'id'>

  tutorSessions!: EntityTable<TutorSession, 'id'>
  /** Cached Topic teaching lessons — one per project + topic + language. */
  tutorLessons!: EntityTable<TutorLesson, 'id'>
  translations!: EntityTable<TranslationEntry, 'id'>

  questions!: EntityTable<Question, 'id'>
  questionAttempts!: EntityTable<QuestionAttempt, 'id'>
  quizzes!: EntityTable<Quiz, 'id'>
  knowledgeMastery!: EntityTable<KnowledgeMastery, 'id'>
  mistakes!: EntityTable<Mistake, 'id'>

  constructor() {
    super('ai-learning-platform')

    this.version(1).stores({
      projects: 'id, name, subject, createdAt, updatedAt',
      user: 'id',
      settings: 'id, updatedAt',
      inviteKeys: 'code, usedAt',
    })

    // Phase 2: content library
    this.version(2).stores({
      projects: 'id, name, subject, createdAt, updatedAt',
      user: 'id',
      settings: 'id, updatedAt',
      inviteKeys: 'code, usedAt',
      documents:
        'id, projectId, type, status, name, uploadedAt, processedAt, [projectId+status], [projectId+type]',
      documentBlobs: 'id, projectId',
      chunks: 'id, documentId, projectId, order, [documentId+order], [projectId+documentId]',
      processingJobs: 'id, documentId, projectId, stage, updatedAt, [projectId+updatedAt]',
    })

    // Phase 3: course analysis, tutor sessions, translations
    this.version(3).stores({
      projects: 'id, name, subject, createdAt, updatedAt',
      user: 'id',
      settings: 'id, updatedAt',
      inviteKeys: 'code, usedAt',
      documents:
        'id, projectId, type, status, name, uploadedAt, processedAt, [projectId+status], [projectId+type]',
      documentBlobs: 'id, projectId',
      chunks: 'id, documentId, projectId, order, [documentId+order], [projectId+documentId]',
      processingJobs: 'id, documentId, projectId, stage, updatedAt, [projectId+updatedAt]',
      courseAnalyses: 'id, projectId, status, finishedAt',
      topics: 'id, projectId, order',
      concepts: 'id, projectId, name',
      formulas: 'id, projectId, name',
      symbols: 'id, projectId, symbol',
      examples: 'id, projectId',
      courseExercises: 'id, projectId, difficulty',
      prerequisites: 'id, projectId',
      tutorSessions: 'id, projectId, status, updatedAt, [projectId+updatedAt]',
      translations: 'id, projectId, createdAt, [projectId+createdAt]',
    })

    // Phase 4: quiz + adaptive difficulty
    this.version(4).stores({
      projects: 'id, name, subject, createdAt, updatedAt',
      user: 'id',
      settings: 'id, updatedAt',
      inviteKeys: 'code, usedAt',
      documents:
        'id, projectId, type, status, name, uploadedAt, processedAt, [projectId+status], [projectId+type]',
      documentBlobs: 'id, projectId',
      chunks: 'id, documentId, projectId, order, [documentId+order], [projectId+documentId]',
      processingJobs: 'id, documentId, projectId, stage, updatedAt, [projectId+updatedAt]',
      courseAnalyses: 'id, projectId, status, finishedAt',
      topics: 'id, projectId, order',
      concepts: 'id, projectId, name',
      formulas: 'id, projectId, name',
      symbols: 'id, projectId, symbol',
      examples: 'id, projectId',
      courseExercises: 'id, projectId, difficulty',
      prerequisites: 'id, projectId',
      tutorSessions: 'id, projectId, status, updatedAt, [projectId+updatedAt]',
      translations: 'id, projectId, createdAt, [projectId+createdAt]',
      questions:
        'id, projectId, topicId, knowledgePoint, type, difficulty, createdAt, [projectId+topicId], [projectId+knowledgePoint]',
      questionAttempts:
        'id, projectId, questionId, quizId, topicId, knowledgePoint, createdAt, [projectId+createdAt], [quizId+createdAt]',
      quizzes: 'id, projectId, status, startedAt, [projectId+startedAt]',
      knowledgeMastery: 'id, projectId, knowledgePoint, [projectId+knowledgePoint]',
    })

    // Phase 5: mistake book
    this.version(5).stores({
      projects: 'id, name, subject, createdAt, updatedAt',
      user: 'id',
      settings: 'id, updatedAt',
      inviteKeys: 'code, usedAt',
      documents:
        'id, projectId, type, status, name, uploadedAt, processedAt, [projectId+status], [projectId+type]',
      documentBlobs: 'id, projectId',
      chunks: 'id, documentId, projectId, order, [documentId+order], [projectId+documentId]',
      processingJobs: 'id, documentId, projectId, stage, updatedAt, [projectId+updatedAt]',
      courseAnalyses: 'id, projectId, status, finishedAt',
      topics: 'id, projectId, order',
      concepts: 'id, projectId, name',
      formulas: 'id, projectId, name',
      symbols: 'id, projectId, symbol',
      examples: 'id, projectId',
      courseExercises: 'id, projectId, difficulty',
      prerequisites: 'id, projectId',
      tutorSessions: 'id, projectId, status, updatedAt, [projectId+updatedAt]',
      translations: 'id, projectId, createdAt, [projectId+createdAt]',
      questions:
        'id, projectId, topicId, knowledgePoint, type, difficulty, createdAt, [projectId+topicId], [projectId+knowledgePoint]',
      questionAttempts:
        'id, projectId, questionId, quizId, topicId, knowledgePoint, createdAt, [projectId+createdAt], [quizId+createdAt]',
      quizzes: 'id, projectId, status, startedAt, [projectId+startedAt]',
      knowledgeMastery: 'id, projectId, knowledgePoint, [projectId+knowledgePoint]',
      mistakes:
        'id, projectId, questionId, quizId, knowledgePoint, mistakeType, status, source, createdAt, [projectId+status], [projectId+knowledgePoint]',
    })

    // Security hardening: device keys for encrypting local secrets at rest.
    // Additive only — no existing table or row is transformed.
    this.version(6).stores({
      projects: 'id, name, subject, createdAt, updatedAt',
      user: 'id',
      settings: 'id, updatedAt',
      inviteKeys: 'code, usedAt',
      cryptoKeys: 'id',
      documents:
        'id, projectId, type, status, name, uploadedAt, processedAt, [projectId+status], [projectId+type]',
      documentBlobs: 'id, projectId',
      chunks: 'id, documentId, projectId, order, [documentId+order], [projectId+documentId]',
      processingJobs: 'id, documentId, projectId, stage, updatedAt, [projectId+updatedAt]',
      courseAnalyses: 'id, projectId, status, finishedAt',
      topics: 'id, projectId, order',
      concepts: 'id, projectId, name',
      formulas: 'id, projectId, name',
      symbols: 'id, projectId, symbol',
      examples: 'id, projectId',
      courseExercises: 'id, projectId, difficulty',
      prerequisites: 'id, projectId',
      tutorSessions: 'id, projectId, status, updatedAt, [projectId+updatedAt]',
      translations: 'id, projectId, createdAt, [projectId+createdAt]',
      questions:
        'id, projectId, topicId, knowledgePoint, type, difficulty, createdAt, [projectId+topicId], [projectId+knowledgePoint]',
      questionAttempts:
        'id, projectId, questionId, quizId, topicId, knowledgePoint, createdAt, [projectId+createdAt], [quizId+createdAt]',
      quizzes: 'id, projectId, status, startedAt, [projectId+startedAt]',
      knowledgeMastery: 'id, projectId, knowledgePoint, [projectId+knowledgePoint]',
      mistakes:
        'id, projectId, questionId, quizId, knowledgePoint, mistakeType, status, source, createdAt, [projectId+status], [projectId+knowledgePoint]',
    })

    // Phase 7: cached Topic teaching lessons (one per project+topic+language)
    this.version(7).stores({
      projects: 'id, name, subject, createdAt, updatedAt',
      user: 'id',
      settings: 'id, updatedAt',
      inviteKeys: 'code, usedAt',
      cryptoKeys: 'id',
      documents:
        'id, projectId, type, status, name, uploadedAt, processedAt, [projectId+status], [projectId+type]',
      documentBlobs: 'id, projectId',
      chunks: 'id, documentId, projectId, order, [documentId+order], [projectId+documentId]',
      processingJobs: 'id, documentId, projectId, stage, updatedAt, [projectId+updatedAt]',
      courseAnalyses: 'id, projectId, status, finishedAt',
      topics: 'id, projectId, order',
      concepts: 'id, projectId, name',
      formulas: 'id, projectId, name',
      symbols: 'id, projectId, symbol',
      examples: 'id, projectId',
      courseExercises: 'id, projectId, difficulty',
      prerequisites: 'id, projectId',
      tutorSessions: 'id, projectId, status, updatedAt, [projectId+updatedAt]',
      tutorLessons: 'id, projectId, topicId, generatedAt, [projectId+topicId+language]',
      translations: 'id, projectId, createdAt, [projectId+createdAt]',
      questions:
        'id, projectId, topicId, knowledgePoint, type, difficulty, createdAt, [projectId+topicId], [projectId+knowledgePoint]',
      questionAttempts:
        'id, projectId, questionId, quizId, topicId, knowledgePoint, createdAt, [projectId+createdAt], [quizId+createdAt]',
      quizzes: 'id, projectId, status, startedAt, [projectId+startedAt]',
      knowledgeMastery: 'id, projectId, knowledgePoint, [projectId+knowledgePoint]',
      mistakes:
        'id, projectId, questionId, quizId, knowledgePoint, mistakeType, status, source, createdAt, [projectId+status], [projectId+knowledgePoint]',
    })
  }
}

let _db: AppDatabase | null = null

export function getDb(): AppDatabase {
  if (!_db) {
    _db = new AppDatabase()
    // The origin is logged because IndexedDB is origin-scoped: if this value
    // changes between runs, the app is looking at a different, empty database.
    logger.info('IndexedDB opened', {
      name: _db.name,
      version: _db.verno,
      origin: typeof window !== 'undefined' ? window.location.origin : 'n/a',
    })
  }
  return _db
}

export function setDbForTesting(db: AppDatabase | null): void {
  _db = db
}

export async function destroyDb(): Promise<void> {
  if (_db) {
    _db.close()
    _db = null
  }
  await Dexie.delete('ai-learning-platform')
  logger.warn('IndexedDB destroyed')
}