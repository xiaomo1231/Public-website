import type { RubricSource } from './origin'
import type { SigFigBasis } from './answerDimensions'
import type { VectorSpec } from '@/infrastructure/math/vectorAnswer'
import type { EconNumberSpec } from '@/infrastructure/math/economicsAnswer'
import type { MarketQuestion } from '@/entities/econ/graphQuestion'
import { formatMarketAnswerCode, isMarketQuestionType } from '@/entities/econ/graphAnswerText'
import type { NomenclatureSpec } from '@/infrastructure/chemistry/nomenclature'
import { formatForceAnswer, formatForces, type ForceSpec } from './forceList'
import { formatVectorSpec } from '@/infrastructure/math/vectorAnswer'
import type { DifficultyLevel } from '@/infrastructure/ai/prompts/types'
import type { SourceReference } from '@/entities/courseAnalysis/types'
import type { TranslationKey } from '@/i18n/types'
import type { Subject } from '@/entities/project/types'
import {
  decodeGenderAnswer,
  genderAnswerText,
  paradigmAnswerText,
  paradigmBlanks,
  paradigmCellLabel,
  type GenderNoun,
  type ParadigmTable,
} from './languageDrills'

export type QuestionType =
  | 'multiple_choice'
  | 'true_false'
  | 'numeric'
  | 'math_expr'
  | 'code_output'
  | 'short_answer'
  | 'chem_equation'
  | 'ordering'
  | 'multiple_select'
  | 'matching'
  | 'fill_blank'
  | 'article_gender'
  | 'paradigm_table'
  | 'vector'
  | 'nomenclature'
  | 'force_list'
  /** Economics graph questions (a supply-and-demand diagram graded by the market engine). */
  | 'shift_id'
  | 'area_read'
  | 'draw_diagram'

export const QUESTION_TYPES: QuestionType[] = [
  'multiple_choice',
  'true_false',
  'numeric',
  'math_expr',
  'code_output',
  'short_answer',
  'chem_equation',
  'ordering',
  'multiple_select',
  'matching',
  'fill_blank',
  'article_gender',
  'paradigm_table',
  'vector',
  'nomenclature',
  'force_list',
  'shift_id',
  'area_read',
  'draw_diagram',
]

export const QUESTION_TYPE_LABEL_KEYS: Record<QuestionType, TranslationKey> = {
  multiple_choice: 'questionType.multipleChoice',
  true_false: 'questionType.trueFalse',
  numeric: 'questionType.numeric',
  math_expr: 'questionType.expression',
  code_output: 'questionType.codeOutput',
  short_answer: 'questionType.shortAnswer',
  chem_equation: 'questionType.chemEquation',
  ordering: 'questionType.ordering',
  multiple_select: 'questionType.multipleSelect',
  matching: 'questionType.matching',
  fill_blank: 'questionType.fillBlank',
  article_gender: 'questionType.articleGender',
  paradigm_table: 'questionType.paradigmTable',
  vector: 'questionType.vector',
  nomenclature: 'questionType.nomenclature',
  force_list: 'questionType.forceList',
  shift_id: 'questionType.shiftId',
  area_read: 'questionType.areaRead',
  draw_diagram: 'questionType.drawDiagram',
}

/** One scoring point of a short-answer question. */
export interface RubricPoint {
  /** Stable within the question: `p1`, `p2`, … */
  id: string
  /** One idea the answer must contain, stated in a single sentence. */
  text: string
}

export type QuestionOrigin = 'ai_without_source'

/**
 * Oral-exam rehearsal: a drawn topic is one main question ("Describe …",
 * graded by its 6–10 scoring points) and its follow-up questions, all stored
 * as ordinary short answers that share `group`. Absent on every other question.
 */
export interface OralQuestionInfo {
  /** Shared by the main question and its follow-ups. */
  group: string
  role: 'main' | 'follow_up'
  /** The drawn topic as the syllabus / course names it. */
  topic: string
}

export interface QuestionOption {
  id: string
  label: string
  isCorrect: boolean
}

