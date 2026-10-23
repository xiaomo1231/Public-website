/**
 * Centralised prompt registry. Each entry is callable with the inputs its
 * `v1` module declares. New versions can be added next to `v1` and switched
 * here in one place.
 */

import * as DocumentAnalyzerV3 from './document-analyzer/v3'
import * as TopicAnalyzerV2 from './topic-analyzer/v2'
import * as TutorLessonV5 from './tutor/v5-lesson'
import * as TutorIntroduceV1 from './tutor/v1-introduce'
import * as TutorQuestionV3 from './tutor/v3-question'
import * as TutorEvaluateV2 from './tutor/v2-evaluate'
import * as TranslatorV2 from './translator/v2'
import * as ContextualTutorV3 from './contextual-tutor/v3'
import * as ProfessorProfileV1 from './professor-profile/v1'
import * as MistakeAnalyzerV2 from './mistake-analyzer/v2'
import * as QuizGeneratorV10 from './quiz-generator/v10'
import * as VisualizationGeneratorV11 from './visualization-generator/v11'
import * as HomeworkAnalyzerV2 from './homework-analyzer/v2'
import * as HomeworkQuestionV5 from './homework-question/v5'
import * as HomeworkQaV1 from './homework-qa/v1'
import * as HomeworkReviewV1 from './homework-review/v1'
import * as HomeworkWalkthroughV9 from './homework-walkthrough/v9'
import * as HomeworkAnswerCheckV1 from './homework-answer-check/v1'
import * as WalkthroughImportV2 from './walkthrough-import/v2'
import * as WalkthroughCompareV2 from './walkthrough-compare/v2'
import * as ProfessorAnswerMapV1 from './professor-answer-map/v1'
import * as SlideLessonV1 from './slide-lesson/v1'
import * as SubjectProfileV1 from './subject-profile/v1'
import * as ShortAnswerCheckV1 from './short-answer-check/v1'
import * as RubricExtractorV1 from './rubric-extractor/v1'
import * as ReferenceImageQueryV2 from './reference-image-query/v2'
import * as ReferenceImageCheckV1 from './reference-image-check/v1'
import * as FillBlankCheckV1 from './fill-blank-check/v1'
import * as SyllabusTopicsV1 from './syllabus-topics/v1'
import * as ExamTopicMatchV1 from './exam-topic-match/v1'
import * as VocabGlossV2 from './vocab-gloss/v2'
import * as VocabListSplitV1 from './vocab-list-split/v1'
import * as ExamTermsV1 from './exam-terms/v1'
import * as ExamLanguageV1 from './exam-language/v1'
import * as PhraseExtractV1 from './phrase-extract/v1'
import * as InterviewScenarioV1 from './interview-scenario/v1'
import * as InterviewPatientV1 from './interview-patient/v1'
import * as InterviewSummaryCheckV1 from './interview-summary-check/v1'
import * as OralExamV2 from './oral-exam/v2'
import * as PracticeGenerateV4 from './practice-generate/v4'
import * as PracticeReviewV1 from './practice-review/v1'
import * as MockPaperV3 from './mock-paper/v3'
import * as GuidedStepsV1 from './guided-steps/v1'
import * as QuestionStyleV2 from './question-style/v2'
import * as QuestionTranslateV2 from './question-translate/v2'
import * as StudyPlanSummaryV1 from './study-plan-summary/v1'
import * as HandwritingTranscribeV1 from './handwriting-transcribe/v1'
import * as EconGraphReadV1 from './econ-graph-read/v1'
import * as PageTranscribeV1 from './page-transcribe/v1'

export const PROMPT_VERSIONS = {
  documentAnalyzer: 'v3',
  topicAnalyzer: 'v2',
  tutorLesson: 'v5',
  tutorIntroduce: 'v1',
  tutorQuestion: 'v3',
  tutorEvaluate: 'v2',
  translator: 'v2',
  contextualTutor: 'v3',
  professorProfile: 'v1',
  mistakeAnalyzer: 'v2',
  quizGenerator: 'v10',
  visualizationGenerator: 'v11',
  homeworkAnalyzer: 'v2',
  homeworkQuestion: 'v5',
  homeworkQa: 'v1',
  homeworkReview: 'v1',
  homeworkWalkthrough: 'v9',
  homeworkAnswerCheck: 'v1',
  walkthroughImport: 'v2',
  walkthroughCompare: 'v2',
  professorAnswerMap: 'v1',
  slideLesson: 'v1',
  subjectProfile: 'v1',
  shortAnswerCheck: 'v1',
  rubricExtractor: 'v1',
  referenceImageQuery: 'v2',
  referenceImageCheck: 'v1',
  fillBlankCheck: 'v1',
  syllabusTopics: 'v1',
  examTopicMatch: 'v1',
  vocabGloss: 'v2',
  vocabListSplit: 'v1',
  examTerms: 'v1',
  examLanguage: 'v1',
  phraseExtract: 'v1',
  interviewScenario: 'v1',
  interviewPatient: 'v1',
  interviewSummaryCheck: 'v1',
  oralExam: 'v2',
  practiceGenerate: 'v4',
  practiceReview: 'v1',
  mockPaper: 'v3',
  guidedSteps: 'v1',
  questionStyle: 'v2',
  questionTranslate: 'v2',
  studyPlanSummary: 'v1',
  handwritingTranscribe: 'v1',
  econGraphRead: 'v1',
  pageTranscribe: 'v1',
} as const

