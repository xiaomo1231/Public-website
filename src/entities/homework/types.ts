import type { QuestionTranslation } from './questionTranslation'
import type { ProfessorAnswerMap, ProfessorMapEdits } from './professorMap'
import type { SourceReference } from '@/entities/courseAnalysis/types'
import type { AnswerEntry } from './answerMatching'
import type { TranslationKey } from '@/i18n/types'
import type { HomeworkReviewGuide } from './reviewGuide'
import type { HomeworkAnswerCheck } from './answerCheck'
import type { PracticeQuestionInfo, PracticeSetInfo } from './practice/types'
import type { GuidedProgress } from './guided'
import type { ExamSetInfo } from '@/entities/exam/types'
import type { EvalRole } from '@/entities/evaluation/evalRole'
import type { EvaluationRecord } from '@/entities/evaluation/types'
import type { ParseErrorKind } from './proofread'

/** One 导入校对 edit of a question or of its matched professor answer. */
export interface HomeworkQuestionEdit {
  at: number
  /** Always the local student (kept explicit for exported histories). */
  by: 'student'
  field: 'prompt' | 'number' | 'answerText'
  before: string
  after: string
  /** What the correction looks like (minus sign, exponent, …), for parsing accuracy. */
  kinds: ParseErrorKind[]
}

/** Course topics and exam-scope topics a homework question touches (computed locally). */
export interface HomeworkQuestionMeta {
  topicIds: string[]
  knowledgePoints: string[]
  examTopics: Array<{
    documentId: string
    scopeId: string
    scopeLabel: string
    topicId: string
    text: string
  }>
  /** Inputs the links were computed from; a change recomputes them. */
  fingerprint: string
  computedAt: number
}

export interface TeacherMark {
  verdict: 'correct' | 'partial' | 'incorrect'
  note?: string
  at: number
}

export interface HomeworkSelfTest {
  answer: string
  verdict: 'correct' | 'partial' | 'incorrect' | 'uncertain'
  /** `self` — the student marked it; `check` — the answer check decided. */
  by: 'self' | 'check'
  at: number
}

/**
 * A student-uploaded homework assignment that the AI has turned into questions.
 *
 * This is a *separate* small domain from Professor Practice: Practice grades
 * against a professor answer key, while homework has no key — the AI provides
 * progressive hints and a worked solution the student reveals on demand. Both
 * reuse the same uploader, chunk model, source-reference grounding and AI
 * provider; neither duplicates the other.
 */
export interface HomeworkSet {
  id: string
  projectId: string
  documentId: string
  documentName: string
  title: string
  status: HomeworkStatus
  language: 'zh' | 'en' | 'mixed'
  questionCount: number
  /** Actionable reason when the whole set could not be analysed. */
  errorMessage?: string
  /**
   * Set when a re-analysis produced usable questions but could not read every
   * range (a batch failed or the document exceeded the batch cap). Lets the UI
   * say "recognized X, Y ranges unfinished" instead of a silent success.
   */
  analysisNote?: string
  /** document-analyzer-family prompt version that produced the questions. */
  promptVersion: string
  /**
   * The professor's answer document linked to this assignment, when one was
   * uploaded. Points at a real `Document` (`materialType: 'homework_answer'`)
   * in the same project — the association never copies the file. Optional, so
   * assignments created before answer keys existed stay valid.
   */
  answerDocumentId?: string
  /**
   * A student-defined division of the answer document, used when the automatic
   * numbering parse could not split it. When present it replaces the parsed
   * entries for mapping; every entry keeps the real chunks/pages it came from.
   * Optional and non-indexed, so old rows stay valid.
   */
  answerEntries?: AnswerEntry[]
  /**
   * Live progress while the set is `analyzing`, so a card can show which stage
   * is running and how far it has got. Cleared when the run reaches a terminal
   * state (`ready` / `failed`). Optional, so rows written before it stay valid.
   */
  progress?: HomeworkProgress
  /**
   * When the student first dismissed the "the walkthrough contains every
   * solution" notice. Set once; the notice is not shown again for this set.
   */
  walkthroughNoticeSeenAt?: number
  /**
   * `practice` — a practice set made from an assignment's walkthrough
   * (讲解末尾「做练习题」). It shares the parent's `documentId` (so deleting the
   * assignment deletes it too) but is never re-read from the document.
   * Absent means an ordinary assignment.
   *
   * `exam` — a past exam / mock paper (`materialType: 'past_exam'`). Its
   * questions are recognised exactly like an assignment's; `exam` holds the
   * 模拟考试 settings and attempts.
   */
  kind?: 'assignment' | 'practice' | 'exam'
  /** Practice sets: the assignment they were made from. */
  parentSetId?: string
  /** Practice sets: mode, counts and an unfinished build. */
  practice?: PracticeSetInfo
  /** Exam papers: mock-exam duration, the attempt in progress and past attempts. */
  exam?: ExamSetInfo
  /** 留作检验 role of the whole set (questions may override it). */
  evalRole?: EvalRole
  /** 检验网站 runs on this set, newest first (at most `MAX_EVALUATION_RECORDS`). */
  evaluations?: EvaluationRecord[]
  createdAt: number
  updatedAt: number
}

