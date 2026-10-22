/**
 * Local validation of the steps `guided-steps/v1` converts a walkthrough into.
 *
 * The model only restructures the stored walkthrough: every blank's answer
 * must be found in the walkthrough text (after a loose LaTeX → plain
 * normalisation), otherwise the blank is dropped and its place shows `…`.
 * Each blank's kind must suit the course subject (so it is graded by the
 * right local grader); an unsuitable kind falls back to an accepted-answers
 * list (exact match for computer science).
 */
import { superscriptsToCaret } from '@/infrastructure/math/superscripts'
import type { Subject } from '@/entities/project/types'
import {
  GUIDED_BLANK_KINDS,
  type GuidedBlank,
  type GuidedBlankKind,
  type GuidedTextStep,
} from './guided'

export const MAX_GUIDED_STEPS = 12
export const MAX_BLANKS_PER_STEP = 4
const MAX_TEXT = 1_500
const MAX_EXPLANATION = 1_200
const MAX_ANSWER = 200
const MAX_ACCEPTED = 6

/** Which graders each subject's blanks may use. */
const SUBJECT_KINDS: Partial<Record<Subject, readonly GuidedBlankKind[]>> = {
  calculus: ['expression', 'number', 'text'],
  linear_algebra: ['expression', 'number', 'text'],
  discrete_math: ['expression', 'number', 'text'],
  physics: ['quantity', 'number', 'expression', 'text'],
  chemistry: ['chemistry', 'number', 'quantity', 'expression', 'text'],
  stats: ['number', 'expression', 'text'],
  biology: ['number', 'quantity', 'text'],
  medicine: ['number', 'quantity', 'text'],
  cs: ['exact'],
}

export function allowedBlankKinds(subject: Subject | undefined): readonly GuidedBlankKind[] {
  return (subject && SUBJECT_KINDS[subject]) || GUIDED_BLANK_KINDS
}

function fallbackKind(subject: Subject | undefined): GuidedBlankKind {
  return subject === 'cs' ? 'exact' : 'text'
}

/**
 * Text reduced for "does this answer appear in the walkthrough": LaTeX
 * commands to plain syntax, then spacing, grouping and multiplication signs
 * dropped (`\dfrac{1}{2}` ≈ `1/2`, `9.8\,\mathrm{m/s^2}` ≈ `9.8 m/s^2`).
 */
export function looseMathText(text: string): string {
  let value = superscriptsToCaret(text.normalize('NFKC').replace(/⁄/g, '/'), false)
  for (let i = 0; i < 4; i++) {
    value = value.replace(/([\^_])\{([^{}]*)\}/g, '$1$2')
    value = value.replace(/\\[dt]?frac\{([^{}]*)\}\{([^{}]*)\}/g, '($1)/($2)')
  }
  return value
    .replace(
      /\\(?:ce|text|mathrm|mathbf|operatorname|textbf|boldsymbol|mathit|boxed|pu)\{([^{}]*)\}/g,
      '$1',
    )
    .replace(/\\(?:left|right|big|Big|bigl|bigr)(?![a-zA-Z])/g, '')
    .replace(/\\(?:cdot|times|ast)(?![a-zA-Z])|[×⋅·∗*]/g, '')
    .replace(/\\(?:rightleftharpoons|leftrightharpoons)(?![a-zA-Z])|⇌|⇄|<=>/g, '⇌')
    .replace(/\\(?:longrightarrow|rightarrow|to)(?![a-zA-Z])|→|⟶|->/g, '→')
    .replace(/\\sqrt/g, 'sqrt')
    .replace(/\\pi(?![a-zA-Z])|π/g, 'pi')
    .replace(/\\(?:,|;|:|!|quad|qquad)|~|\$/g, '')
    .replace(/\\(?=[a-zA-Z])/g, '')
    .replace(/[−‒–—]/g, '-')
    .replace(/[{}()[\]\s]/g, '')
    .toLowerCase()
}

