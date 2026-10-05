/**
 * Centralised prompt registry. Each entry is callable with the inputs its
 * `v1` module declares. New versions can be added next to `v1` and switched
 * here in one place.
 */

import * as DocumentAnalyzerV2 from './document-analyzer/v2'
import * as TopicAnalyzerV1 from './topic-analyzer/v1'
import * as TutorLessonV5 from './tutor/v5-lesson'
import * as TutorIntroduceV1 from './tutor/v1-introduce'
import * as TutorQuestionV2 from './tutor/v2-question'
import * as TutorEvaluateV1 from './tutor/v1-evaluate'
import * as TranslatorV2 from './translator/v2'
import * as ContextualTutorV2 from './contextual-tutor/v2'
import * as ProfessorProfileV1 from './professor-profile/v1'
import * as MistakeAnalyzerV2 from './mistake-analyzer/v2'
import * as QuizGeneratorV4 from './quiz-generator/v4'
import * as VisualizationGeneratorV7 from './visualization-generator/v7'
import * as HomeworkAnalyzerV2 from './homework-analyzer/v2'
import * as HomeworkQuestionV3 from './homework-question/v3'
import * as HomeworkQaV1 from './homework-qa/v1'
import * as HomeworkReviewV1 from './homework-review/v1'
import * as HomeworkAnswerCheckV1 from './homework-answer-check/v1'
import * as SlideLessonV1 from './slide-lesson/v1'
import * as SubjectProfileV1 from './subject-profile/v1'
import * as ShortAnswerCheckV1 from './short-answer-check/v1'
import * as RubricExtractorV1 from './rubric-extractor/v1'
import * as ReferenceImageQueryV1 from './reference-image-query/v1'
import * as ReferenceImageCheckV1 from './reference-image-check/v1'

export const PROMPT_VERSIONS = {
  documentAnalyzer: 'v2',
  topicAnalyzer: 'v1',
  tutorLesson: 'v5',
  tutorIntroduce: 'v1',
  tutorQuestion: 'v2',
  tutorEvaluate: 'v1',
  translator: 'v2',
  contextualTutor: 'v2',
  professorProfile: 'v1',
  mistakeAnalyzer: 'v2',
  quizGenerator: 'v4',
  visualizationGenerator: 'v7',
  homeworkAnalyzer: 'v2',
  homeworkQuestion: 'v3',
  homeworkQa: 'v1',
  homeworkReview: 'v1',
  homeworkAnswerCheck: 'v1',
  slideLesson: 'v1',
  subjectProfile: 'v1',
  shortAnswerCheck: 'v1',
  rubricExtractor: 'v1',
  referenceImageQuery: 'v1',
  referenceImageCheck: 'v1',
} as const

export const prompts = {
  documentAnalyzer: DocumentAnalyzerV2,
  topicAnalyzer: TopicAnalyzerV1,
  tutorLesson: TutorLessonV5,
  tutorIntroduce: TutorIntroduceV1,
  tutorQuestion: TutorQuestionV2,
  tutorEvaluate: TutorEvaluateV1,
  translator: TranslatorV2,
  contextualTutor: ContextualTutorV2,
  professorProfile: ProfessorProfileV1,
  mistakeAnalyzer: MistakeAnalyzerV2,
  quizGenerator: QuizGeneratorV4,
  visualizationGenerator: VisualizationGeneratorV7,
  homeworkAnalyzer: HomeworkAnalyzerV2,
  homeworkQuestion: HomeworkQuestionV3,
  homeworkQa: HomeworkQaV1,
  homeworkReview: HomeworkReviewV1,
  homeworkAnswerCheck: HomeworkAnswerCheckV1,
  slideLesson: SlideLessonV1,
  /** Appended to other prompts; see `withSubject` / `subjectPromptVersion`. */
  subjectProfile: SubjectProfileV1,
  shortAnswerCheck: ShortAnswerCheckV1,
  rubricExtractor: RubricExtractorV1,
  referenceImageQuery: ReferenceImageQueryV1,
  referenceImageCheck: ReferenceImageCheckV1,
} as const

export type {
  DocumentAnalyzerInput,
  DocumentAnalysisOutput,
} from './document-analyzer/v2'
export type { LessonInput } from './tutor/v5-lesson'
export type { IntroduceConceptInput } from './tutor/v1-introduce'
export type { QuestionGeneratorInput } from './tutor/v2-question'
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
} from './quiz-generator/v4'
export type { VisualizationInput, VisualizationOutput } from './visualization-generator/v7'
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