/** A practice set made from an assignment (not an uploaded assignment). */
export const isPracticeSet = (set: Pick<HomeworkSet, 'kind'>): boolean => set.kind === 'practice'

/** A past exam / mock paper (往年试卷 / 模拟卷), not an assignment. */
export const isExamSet = (set: Pick<HomeworkSet, 'kind'>): boolean => set.kind === 'exam'

/** An AI 模拟卷: an exam set written by the platform, not an uploaded paper. */
export const isAiMockSet = (set: Pick<HomeworkSet, 'kind' | 'exam'>): boolean =>
  set.kind === 'exam' && set.exam?.origin === 'ai_mock'

/** An uploaded past paper (往年试卷), not an AI 模拟卷. */
export const isPastPaperSet = (set: Pick<HomeworkSet, 'kind' | 'exam'>): boolean =>
  isExamSet(set) && !isAiMockSet(set)

/**
 * A set the platform made (练习作业 / AI 模拟卷): it shares a document with an
 * uploaded set but is never re-read from it, never its duplicate, and never
 * a source of the professor's habits.
 */
export const isDerivedSet = (set: Pick<HomeworkSet, 'kind' | 'exam'>): boolean =>
  isPracticeSet(set) || isAiMockSet(set)

/**
 * Progress of an in-flight homework run.
 *
 * `completed` counts real finished work units (batches while identifying,
 * questions while generating); `total` is their known planned count, or
 * `undefined` when it is not yet known (the UI then shows an indeterminate
 * bar). Percentages are only ever computed from these counters — never from a
 * timer.
 */
export interface HomeworkProgress {
  stage: 'identifying' | 'generating'
  completed: number
  total?: number
  updatedAt: number
}

/**
 * `analyzing` — the upload finished and the AI run is in progress.
 * `ready`     — at least one question was extracted (per-question content may
 *               still have its own status).
 * `failed`    — nothing usable was extracted; `errorMessage` explains why.
 * `paused`    — the student paused the run. `progress` keeps the stage and how
 *               far it got; questions already prepared stay usable, and
 *               「继续」 does only what is left.
 */
export type HomeworkStatus = 'analyzing' | 'ready' | 'failed' | 'paused'

export const HOMEWORK_STATUS_LABEL_KEYS: Record<HomeworkStatus, TranslationKey> = {
  analyzing: 'homework.status.analyzing',
  ready: 'homework.status.ready',
  failed: 'homework.status.failed',
  paused: 'homework.status.paused',
}

/**
 * Per-question generation state for the hints + solution. `ready` means both
 * are present and validated; `failed` keeps the question visible with a retry.
 */
export type HomeworkQuestionStatus = 'pending' | 'ready' | 'failed'

/**
 * How a homework question relates to the linked professor answer.
 * `needs_review` answers are shown for checking but never used to generate.
 */
export type HomeworkQuestionAnswerStatus = 'matched' | 'needs_review'

/** One turn of the per-question help conversation. */
export interface HomeworkMessage {
  id: string
  role: 'student' | 'assistant'
  content: string
  /** Student turn: answer images sent along with it. */
  imageCount?: number
  /** Assistant turn: the model could not read the attached images. */
  imagesIgnored?: boolean
  createdAt: number
}

