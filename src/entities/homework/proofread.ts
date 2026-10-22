import type { HomeworkQuestion } from './types'
import type { WalkthroughSection } from './walkthrough'
import { walkthroughSubparts } from './splitQuestion'

/**
 * 导入校对 (proofreading recognised questions) — pure helpers.
 *
 * Risk detection points the student at the places recognition most often
 * gets wrong (dashes for minus signs, flattened exponents / subscripts,
 * matrices, tables, stacked fractions, sub-part boundaries, numbers that are
 * not in the source text). It only highlights; it never changes the text.
 */

export type ProofreadRiskKind =
  'minus_sign' | 'flattened_power' | 'matrix' | 'fraction' | 'table' | 'subpart' | 'number_mismatch'

export interface ProofreadRisk {
  kind: ProofreadRiskKind
  /** Offsets in the recognised text (end exclusive). */
  start: number
  end: number
  text: string
}

/** The kind of a correction, for parsing accuracy (检验网站). */
export type ParseErrorKind =
  | 'minus_sign'
  | 'exponent'
  | 'subscript'
  | 'fraction'
  | 'matrix'
  | 'subpart_boundary'
  | 'label'
  | 'other'

export const PARSE_ERROR_KINDS: readonly ParseErrorKind[] = [
  'minus_sign',
  'exponent',
  'subscript',
  'fraction',
  'matrix',
  'subpart_boundary',
  'label',
  'other',
]

/** Dash-like characters recognition puts where a minus sign was printed. */
const DASHES = '‐‑‒–—―﹘﹣－'
const DASH_RE = new RegExp(`[${DASHES}]`, 'g')
/** A dash between / before math operands. */
const MINUS_RISK_RE = new RegExp(
  `(?:^|[\\s(=+*/×,\\[{]|\\d|[a-zA-Z)])\\s*[${DASHES}]\\s*(?=[\\d(a-zA-Z.])`,
  'g',
)

/** `m/s2`, `cm3`, `kg m2`, `s-1`: a unit with its exponent flattened. */
const UNIT_POWER_RE =
  /(?<![A-Za-z\\])(?:m|s|cm|mm|km|kg|g|mol|L|J|N|Pa|Hz|K|A|V|W)(?:\/(?:m|s|cm|mm|kg|g|mol|L|K))?(?:-?[1-4])(?![\dA-Za-z^_])/g
/** `x10-1`, `× 10 -3`, `*10 5`: scientific notation with the exponent flattened. */
const SCI_POWER_RE = /[x×*·]\s*10\s*[-−–]?\s*\d+(?![\d^])/g
/** `x2 + 1`, `a3` next to an operator: a power or a subscript lost its mark. */
const VAR_POWER_RE = /(?<![A-Za-z\\_^{])[a-zA-Z]\d(?![\d.])(?=\s*[+\-−=)<>]|\s*$)/g

const NUMBER_RE = /\d+(?:[.,]\d+)?/g

/** `(a)` / `（b）` in the middle of a line (a sub-part boundary that may have been lost). */
const MIDLINE_SUBPART_RE = /[^\s\n：:；;。][ \t]+[(（]([a-z])[)）][ \t]/g

function lines(text: string): Array<{ text: string; start: number }> {
  const out: Array<{ text: string; start: number }> = []
  let start = 0
  for (const line of text.split('\n')) {
    out.push({ text: line, start })
    start += line.length + 1
  }
  return out
}

const isNumericRow = (line: string): boolean => {
  const cells = line.trim().split(/\s+/).filter(Boolean)
  return cells.length >= 2 && cells.every((cell) => /^[-−–]?\d+(?:[./]\d+)?$/.test(cell))
}

/** Blocks of ≥2 consecutive lines that look like matrix rows, or LaTeX matrices. */
function matrixRisks(text: string): ProofreadRisk[] {
  const risks: ProofreadRisk[] = []
  for (const match of text.matchAll(/\\begin\{[bpvBV]?matrix\}[\s\S]*?\\end\{[bpvBV]?matrix\}/g)) {
    risks.push({
      kind: 'matrix',
      start: match.index!,
      end: match.index! + match[0].length,
      text: match[0],
    })
  }
  const all = lines(text)
  let run: Array<{ text: string; start: number }> = []
  const flush = () => {
    if (run.length >= 2) {
      const first = run[0]!
      const last = run[run.length - 1]!
      const end = last.start + last.text.length
      risks.push({ kind: 'matrix', start: first.start, end, text: text.slice(first.start, end) })
    }
    run = []
  }
  for (const line of all) {
    if (isNumericRow(line.text)) run.push(line)
    else flush()
  }
  flush()
  return risks
}

