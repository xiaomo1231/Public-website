import type { SolutionKind } from '@/infrastructure/math/rref'

/**
 * 讲解末尾「做练习题」: new practice questions built from a finished
 * assignment walkthrough, stored as a homework set of their own
 * (`HomeworkSet.kind === 'practice'`, `parentSetId` → the assignment).
 *
 * `full` (完整版) mirrors the assignment one-to-one: the same questions, the
 * same number of sub-parts, the same kind of task and the same solution type
 * per sub-part, with new numbers and contexts. `compact` (精简版) asks one
 * question per category / key point of the walkthrough summary, plus one or
 * two integrative questions.
 */
export type PracticeMode = 'full' | 'compact'

export const PRACTICE_MODES: readonly PracticeMode[] = ['full', 'compact']

/** Where a question came from: a local template (answers computed here) or the AI. */
export type PracticeOrigin = 'local' | 'ai'

/**
 * How a sub-part's answer is checked locally. The stored answer is always the
 * locally computed one when a grader exists; `text` means no local check (the
 * AI answer check compares with the reference solution).
 */
export type PracticeGrader =
  | {
      kind: 'linear_system'
      /** The augmented matrix [A | b] (exact entries, e.g. "3", "-1/2"). */
      augmented: string[][]
      /** Its reduced row echelon form, computed locally. */
      rref: string[][]
      solution: SolutionKind
      /** Free variables (0 unless `infinite`). */
      free: number
    }
  | { kind: 'expression'; expected: string; constant?: boolean }
  /** `sigFigs`: the significant figures the answer must carry (value, unit and figures judged separately). */
  | { kind: 'numeric'; expected: number; relTol: number; sigFigs?: number }
  | { kind: 'quantity'; value: number; unit: string; sigFigs?: number }
  | { kind: 'chem_equation'; equation: string }
  /** AI 模拟卷 multiple choice: the correct option letter (`A` = first). */
  | { kind: 'choice'; correct: string; count: number }
  /** AI 模拟卷 vector answer (components in `unit`), compared like the quiz's vector questions. */
  | { kind: 'vector'; components: number[]; unit?: string }
  /** AI 模拟卷 nomenclature: formula ⇄ name, compared like the quiz's 命名题. */
  | {
      kind: 'nomenclature'
      direction: 'name_to_formula' | 'formula_to_name'
      formula: string
      names: string[]
    }
  | { kind: 'text' }

/** One answerable part of a practice question (the whole question when it has no sub-parts). */
export interface PracticePart {
  /** `a`, `b`, … ; absent for a single-part question. */
  label?: string
  /** The part's own task (Markdown + LaTeX). */
  prompt: string
  /** The short final answer shown and checked. */
  answer: string
  /** Worked solution (Markdown + LaTeX). Local templates write it from the computation. */
  solution: string
  grader: PracticeGrader
}

/** A practice question while it is built, checked and reviewed. */
export interface PracticeCandidate {
  /** Closed id for the review (`p1`, `p2`, …); stable while the set is built. */
  id: string
  /** The plan slot it fills. */
  slotId: string
  origin: PracticeOrigin
  /** Shared statement before the parts. */
  stem: string
  parts: PracticePart[]
  /** Local templates used (`linear_system`). */
  templates: string[]
  knowledgePoints: string[]
  /** How many times this slot was rebuilt / regenerated after a failed review. */
  rebuilds: number
  review?: { pass: boolean; reason: string }
}

/** What one slot of the plan asks for. */
export interface PracticeSlotPart {
  label?: string
  /** The original sub-part text (full mode). */
  text: string
  /** The local template that can build it, when one applies. */
  template?: PracticeTemplate
  /** Linear systems: the original's shape and solution type. */
  system?: { rows: number; vars: number; solution: SolutionKind; free: number }
}

/**
 * Local templates. Only linear algebra has one (systems with a chosen solution
 * type); every other subject is written by the AI (`practice-generate/v1`) and
 * its answers are checked locally where a grader exists.
 */
export type PracticeTemplate = 'linear_system'

export interface PracticeSlot {
  id: string
  mode: PracticeMode
  /** Full mode: the original question it mirrors. */
  sourceQuestionId?: string
  /** `2`, `2(a)`: how the original is labelled. */
  sourceLabel?: string
  /** Full mode: the original question text. */
  sourceText?: string
  /** Shared statement of the original (before its sub-parts). */
  sourceStem?: string
  parts: PracticeSlotPart[]
  knowledgePoints: string[]
  /** Compact mode: combines several knowledge points. */
  integrative?: boolean
  /** Every part has a local template: built here without the AI. */
  local: boolean
}

/**
 * The stage an unfinished build is at (kept on the set so 继续 picks up
 * there): `generating` — the first round (AI slots to write, then review);
 * `retrying` — questions that failed review, rebuilt or rewritten once and
 * reviewed again (those failing again are dropped).
 */
export type PracticeStage = 'generating' | 'retrying'

export interface PracticeDraft {
  stage: PracticeStage
  slots: PracticeSlot[]
  candidates: PracticeCandidate[]
  /** Slot ids the AI still has to write in the current stage. */
  pendingSlots: string[]
  /** Questions dropped so far, with why (failed local check / failed review). */
  dropped: Array<{ slotId: string; reason: string }>
  /** Why a slot's previous question was rejected (sent with the rewrite). */
  rejected?: Record<string, string>
  /** Next candidate number. */
  nextId: number
}

/** Stored on the practice set. */
export interface PracticeSetInfo {
  mode: PracticeMode
  /** Questions planned. */
  requested: number
  /** Questions dropped (failed local check or review twice). */
  dropped: number
  /** Short reasons for the dropped questions (shown to the student). */
  droppedReasons?: string[]
  /** Unfinished build; absent once the set is ready. */
  draft?: PracticeDraft
  generatedAt?: number
}

/** Stored on each practice question: where it came from and how it is checked. */
export interface PracticeQuestionInfo {
  origin: PracticeOrigin
  parts: Array<Pick<PracticePart, 'label' | 'answer' | 'grader'>>
  knowledgePoints: string[]
  templates: string[]
  /** Full mode: the original question it mirrors. */
  sourceQuestionId?: string
  /**
   * AI 模拟卷: the platform's marking scheme (平台拟定), one line per mark
   * allocation. Never the professor's.
   */
  markingScheme?: string[]
  /** AI 模拟卷: the course topics the question was written for. */
  topicIds?: string[]
  /** AI 模拟卷: the difficulty it was written at. */
  difficulty?: 'foundation' | 'medium' | 'exam' | 'above'
}

export const MAX_PRACTICE_QUESTIONS = 12