/** The answer (in any spelling the normalisation reconciles) occurs in the walkthrough. */
export function answerInWalkthrough(answer: string, walkthroughLoose: string): boolean {
  const loose = looseMathText(answer)
  return loose.length > 0 && walkthroughLoose.includes(loose)
}

const placeholder = (id: string) => `[[${id}]]`
const PLACEHOLDER = /\[\[([^[\]\s]{1,8})\]\]/g

function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  const text = value.trim()
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

export interface GuidedStepsValidation {
  steps: GuidedTextStep[]
  droppedBlanks: number
}

/**
 * Keep only what the walkthrough supports. Steps without text are dropped;
 * a step whose blanks were all dropped stays as a reading step.
 */
export function validateGuidedSteps(
  raw: unknown,
  walkthroughText: string,
  subject: Subject | undefined,
): GuidedStepsValidation {
  const list = raw && typeof raw === 'object' ? (raw as { steps?: unknown }).steps : undefined
  if (!Array.isArray(list)) return { steps: [], droppedBlanks: 0 }
  const source = looseMathText(walkthroughText)
  const allowed = allowedBlankKinds(subject)
  const steps: GuidedTextStep[] = []
  let droppedBlanks = 0
  for (const item of list.slice(0, MAX_GUIDED_STEPS)) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    let text = cleanText(record.text, MAX_TEXT)
    if (!text) continue
    const rawBlanks = Array.isArray(record.blanks) ? record.blanks : []
    const blanks: GuidedBlank[] = []
    const seen = new Set<string>()
    for (const rawBlank of rawBlanks) {
      if (!rawBlank || typeof rawBlank !== 'object') continue
      const blank = rawBlank as Record<string, unknown>
      const id = String(blank.id ?? '').trim()
      const answer = cleanText(blank.answer, MAX_ANSWER)
      if (!id || seen.has(id) || !text.includes(placeholder(id))) continue
      seen.add(id)
      if (!answer || !answerInWalkthrough(answer, source) || blanks.length >= MAX_BLANKS_PER_STEP) {
        droppedBlanks += 1
        text = text.split(placeholder(id)).join('…')
        continue
      }
      const requested = GUIDED_BLANK_KINDS.find((kind) => kind === blank.kind)
      const kind = requested && allowed.includes(requested) ? requested : fallbackKind(subject)
      const accepted = Array.isArray(blank.accepted)
        ? blank.accepted
            .filter((value): value is string => typeof value === 'string' && value.trim() !== '')
            .map((value) => value.trim().slice(0, MAX_ANSWER))
            .slice(0, MAX_ACCEPTED)
        : []
      const tolerance =
        typeof blank.tolerance === 'number' && blank.tolerance > 0 && blank.tolerance <= 0.1
          ? blank.tolerance
          : undefined
      blanks.push({
        id,
        answer,
        kind,
        ...(kind === 'text' && accepted.length > 0 ? { accepted } : {}),
        ...(kind === 'number' && tolerance !== undefined ? { tolerance } : {}),
      })
    }
    // Placeholders with no (valid) blank behind them.
    text = text.replace(PLACEHOLDER, (whole, id: string) =>
      blanks.some((blank) => blank.id === id) ? whole : '…',
    )
    const title = cleanText(record.title, 120)
    steps.push({
      ...(title ? { title } : {}),
      text,
      explanation: cleanText(record.explanation, MAX_EXPLANATION),
      blanks,
    })
  }
  return { steps, droppedBlanks }
}

/** The step text with each blank shown as a numbered gap (for display). */
export function stepTextWithGaps(step: GuidedTextStep, gap: (index: number) => string): string {
  return step.text.replace(PLACEHOLDER, (whole, id: string) => {
    const index = step.blanks.findIndex((blank) => blank.id === id)
    return index >= 0 ? gap(index) : whole
  })
}

/** The step text with the answers filled in (看这一步答案 / completed steps). */
export function stepTextWithAnswers(step: GuidedTextStep): string {
  return step.text.replace(PLACEHOLDER, (whole, id: string) => {
    const blank = step.blanks.find((item) => item.id === id)
    return blank ? `**${blank.answer}**` : whole
  })
}
