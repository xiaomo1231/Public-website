/**
 * 引导练习 (guided practice) — data shapes and pure progress helpers.
 *
 * A question is practised step by step from its walkthrough:
 *  - **matrix** questions replay the walkthrough's row reductions locally
 *    (`guidedMatrix.ts`): operation first, then the resulting matrix;
 *  - **blank** questions use steps with blanks, converted once from the stored
 *    walkthrough by `guided-steps/v1` and cached on the walkthrough section
 *    (`GuidedStepsCache`), graded by the local grader of each blank's kind.
 *
 * The student's progress is stored on the question (`HomeworkQuestion.
 * guidedProgress`), tied by `key` to the steps it was made for, and counts as
 * the student's own work.
 */
import { fnv1a } from '@/shared/lib/hash'
import type { WalkthroughLevel } from './walkthrough'
import { applyOps, opsLatex, parseTypedOps, type GuidedChain, type Matrix } from './guidedMatrix'

/** How a blank is graded (see `services/guidedGrading.ts`). */
export type GuidedBlankKind = 'expression' | 'number' | 'quantity' | 'chemistry' | 'text' | 'exact'

export const GUIDED_BLANK_KINDS: readonly GuidedBlankKind[] = [
  'expression',
  'number',
  'quantity',
  'chemistry',
  'text',
  'exact',
]

export interface GuidedBlank {
  /** `1`, `2`, … — the placeholder `[[1]]` in the step text. */
  id: string
  /** As it appears in the walkthrough, in grader syntax (`x^2/2`, `9.8 m/s^2`). */
  answer: string
  kind: GuidedBlankKind
  /** `text`: other accepted spellings (synonyms, English / Chinese names). */
  accepted?: string[]
  /** `number`: relative tolerance (default 1%). */
  tolerance?: number
}

export interface GuidedTextStep {
  title?: string
  /** Markdown + LaTeX with `[[id]]` placeholders. */
  text: string
  /** What the walkthrough says about this step (提示). */
  explanation: string
  blanks: GuidedBlank[]
}

/** Steps converted from one walkthrough section, cached on the section. */
export interface GuidedStepsCache {
  promptVersion: string
  /** Which version of the walkthrough they came from. */
  level: WalkthroughLevel
  /** Hash of the walkthrough text they came from (`guidedSourceHash`). */
  sourceHash: string
  steps: GuidedTextStep[]
  /** Blanks dropped because their answer is not in the walkthrough. */
  droppedBlanks: number
  generatedAt: number
}

// --- Progress ----------------------------------------------------------------

export interface GuidedStepRecord {
  /** LaTeX of the operations that were accepted (matrix steps). */
  op?: string
  hintViewed?: boolean
  answerViewed?: boolean
}

/** The step being worked on (not yet complete). */
export interface GuidedPendingStep {
  /** Accepted operations (the matrix is then unlocked). */
  op?: string
  /** What was typed in the operation field. */
  typedOp?: string
  cells?: string[][]
  hintViewed?: boolean
  answerViewed?: boolean
}

export interface GuidedChainProgress {
  /** Completed steps, in order (their `op` replays the student's route). */
  records: GuidedStepRecord[]
  pending?: GuidedPendingStep
  done?: boolean
}

export interface GuidedBlankStepProgress {
  values: Record<string, string>
  hintViewed?: boolean
  answerViewed?: boolean
  done?: boolean
}

export interface GuidedProgress {
  /** Fingerprint of the steps the progress belongs to. */
  key: string
  kind: 'matrix' | 'blanks'
  chains?: GuidedChainProgress[]
  steps?: GuidedBlankStepProgress[]
  startedAt: number
  updatedAt: number
  completedAt?: number
}

/** Fingerprint of matrix exercises (start matrices + the walkthrough's operations). */
export function chainsKey(chains: readonly GuidedChain[]): string {
  return fnv1a(
    JSON.stringify(
      chains.map((chain) => ({
        start: chain.start.map((row) => row.map((value) => `${value.n}/${value.d}`)),
        ops: chain.steps.map((step) => opsLatex(step.ops)),
      })),
    ),
  )
}