/** Two or more short lines in a row (a stacked fraction read as separate lines). */
function fractionRisks(text: string): ProofreadRisk[] {
  const risks: ProofreadRisk[] = []
  const all = lines(text)
  let run: Array<{ text: string; start: number }> = []
  const flush = () => {
    if (run.length >= 2) {
      const first = run[0]!
      const last = run[run.length - 1]!
      const end = last.start + last.text.length
      risks.push({ kind: 'fraction', start: first.start, end, text: text.slice(first.start, end) })
    }
    run = []
  }
  for (const line of all) {
    const trimmed = line.text.trim()
    if (trimmed && trimmed.length <= 4 && /^[\w+\-−()√π]+$/.test(trimmed) && !isNumericRow(trimmed))
      run.push(line)
    else flush()
  }
  flush()
  return risks
}

/** Pipe tables, tab-separated or space-aligned columns. */
function tableRisks(text: string): ProofreadRisk[] {
  const risks: ProofreadRisk[] = []
  for (const line of lines(text)) {
    const pipes = (line.text.match(/\|/g) ?? []).length
    const gaps = (line.text.match(/\t| {3,}/g) ?? []).length
    if ((pipes >= 2 || gaps >= 2) && !isNumericRow(line.text))
      risks.push({
        kind: 'table',
        start: line.start,
        end: line.start + line.text.length,
        text: line.text,
      })
  }
  return risks
}

function normalizeNumber(value: string): string {
  return value.replace(',', '.')
}

/** Every risky spot in a recognised question, in text order (overlaps kept). */
export function findProofreadRisks(text: string, sourceText?: string): ProofreadRisk[] {
  const risks: ProofreadRisk[] = []
  const push = (kind: ProofreadRiskKind, start: number, end: number) =>
    risks.push({ kind, start, end, text: text.slice(start, end) })

  for (const match of text.matchAll(MINUS_RISK_RE)) {
    const offset = match[0].search(DASH_RE)
    if (offset < 0) continue
    const at = match.index! + offset
    push('minus_sign', at, at + 1)
  }
  for (const re of [UNIT_POWER_RE, SCI_POWER_RE, VAR_POWER_RE]) {
    for (const match of text.matchAll(re)) {
      // Already written as LaTeX (`10^{-1}`) or inside a command: fine.
      if (/[\^_]/.test(match[0])) continue
      push('flattened_power', match.index!, match.index! + match[0].length)
    }
  }
  risks.push(...matrixRisks(text), ...fractionRisks(text), ...tableRisks(text))

  for (const match of text.matchAll(MIDLINE_SUBPART_RE)) {
    const at = match.index! + match[0].indexOf(match[0].includes('（') ? '（' : '(')
    push('subpart', at, at + 3)
  }
  // Sub-part letters that skip one ((a), (c)) — a boundary was probably lost.
  const letters = [...text.matchAll(/(?:^|[\s：:；;。])[(（]([a-z])[)）]/g)]
  for (let i = 1; i < letters.length; i++) {
    const prev = letters[i - 1]![1]!.charCodeAt(0)
    const cur = letters[i]![1]!.charCodeAt(0)
    if (cur - prev > 1 && cur - prev < 4) {
      const at = text.indexOf(letters[i]![0].trim(), letters[i]!.index!)
      push('subpart', at, at + 3)
    }
  }

  if (sourceText && sourceText.trim()) {
    const source = new Set(
      [...sourceText.replace(DASH_RE, '-').matchAll(NUMBER_RE)].map((m) => normalizeNumber(m[0])),
    )
    for (const match of text.matchAll(NUMBER_RE)) {
      if (!source.has(normalizeNumber(match[0])))
        push('number_mismatch', match.index!, match.index! + match[0].length)
    }
  }
  return risks.sort((a, b) => a.start - b.start || a.end - b.end)
}

/**
 * 建议对照原图校对: the text contains something recognition cannot reliably
 * restore (a matrix, a table, a stacked fraction), or the extractor flagged
 * the passage as low-confidence.
 */
export function suggestImageCompare(
  risks: readonly ProofreadRisk[],
  sourceLowConfidence = false,
): boolean {
  return (
    sourceLowConfidence ||
    risks.some(
      (risk) => risk.kind === 'matrix' || risk.kind === 'table' || risk.kind === 'fraction',
    )
  )
}

/**
 * Whether a source chunk carries an extractor low-confidence flag. Read
 * loosely, so flags the extractor adds later (`lowConfidence`, a numeric
 * `confidence`, `uncertainRegions`) are honoured without a type dependency.
 */
