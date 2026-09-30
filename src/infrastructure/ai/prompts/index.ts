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
import * as TranslatorV2 from './translator/v2'
import * as ContextualTutorV2 from './contextual-tutor/v2'
import * as ProfessorProfileV1 from './professor-profile/v1'
import * as MistakeAnalyzerV2 from './mistake-analyzer/v2'
import * as QuizGeneratorV1 from './quiz-generator/v1'
import * as VisualizationGeneratorV5 from './visualization-generator/v5'
import * as HomeworkAnalyzerV2 from './homework-analyzer/v2'
import * as HomeworkQuestionV3 from './homework-question/v3'
import * as HomeworkQaV1 from './homework-qa/v1'
import * as SlideLessonV1 from './slide-lesson/v1'

export const PROMPT_VERSIONS = {
  documentAnalyzer: 'v2',
  topicAnalyzer: 'v1',
  tutorLesson: 'v4',
  tutorIntroduce: 'v1',
  tutorQuestion: 'v1',
  tutorEvaluate: 'v1',
  translator: 'v2',
  contextualTutor: 'v2',
  professorProfile: 'v1',
  mistakeAnalyzer: 'v2',
  quizGenerator: 'v1',
  visualizationGenerator: 'v5',
  homeworkAnalyzer: 'v2',
  homeworkQuestion: 'v3',
  homeworkQa: 'v1',
  slideLesson: 'v1',
} as const

export const prompts = {
  documentAnalyzer: DocumentAnalyzerV2,
  topicAnalyzer: TopicAnalyzerV1,
  tutorLesson: TutorLessonV4,
  tutorIntroduce: TutorIntroduceV1,
  tutorQuestion: TutorQuestionV1,
  tutorEvaluate: TutorEvaluateV1,
  translator: TranslatorV2,
  contextualTutor: ContextualTutorV2,
  professorProfile: ProfessorProfileV1,
  mistakeAnalyzer: MistakeAnalyzerV2,
  quizGenerator: QuizGeneratorV1,
  visualizationGenerator: VisualizationGeneratorV5,
  homeworkAnalyzer: HomeworkAnalyzerV2,
  homeworkQuestion: HomeworkQuestionV3,
  homeworkQa: HomeworkQaV1,
  slideLesson: SlideLessonV1,
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
export type { VisualizationInput, VisualizationOutput } from './visualization-generator/v5'
export type {
  HomeworkAnalyzerInput,
  HomeworkAnalyzerOutput,
} from './homework-analyzer/v1'
export type {
  HomeworkQuestionInput,
  HomeworkQuestionOutput,
} from './homework-question/v3'
export type { HomeworkQaInput, HomeworkQaHistoryItem } from './homework-qa/v1'
export type { SlideLessonInput, SlideLessonOutput } from './slide-lesson/v1'