export interface HomeworkQuestion {
  id: string
  projectId: string
  setId: string
  documentId: string
  documentName: string
  order: number
  /** Printed number from the assignment, when one was recognised. */
  number?: string
  prompt: string
  /** Grounded in real document chunks only — never invented by the model. */
  sourceRefs: SourceReference[]
  /** Progressive hints, shown one at a time. Never reveal the final answer. */
  hints: string[]
  /** Complete worked solution, revealed only when the student asks for it. */
  solution?: string
  generationStatus: HomeworkQuestionStatus
  /** Actionable reason when this question's hints/solution failed. */
  generationError?: string
  /** Prompt version that produced the hints + solution. */
  promptVersion: string
  /** Fingerprint of the prompt + grounding, used to match across a re-analysis. */
  contentFingerprint?: string
  /**
   * True when a re-analysis no longer found this question. The row — and the
   * student's draft, hints and conversation — is kept so it can be viewed,
   * restored or explicitly deleted. Never silently removed.
   */
  retired?: boolean
  retiredAt?: number
  /**
   * The professor's answer assigned to THIS question, verbatim from the linked
   * answer document. Absent when no answer is linked. Never taken from the
   * model, and only ever set after a one-to-one confirmation.
   */
  answerText?: string
  /** The printed answer number it was matched from. */
  answerNumber?: string
  /** Real chunks of the answer document this answer text came from. */
  answerChunkIds?: string[]
  /**
   * `matched` — a single, unambiguous answer was confirmed for this question.
   * `needs_review` — an answer number was seen but the mapping is ambiguous or
   *   was not confirmed; the answer is NOT used for generation.
   * Absent means no answer is linked to this question.
   */
  answerStatus?: HomeworkQuestionAnswerStatus
  /**
   * True when the current hints + solution were generated from the professor
   * answer. Absent/false means they are the ordinary AI walkthrough.
   */
  answerBased?: boolean
  /**
   * The previous AI solution, kept only when it was replaced by an
   * answer-based solution, so the student can still compare instead of having
   * it silently overwritten. Never corrected or relabelled as the professor's.
   */
  previousSolution?: string
  /** Cached, source-linked teaching review. Optional for existing rows. */
  reviewGuide?: HomeworkReviewGuide
  /** Latest answer check, tied to the exact submitted draft and reference. */
  answerCheck?: HomeworkAnswerCheck
  /** 引导练习 progress (see `entities/homework/guided.ts`); counts as student work. */
  guidedProgress?: GuidedProgress
  /** 中文翻译 of `prompt` (see `entities/homework/questionTranslation.ts`), made on request. */
  translation?: QuestionTranslation
  /** 小题 ⇄ 教授答案对应 (AI, checked locally; see `entities/homework/professorMap.ts`). */
  professorMap?: ProfessorAnswerMap
  /** The student's changes to that map; they win over it. */
  professorMapEdits?: ProfessorMapEdits
  /** Student's saved working. Restored on reload. */
  draftText: string
  /** How many hints the student has revealed (0..hints.length). */
  revealedHints: number
  /** Whether the student has revealed the solution. */
  solutionRevealed: boolean
  messages: HomeworkMessage[]
  /**
   * Practice-set questions: the reference answers (computed locally where a
   * grader exists) and how each part is checked. `solution` holds the worked
   * reference solution.
   */
  practice?: PracticeQuestionInfo
  /**
   * 导入校对: the student checked this question (and its matched answer)
   * against the original page. Cleared by nothing but the student.
   */
  verifiedAt?: number
  /**
   * 导入校对 edits, oldest first (who / when / before / after). Everything
   * derived from the text before the last edit is shown as 「需重新确认」
   * (see `entities/homework/proofread.ts` `reconfirmItems`).
   */
  edits?: HomeworkQuestionEdit[]
  /**
   * The professor-answer link must be confirmed again: the printed number or
   * the question text changed materially while an answer was matched. The
   * link is downgraded to `needs_review` until then.
   */
  answerLinkStale?: boolean
  /** When the current hints + solution were written (absent on old rows). */
  contentAt?: number
  /** Local knowledge points + exam-scope links (see `entities/homework/questionMeta.ts`). */
  meta?: HomeworkQuestionMeta
  /** 留作检验 / 检验网站 role (see `entities/evaluation/evalRole.ts`). */
  evalRole?: EvalRole
  /** A mark the teacher gave the student's answer, entered for 检验网站 (grading agreement). */
  teacherMark?: TeacherMark
  /** 自测 (independent items only): the last held-out self-test result. */
  selfTest?: HomeworkSelfTest
  createdAt: number
  updatedAt: number
}

/**
 * What changed during a re-analysis. `matched` questions kept their AI content;
 * `regenerated` questions were matched but had their content updated (records
 * preserved); `added` are new; `restored` are previously retired questions that
 * matched again and were brought back with their records; `retired` are old
 * questions kept aside because they no longer matched; `failed` could not
 * generate content.
 */
export interface ReanalysisSummary {
  matched: number
  regenerated: number
  added: number
  restored: number
  retired: number
  failed: number
}

export const EMPTY_REANALYSIS_SUMMARY: ReanalysisSummary = {
  matched: 0,
  regenerated: 0,
  added: 0,
  restored: 0,
  retired: 0,
  failed: 0,
}

/** Cap on stored chat turns per question (keeps the row bounded). */
export const HOMEWORK_MESSAGE_LIMIT = 40

/** Cap on hints returned/accepted per question. */
export const HOMEWORK_MAX_HINTS = 4

export const HOMEWORK_ANALYZER_PROMPT_VERSION = 'v2'
export const HOMEWORK_QUESTION_PROMPT_VERSION = 'v3'
export const HOMEWORK_QA_PROMPT_VERSION = 'v1'