export function chunkLowConfidence(chunk: unknown): boolean {
  if (!chunk || typeof chunk !== 'object') return false
  const row = chunk as {
    lowConfidence?: unknown
    confidence?: unknown
    uncertainRegions?: unknown
  }
  return (
    row.lowConfidence === true ||
    (typeof row.confidence === 'number' && row.confidence < 0.6) ||
    (Array.isArray(row.uncertainRegions) && row.uncertainRegions.length > 0)
  )
}

const count = (text: string, re: RegExp): number => (text.match(re) ?? []).length

/** What a correction changed, for the parsing-accuracy report. */
export function classifyEdit(
  field: 'prompt' | 'number' | 'answerText',
  before: string,
  after: string,
): ParseErrorKind[] {
  if (before === after) return []
  if (field === 'number') return ['label']
  const kinds = new Set<ParseErrorKind>()
  const minus = /[-−]/g
  if (
    count(before, DASH_RE) !== count(after, DASH_RE) ||
    count(before, minus) !== count(after, minus)
  )
    kinds.add('minus_sign')
  if (count(before, /\^|[²³⁴⁵⁶⁷⁸⁹⁰¹⁻]/g) !== count(after, /\^|[²³⁴⁵⁶⁷⁸⁹⁰¹⁻]/g))
    kinds.add('exponent')
  if (count(before, /_|[₀₁₂₃₄₅₆₇₈₉]/g) !== count(after, /_|[₀₁₂₃₄₅₆₇₈₉]/g)) kinds.add('subscript')
  if (count(before, /\\[dt]?frac|\//g) !== count(after, /\\[dt]?frac|\//g)) kinds.add('fraction')
  if (count(before, /matrix|\\\\|&/g) !== count(after, /matrix|\\\\|&/g)) kinds.add('matrix')
  const labels = (text: string) =>
    walkthroughSubparts(text)
      .map((part) => part.label)
      .join('')
  if (labels(before) !== labels(after)) kinds.add('subpart_boundary')
  if (kinds.size === 0) kinds.add('other')
  return [...kinds]
}

/** Share of word / number tokens two texts have in common (0–1). */
export function textSimilarity(a: string, b: string): number {
  const tokens = (text: string) =>
    text
      .toLowerCase()
      .normalize('NFKC')
      .match(/[\p{L}\p{N}]+/gu) ?? []
  const left = tokens(a)
  const right = tokens(b)
  if (left.length === 0 && right.length === 0) return 1
  const pool = new Map<string, number>()
  for (const token of right) pool.set(token, (pool.get(token) ?? 0) + 1)
  let common = 0
  for (const token of left) {
    const n = pool.get(token) ?? 0
    if (n > 0) {
      common += 1
      pool.set(token, n - 1)
    }
  }
  return (2 * common) / (left.length + right.length)
}

/** Below this similarity a question edit is "material" (the answer link must be reconfirmed). */
export const MATERIAL_CHANGE_SIMILARITY = 0.85

/** `2(a)`, `Problem 2`, `第2题`, `Q2` → `2`, for comparing printed numbers. */
export function normalizeQuestionNumber(value: string | undefined): string {
  const text = (value ?? '').normalize('NFKC').toLowerCase()
  const digits = text.match(/\d+/g)
  const letters = text.match(/[(（]?([a-z])[)）]/)
  return [digits?.join('.') ?? text.trim(), letters?.[1] ?? ''].filter(Boolean).join('')
}

// ---------------------------------------------------------------------------
// Sub-part boundaries
// ---------------------------------------------------------------------------

const MARKER_RE = /(?:^|[\s：:；;。])([(（])([a-z])([)）])/gi

interface Marker {
  /** Offset of the opening bracket. */
  at: number
  letter: string
  open: string
  close: string
}

/** The sub-part markers walkthroughSubparts would use: a run from `(a)`. */
function keptMarkers(prompt: string): Marker[] {
  const kept: Marker[] = []
  for (const match of prompt.matchAll(MARKER_RE)) {
    const letter = match[2]!.toLowerCase()
    if (letter !== String.fromCharCode(97 + kept.length)) continue
    kept.push({
      at: match.index! + match[0].indexOf(match[1]!),
      letter,
      open: match[1]!,
      close: match[3]!,
    })
  }
  return kept
}

/** Rewrite the letters of the given markers to run a, b, c … from `firstIndex`. */
function relabel(prompt: string, markers: Marker[], firstIndex: number): string {
  let out = prompt
  // Right to left, so earlier offsets stay valid.
  for (let i = markers.length - 1; i >= 0; i--) {
    const marker = markers[i]!
    const letter = String.fromCharCode(97 + firstIndex + i)
    out = out.slice(0, marker.at + 1) + letter + out.slice(marker.at + 2)
  }
  return out
}

/** The sub-part labels of a question as the walkthrough reads them. */
export function subpartLabels(prompt: string): string[] {
  return walkthroughSubparts(prompt).map((part) => part.label)
}

/**
 * Merge sub-part `label` into the one before it (or into the stem for `a`):
 * its marker is removed and the later sub-parts are relabelled.
 */
export function mergeSubpart(prompt: string, label: string): string {
  const markers = keptMarkers(prompt)
  const index = markers.findIndex((marker) => marker.letter === label)
  if (index < 0) return prompt
  const marker = markers[index]!
  const after = markers.slice(index + 1)
  let out = relabel(prompt, after, index)
  // Remove `(b)` and the line break / spaces before it.
  const head = out.slice(0, marker.at).replace(/\s+$/, '')
  const tail = out.slice(marker.at + 3).replace(/^\s+/, '')
  out = `${head} ${tail}`
  return out
}

/**
 * Start a new sub-part at `offset`: a marker is inserted on its own line with
 * the next letter, and the later sub-parts are relabelled.
 */
export function insertSubpartBoundary(prompt: string, offset: number): string {
  const at = Math.max(0, Math.min(prompt.length, offset))
  const markers = keptMarkers(prompt)
  const before = markers.filter((marker) => marker.at < at)
  const after = markers.filter((marker) => marker.at >= at)
  const shifted = relabel(prompt, after, before.length + 1)
  const letter = String.fromCharCode(97 + before.length)
  const head = shifted.slice(0, at).replace(/\s+$/, '')
  const tail = shifted.slice(at).replace(/^\s+/, '')
  const open = before[0]?.open ?? after[0]?.open ?? '('
  const close = before[0]?.close ?? after[0]?.close ?? ')'
  return `${head}\n\n${open}${letter}${close} ${tail}`
}

// ---------------------------------------------------------------------------
// 需重新确认
// ---------------------------------------------------------------------------

/** Something made from the text before the last proofreading edit. */
export type ReconfirmKind =
  'answer_link' | 'hints' | 'walkthrough' | 'compare' | 'review' | 'check' | 'guided' | 'practice'

/**
 * The student's corrected professor answer, when the incoming answer text is
 * the original they corrected (so re-confirming the link keeps the fix).
 */
export function proofreadAnswerText(
  question: Pick<HomeworkQuestion, 'edits' | 'answerText'>,
  incoming: string,
): string | undefined {
  const first = (question.edits ?? []).find((edit) => edit.field === 'answerText')
  if (!first || question.answerText === undefined) return undefined
  return first.before.trim() === incoming.trim() ? question.answerText : undefined
}

/** True once the question text was corrected in 导入校对. */
export function hasPromptCorrection(question: Pick<HomeworkQuestion, 'edits'>): boolean {
  return (question.edits ?? []).some((edit) => edit.field === 'prompt')
}

/** When the question (or its answer) was last corrected; 0 when never. */
export function lastEditAt(question: Pick<HomeworkQuestion, 'edits'>): number {
  return (question.edits ?? []).reduce((latest, edit) => Math.max(latest, edit.at), 0)
}

/**
 * What was derived from the text before the last edit and must be confirmed
 * or regenerated. Nothing is listed for a question that was never edited.
 */
export function reconfirmItems(
  question: HomeworkQuestion,
  context: {
    /** The question's walkthrough section, if any. */
    section?: WalkthroughSection
    /** Creation times of practice sets made from this question (or its assignment). */
    practiceSetsCreatedAt?: readonly number[]
  } = {},
): ReconfirmKind[] {
  const since = lastEditAt(question)
  if (since === 0) return []
  const items: ReconfirmKind[] = []
  if (question.answerLinkStale) items.push('answer_link')
  if ((question.hints.length > 0 || question.solution) && (question.contentAt ?? 0) < since)
    items.push('hints')
  const section = context.section
  if (section && section.status === 'ready' && section.generatedAt < since) {
    items.push('walkthrough')
    if (section.guided) items.push('guided')
  }
  if (section?.professorCompare && section.professorCompare.comparedAt < since)
    items.push('compare')
  if (question.reviewGuide && question.reviewGuide.createdAt < since) items.push('review')
  if (question.answerCheck && question.answerCheck.createdAt < since) items.push('check')
  if ((context.practiceSetsCreatedAt ?? []).some((at) => at < since)) items.push('practice')
  return items
}