export interface Question {
  id: string
  projectId: string
  topicId?: string
  knowledgePoint: string
  type: QuestionType
  difficulty: DifficultyLevel
  prompt: string
  /** Present for multiple_choice. True/false is modelled as two options too. */
  options?: QuestionOption[]
  /** Canonical answer string (option id for MC/TF, value otherwise). */
  correctAnswer: string
  /**
   * Numeric only: the unit the value is expressed in (mathjs syntax, e.g.
   * `m/s^2`). When present the student must answer with a unit; any unit of
   * the same dimension is converted before grading.
   */
  unit?: string
  /**
   * Short answer only: the scoring points. The score is the share of points
   * the answer covers (3 of 5 points → 3/5), checked by AI point by point
   * with verbatim evidence verified locally.
   */
  rubric?: RubricPoint[]
  /**
   * Short answer only: who set `rubric` (see `rubricSourceOf`). Quiz, oral
   * and tutor points are written by the platform; absent on older rows, which
   * read as `platform`.
   */
  rubricSource?: RubricSource
  /**
   * Numeric (with or without a unit) only: the number of significant figures
   * the answer must carry. Absent ⇒ significant figures are not checked. The
   * value, the unit and the significant figures are judged separately; how a
   * sig-fig slip counts is the course's rule (`Project.sigFigPolicy`).
   */
  sigFigs?: number
  /** Why `sigFigs` is required, for the feedback. */
  sigFigsBasis?: SigFigBasis
  /**
   * Numeric without a unit, economics: how the answer is read (absolute-value
   * elasticity, amounts stated in thousands, a percentage). Economics courses
   * also read it from the question text (`econSpecFromText`); this field wins.
   */
  econ?: EconNumberSpec
  /** Vector only: the reference vector (components, unit). */
  vector?: VectorSpec
  /** Nomenclature only: the compound, which way it is asked, and accepted names. */
  nomenclature?: NomenclatureSpec
  /** Free-body diagram only: the forces acting on the body. */
  forces?: ForceSpec[]
  /**
   * Economics graph questions (`shift_id`, `area_read`, `draw_diagram`) only:
   * the market (curves + scenario), what the figure shows and what is asked.
   * The expected answer is always recomputed from it (`gradeMarketQuestion`);
   * `correctAnswer` is only the reference text shown to the student.
   */
  market?: MarketQuestion
  /**
   * Ordering only: the items in the CORRECT order. `correctAnswer` is the same
   * items joined by newlines; the field shows them shuffled.
   */
  orderItems?: string[]
  /**
   * Matching (B-type) only: the stems that share `options`. `correctAnswer`
   * holds the matched option labels in stem order, joined by " | ".
   */
  matchItems?: string[]
  /**
   * Fill-blank only: per blank (written ____ in the prompt), the accepted
   * answers — the standard term first, then exact synonyms / abbreviations.
   */
  blanks?: string[][]
  /** Article question (German courses) only: the noun, its article and plural. */
  gender?: GenderNoun
  /** Paradigm-table question (language courses) only: the table with its blanks. */
  paradigm?: ParadigmTable
  solution?: string
  hints: string[]
  sourceRefs: SourceReference[]
  /**
   * `ai_without_source`: generated for an exam topic the course material does
   * not cover (syllabus quiz, opted in); it has no course source and is
   * labelled as AI-generated. Absent for every other question.
   */
  origin?: QuestionOrigin
  /** Oral-exam rehearsal only: which drawn topic it belongs to and its role. */
  oral?: OralQuestionInfo
  /** Prompt version that produced this question. */
  promptVersion: string
  createdAt: number
}

export interface NewQuestionInput {
  projectId: string
  topicId?: string
  knowledgePoint: string
  type: QuestionType
  difficulty: DifficultyLevel
  prompt: string
  options?: Array<{ label: string; isCorrect: boolean }>
  correctAnswer: string
  unit?: string
  rubric?: RubricPoint[]
  rubricSource?: RubricSource
  sigFigs?: number
  sigFigsBasis?: SigFigBasis
  econ?: EconNumberSpec
  vector?: VectorSpec
  nomenclature?: NomenclatureSpec
  forces?: ForceSpec[]
  market?: MarketQuestion
  orderItems?: string[]
  matchItems?: string[]
  blanks?: string[][]
  gender?: GenderNoun
  paradigm?: ParadigmTable
  solution?: string
  hints?: string[]
  sourceRefs?: SourceReference[]
  origin?: QuestionOrigin
  oral?: OralQuestionInfo
  promptVersion?: string
}

export function normalizeQuestionOptions(
  options: Array<{ label: string; isCorrect: boolean }> | undefined,
): QuestionOption[] | undefined {
  if (!options || options.length === 0) return undefined
  return options.map((o, idx) => ({
    id: `opt-${idx + 1}`,
    label: o.label,
    isCorrect: o.isCorrect,
  }))
}
/** The canonical answer as shown to the student, with its unit when it has one. */
export function expectedAnswerText(
  question: Pick<Question, 'correctAnswer' | 'unit' | 'type'> &
    Partial<
      Pick<
        Question,
        'options' | 'matchItems' | 'blanks' | 'gender' | 'paradigm' | 'vector' | 'forces'
      >
    >,
): string {
  if (question.type === 'article_gender' && question.gender)
    return genderAnswerText(question.gender)
  if (question.type === 'paradigm_table' && question.paradigm)
    return paradigmAnswerText(question.paradigm)
  if (question.type === 'ordering') return question.correctAnswer.split('\n').join(' → ')
  if (question.type === 'multiple_select' && question.options) {
    return question.options
      .map((option, i) => (option.isCorrect ? `${optionLetter(i)}. ${option.label}` : ''))
      .filter(Boolean)
      .join('；')
  }
  if (question.type === 'matching' && question.matchItems) {
    const labels = question.correctAnswer.split(' | ')
    return question.matchItems
      .map((item, i) => {
        const index = question.options?.findIndex((option) => option.label === labels[i]) ?? -1
        return `${i + 1}. ${item} → ${index >= 0 ? optionLetter(index) : (labels[i] ?? '')}`
      })
      .join('；')
  }
  if (question.type === 'fill_blank' && question.blanks) {
    return question.blanks.map((answers, i) => `(${i + 1}) ${answers[0] ?? ''}`).join('  ')
  }
  if (question.type === 'vector' && question.vector) return formatVectorSpec(question.vector)
  if (question.type === 'force_list' && question.forces) return formatForces(question.forces)
  return question.unit ? `${question.correctAnswer} ${question.unit}` : question.correctAnswer
}