export const prompts = {
  documentAnalyzer: DocumentAnalyzerV3,
  topicAnalyzer: TopicAnalyzerV2,
  tutorLesson: TutorLessonV5,
  tutorIntroduce: TutorIntroduceV1,
  tutorQuestion: TutorQuestionV3,
  tutorEvaluate: TutorEvaluateV2,
  translator: TranslatorV2,
  contextualTutor: ContextualTutorV3,
  professorProfile: ProfessorProfileV1,
  mistakeAnalyzer: MistakeAnalyzerV2,
  quizGenerator: QuizGeneratorV10,
  visualizationGenerator: VisualizationGeneratorV11,
  homeworkAnalyzer: HomeworkAnalyzerV2,
  homeworkQuestion: HomeworkQuestionV5,
  homeworkQa: HomeworkQaV1,
  homeworkReview: HomeworkReviewV1,
  homeworkWalkthrough: HomeworkWalkthroughV9,
  homeworkAnswerCheck: HomeworkAnswerCheckV1,
  walkthroughImport: WalkthroughImportV2,
  walkthroughCompare: WalkthroughCompareV2,
  professorAnswerMap: ProfessorAnswerMapV1,
  slideLesson: SlideLessonV1,
  /** Appended to other prompts; see `withSubject` / `subjectPromptVersion`. */
  subjectProfile: SubjectProfileV1,
  shortAnswerCheck: ShortAnswerCheckV1,
  rubricExtractor: RubricExtractorV1,
  referenceImageQuery: ReferenceImageQueryV2,
  referenceImageCheck: ReferenceImageCheckV1,
  fillBlankCheck: FillBlankCheckV1,
  syllabusTopics: SyllabusTopicsV1,
  examTopicMatch: ExamTopicMatchV1,
  vocabGloss: VocabGlossV2,
  vocabListSplit: VocabListSplitV1,
  examTerms: ExamTermsV1,
  /** Language line of 跟随考试语言 (`exam:<code>`), used inside other prompts. */
  examLanguage: ExamLanguageV1,
  phraseExtract: PhraseExtractV1,
  interviewScenario: InterviewScenarioV1,
  interviewPatient: InterviewPatientV1,
  interviewSummaryCheck: InterviewSummaryCheckV1,
  oralExam: OralExamV2,
  practiceGenerate: PracticeGenerateV4,
  practiceReview: PracticeReviewV1,
  /** AI 模拟卷: one question per request, then a batched review. */
  mockPaper: MockPaperV3,
  guidedSteps: GuidedStepsV1,
  questionStyle: QuestionStyleV2,
  questionTranslate: QuestionTranslateV2,
  studyPlanSummary: StudyPlanSummaryV1,
  /** 手写识别: transcribe a handwritten answer exactly (no corrections, `[?]` marks). */
  handwritingTranscribe: HandwritingTranscribeV1,
  econGraphRead: EconGraphReadV1,
  /** A photographed / scanned page read by the vision model (instead of local OCR). */
  pageTranscribe: PageTranscribeV1,
} as const

export type { DocumentAnalyzerInput, DocumentAnalysisOutput } from './document-analyzer/v3'
export type { LessonInput } from './tutor/v5-lesson'
export type { IntroduceConceptInput } from './tutor/v1-introduce'
export type { QuestionGeneratorInput } from './tutor/v2-question'
export type { GeneratedQuestion } from './types'
export type { EvaluateAnswerInput } from './tutor/v1-evaluate'
export type { TranslateInput } from './translator/v1'
export type { ContextualTutorInput } from './contextual-tutor/v1'
export type { MistakeAnalyzerInput, MistakeAnalyzerOutput } from './mistake-analyzer/v2'
export type {
  QuizGenerationInput,
  QuizGenerationOutput,
  GeneratedQuizQuestion,
  QuizQuestionType,
} from './quiz-generator/v9'
export type { VisualizationInput, VisualizationOutput } from './visualization-generator/v11'
export type { HomeworkAnalyzerInput, HomeworkAnalyzerOutput } from './homework-analyzer/v1'
export type { HomeworkQuestionInput, HomeworkQuestionOutput } from './homework-question/v5'
export type { HomeworkQaInput, HomeworkQaHistoryItem } from './homework-qa/v1'
export type { SlideLessonInput, SlideLessonOutput } from './slide-lesson/v1'
