import { AIService } from './aiService'
import { SettingsService } from './settingsService'
import { DocumentAnalysisService } from './documentAnalysisService'
import { TutorService } from './tutorService'
import { TutorLessonService } from './tutorLessonService'
import { TranslationService } from './translationService'
import { ContextualTutorService } from './contextualTutorService'
import { QuizService } from './quizService'
import { MasteryService } from './masteryService'
import { MistakeService } from './mistakeService'
import { MistakeAnalysisService } from './mistakeAnalysisService'
import { WeaknessService } from './weaknessService'
import { ReviewSessionService } from './reviewSessionService'
import { ProjectService } from './projectService'
import { getDb } from '@/infrastructure/db/database'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import { TutorSessionRepository } from '@/entities/tutorSession/repository'
import { TutorLessonRepository } from '@/entities/tutorLesson/repository'
import { VisualSourceRepository } from '@/entities/visualSource/repository'
import { TranslationRepository } from '@/entities/translation/repository'
import { QuestionRepository } from '@/entities/question/repository'
import { QuestionAttemptRepository } from '@/entities/questionAttempt/repository'
import { QuizRepository } from '@/entities/quiz/repository'

/**
 * Factory that bundles AI-aware services. Created lazily once the user has
 * configured an AI provider in Settings; otherwise `ai` is `null` and the
 * higher-level services throw a clear error.
 */
export interface AIServicesBundle {
  ai: AIService
  documentAnalysis: DocumentAnalysisService
  tutor: TutorService
  /** Cached Topic teaching lessons (the Topic page's reading material). */
  tutorLesson: TutorLessonService
  translation: TranslationService
  /** Ephemeral Q&A about a passage the learner selected. Never persisted. */
  contextualTutor: ContextualTutorService
  quiz: QuizService
  mastery: MasteryService
  mistakes: MistakeService
  mistakeAnalysis: MistakeAnalysisService
  weakness: WeaknessService
  reviewSession: ReviewSessionService
}

export async function buildAIServices(): Promise<AIServicesBundle | null> {
  const settings = await new SettingsService().get()
  if (!settings.apiKey.trim()) return null
  const ai = new AIService({ config: settings })
  const db = getDb()
  const projects = new ProjectService(db)
  const chunks = new ChunkRepository(db)
  const analyses = new CourseAnalysisRepository(db)
  const mastery = new MasteryService(db)
  const mistakes = new MistakeService(db)
  const quiz = new QuizService({
    ai,
    db,
    questions: new QuestionRepository(db),
    attempts: new QuestionAttemptRepository(db),
    quizzes: new QuizRepository(db),
    analyses,
    chunks,
    mastery,
    mistakes,
    projects,
  })
  return {
    ai,
    documentAnalysis: new DocumentAnalysisService({
      ai,
      projects,
      db,
      documents: new DocumentRepository(db),
      chunks,
      analyses,
    }),
    tutor: new TutorService({
      ai,
      projects,
      db,
      sessions: new TutorSessionRepository(db),
      analyses,
      chunks,
      questions: new QuestionRepository(db),
      attempts: new QuestionAttemptRepository(db),
      mistakes,
    }),
    tutorLesson: new TutorLessonService({
      ai,
      db,
      lessons: new TutorLessonRepository(db),
      analyses,
      chunks,
      visuals: new VisualSourceRepository(db),
    }),
    translation: new TranslationService({ ai, repo: new TranslationRepository(db) }),
    contextualTutor: new ContextualTutorService({ ai }),
    quiz,
    mastery,
    mistakes,
    mistakeAnalysis: new MistakeAnalysisService({ ai, mistakes, chunks, analyses }),
    weakness: new WeaknessService(db),
    reviewSession: new ReviewSessionService({ quiz, mistakes, db }),
  }
}

/**
 * The quiz can be taken without an AI provider for questions that are already
 * stored. This factory returns a QuizService even when no API key is set, so
 * grading and mastery tracking keep working offline.
 */
export function buildOfflineQuizService(): QuizService {
  const db = getDb()
  const ai = new AIService({
    config: {
      provider: 'custom',
      baseURL: 'http://localhost',
      apiKey: 'offline',
      model: 'offline',
      temperature: 0,
      maxTokens: 1,
    },
  })
  return new QuizService({
    ai,
    db,
    questions: new QuestionRepository(db),
    attempts: new QuestionAttemptRepository(db),
    quizzes: new QuizRepository(db),
    analyses: new CourseAnalysisRepository(db),
    chunks: new ChunkRepository(db),
    mastery: new MasteryService(db),
    mistakes: new MistakeService(db),
  })
}