/** A, B, C … for option positions. */
export function optionLetter(index: number): string {
  return String.fromCharCode(65 + index)
}

/**
 * A stored answer as the student should read it: option ids become letters
 * and labels ("A. …"), matching answers "1→B", blanks "(1) … (2) …".
 */
export function displayAnswer(
  question: Pick<Question, 'type'> &
    Partial<Pick<Question, 'options' | 'matchItems' | 'gender' | 'paradigm'>>,
  userAnswer: string,
): string {
  const options = question.options ?? []
  const describe = (id: string) => {
    const index = options.findIndex((o) => o.id === id.trim())
    return index >= 0 ? `${optionLetter(index)}. ${options[index]!.label}` : id
  }
  if (!userAnswer.trim()) return ''
  if (question.type === 'multiple_choice') return describe(userAnswer)
  if (question.type === 'multiple_select')
    return userAnswer.split(',').filter(Boolean).map(describe).join('；')
  if (question.type === 'matching') {
    return userAnswer
      .split(',')
      .map((id, i) => {
        const index = options.findIndex((o) => o.id === id.trim())
        return `${i + 1}→${index >= 0 ? optionLetter(index) : '—'}`
      })
      .join('  ')
  }
  if (question.type === 'article_gender') {
    const { article, plural } = decodeGenderAnswer(userAnswer)
    const noun = question.gender?.noun ?? ''
    const singular = [article || '—', noun].filter(Boolean).join(' ')
    return question.gender?.plural ? `${singular}, ${plural || '—'}` : singular
  }
  if (question.type === 'paradigm_table' && question.paradigm) {
    const table = question.paradigm
    const given = userAnswer.split('\n')
    return paradigmBlanks(table)
      .map(
        (blank, i) =>
          `${paradigmCellLabel(table, blank.row, blank.column)}: ${given[i]?.trim() || '—'}`,
      )
      .join('；')
  }
  if (question.type === 'force_list') return formatForceAnswer(userAnswer)
  if (isMarketQuestionType(question.type)) return formatMarketAnswerCode(userAnswer)
  if (question.type === 'fill_blank')
    return userAnswer
      .split('\n')
      .map((answer, i) => `(${i + 1}) ${answer || '—'}`)
      .join('  ')
  return userAnswer
}

/** Courses where vector answers (components or magnitude + direction) are offered. */
const VECTOR_SUBJECTS: readonly Subject[] = ['physics', 'calculus', 'linear_algebra']

/**
 * Question types a course offers. "What does this program print?" only makes
 * sense in a computer-science course, a chemical equation in chemistry; the
 * language drills only in a language course (the article of a noun only when
 * the course teaches German). Every other type is offered everywhere.
 */
export function questionTypesForSubject(
  subject: Subject | undefined,
  targetLanguage?: string,
): QuestionType[] {
  return QUESTION_TYPES.filter(
    (type) =>
      (type !== 'code_output' || subject === 'cs') &&
      (type !== 'chem_equation' || subject === 'chemistry') &&
      (type !== 'nomenclature' || subject === 'chemistry') &&
      (type !== 'force_list' || subject === 'physics') &&
      (!isMarketQuestionType(type) || subject === 'economics') &&
      (type !== 'vector' || VECTOR_SUBJECTS.includes(subject as Subject)) &&
      (type !== 'paradigm_table' || subject === 'language') &&
      (type !== 'article_gender' || (subject === 'language' && targetLanguage === 'de')),
  )
}

/**
 * The types ticked when a quiz is set up: a language course starts with its
 * drills plus the exam formats that suit vocabulary; every other course with
 * single choice.
 */
export function defaultQuestionTypes(
  subject: Subject | undefined,
  targetLanguage?: string,
): QuestionType[] {
  if (subject !== 'language') return ['multiple_choice']
  const offered = questionTypesForSubject(subject, targetLanguage)
  const wanted: QuestionType[] = [
    'article_gender',
    'paradigm_table',
    'fill_blank',
    'matching',
    'multiple_choice',
  ]
  return wanted.filter((type) => offered.includes(type))
}