export function blankStepsKey(steps: readonly GuidedTextStep[]): string {
  return fnv1a(JSON.stringify(steps))
}

/** Hash of the walkthrough text a set of blank steps is converted from. */
export function guidedSourceHash(content: {
  conclusion?: string
  body: string
  level: WalkthroughLevel
}): string {
  return fnv1a(JSON.stringify([content.level, content.conclusion ?? '', content.body]))
}

export function emptyProgress(
  kind: GuidedProgress['kind'],
  key: string,
  size: number,
  now = Date.now(),
): GuidedProgress {
  return {
    key,
    kind,
    ...(kind === 'matrix'
      ? { chains: Array.from({ length: size }, () => ({ records: [] })) }
      : { steps: Array.from({ length: size }, () => ({ values: {} })) }),
    startedAt: now,
    updatedAt: now,
  }
}

/** Stored progress when it still belongs to these steps, else a fresh start. */
export function progressFor(
  stored: GuidedProgress | undefined,
  kind: GuidedProgress['kind'],
  key: string,
  size: number,
): GuidedProgress {
  if (stored && stored.kind === kind && stored.key === key) {
    if (kind === 'matrix' && stored.chains?.length === size) return stored
    if (kind === 'blanks' && stored.steps?.length === size) return stored
  }
  return emptyProgress(kind, key, size)
}

export interface GuidedSummary {
  stepsDone: number
  hintsViewed: number
  answersViewed: number
  /** Every exercise (chain) / step is done. */
  complete: boolean
}

export function summarizeProgress(progress: GuidedProgress | undefined): GuidedSummary {
  if (!progress) return { stepsDone: 0, hintsViewed: 0, answersViewed: 0, complete: false }
  if (progress.kind === 'matrix') {
    const chains = progress.chains ?? []
    const records = chains.flatMap((chain) => chain.records)
    const pending = chains.flatMap((chain) => (chain.pending ? [chain.pending] : []))
    return {
      stepsDone: records.length,
      hintsViewed: [...records, ...pending].filter((record) => record.hintViewed).length,
      answersViewed: [...records, ...pending].filter((record) => record.answerViewed).length,
      complete: chains.length > 0 && chains.every((chain) => chain.done),
    }
  }
  const steps = progress.steps ?? []
  return {
    stepsDone: steps.filter((step) => step.done).length,
    hintsViewed: steps.filter((step) => step.hintViewed).length,
    answersViewed: steps.filter((step) => step.answerViewed).length,
    complete: steps.length > 0 && steps.every((step) => step.done),
  }
}

/** Anything the student did in guided practice (it is their work: not deleted silently). */
export function guidedHasWork(progress: GuidedProgress | undefined): boolean {
  if (!progress) return false
  if (progress.kind === 'matrix')
    return (progress.chains ?? []).some(
      (chain) =>
        chain.records.length > 0 ||
        Boolean(chain.pending?.op || chain.pending?.typedOp?.trim()) ||
        Boolean(chain.pending?.cells?.some((row) => row.some((cell) => cell.trim()))) ||
        Boolean(chain.pending?.hintViewed || chain.pending?.answerViewed),
    )
  return (progress.steps ?? []).some(
    (step) =>
      step.done ||
      step.hintViewed ||
      step.answerViewed ||
      Object.values(step.values).some((value) => value.trim()),
  )
}

export interface ReplayedRoute {
  /** Matrix before each completed step, then the current one. */
  matrices: Matrix[]
  current: Matrix
}

/** The student's own route: the start, then each accepted operation applied. */
export function replayRoute(
  chain: GuidedChain,
  progress: GuidedChainProgress,
): ReplayedRoute | null {
  const matrices: Matrix[] = [chain.start]
  let current = chain.start
  for (const record of progress.records) {
    const ops = record.op ? parseTypedOps(record.op) : null
    const applied = ops ? applyOps(current, ops) : null
    if (!applied) return null
    current = applied.matrix
    matrices.push(current)
  }
  return { matrices, current }
}
