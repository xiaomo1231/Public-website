/**
 * Centralised prompt registry. Each entry is callable with the inputs its
 * `v1` module declares. New versions can be added next to `v1` and switched
 * here in one place.
 */

import * as DocumentAnalyzerV2 from './document-analyzer/v2'
import * as TopicAnalyzerV1 from './topic-analyzer/v1'
import * as TutorLessonV4 from './tutor/v4-lesson'
import * as TutorIntroduceV1 from './tutor/v1-introduce'
import * as TutorQuestionV1 from './tutor/v1-question'
import * as TutorEvaluateV1 from './tutor/v1-evaluate'
import * as TranslatorV1 from './translator/v1'
import * as ContextualTutorV1 from './contextual-tutor/v1'
import * as ProfessorProfileV1 from './professor-profile/v1'
import * as MistakeAnalyzerV2 from './mistake-analyzer/v2'
import * as QuizGeneratorV1 from './quiz-generator/v1'
import * as VisualizationGeneratorV4 from './visualization-generator/v4'

export const PROMPT_VERSIONS = {
  documentAnalyzer: 'v2',
  topicAnalyzer: 'v1',
  tutorLesson: 'v4',
  tutorIntroduce: 'v1',
  tutorQuestion: 'v1',
  tutorEvaluate: 'v1',
  translator: 'v1',
  contextualTutor: 'v1',
  professorProfile: 'v1',
  mistakeAnalyzer: 'v2',
  quizGenerator: 'v1',
  visualizationGenerator: 'v4',
} as const

export const prompts = {
  documentAnalyzer: DocumentAnalyzerV2,
  topicAnalyzer: TopicAnalyzerV1,
  tutorLesson: TutorLessonV4,
  tutorIntroduce: TutorIntroduceV1,
  tutorQuestion: TutorQuestionV1,
  tutorEvaluate: TutorEvaluateV1,
  translator: TranslatorV1,
  contextualTutor: ContextualTutorV1,
  professorProfile: ProfessorProfileV1,
  mistakeAnalyzer: MistakeAnalyzerV2,
  quizGenerator: QuizGeneratorV1,
  visualizationGenerator: VisualizationGeneratorV4,
} as const

export type {
  DocumentAnalyzerInput,
  DocumentAnalysisOutput,
} from './document-analyzer/v2'
export type { LessonInput } from './tutor/v4-lesson'
export type { IntroduceConceptInput } from './tutor/v1-introduce'
export type { QuestionGeneratorInput } from './tutor/v1-question'
export type { GeneratedQuestion } from './types'
export type { EvaluateAnswerInput } from './tutor/v1-evaluate'
export type { TranslateInput } from './translator/v1'
export type { ContextualTutorInput } from './contextual-tutor/v1'
export type {
  MistakeAnalyzerInput,
  MistakeAnalyzerOutput,
} from './mistake-analyzer/v2'
export type {
  QuizGenerationInput,
  QuizGenerationOutput,
  GeneratedQuizQuestion,
  QuizQuestionType,
} from './quiz-generator/v1'
export type { VisualizationInput, VisualizationOutput } from './visualization-generator/v4'
