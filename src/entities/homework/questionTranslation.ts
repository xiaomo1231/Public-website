import { fnv1a } from '@/shared/lib/hash'

/**
 * 中文翻译 of a homework question: a faithful sentence-by-sentence translation
 * of the original text (not a summary or an analysis), cached on the question
 * row and checked locally so that no formula, sub-part label or number is
 * lost or changed. Pure: no storage, no AI.
 */
export interface QuestionTranslation {
  language: 'zh'
  /** `translationSourceHash` of the question text it was made from. */
  sourceHash: string
  /** Prompt version it was written with. */
  promptVersion: string
  /** Markdown + LaTeX, rendered like the original. */
  text: string
  createdAt: number
}

export function translationSourceHash(prompt: string): string {
  return fnv1a(prompt.trim())
}

/** The cached translation, when it was made from the question's current text. */
export function currentTranslation(question: {
  prompt: string
  translation?: QuestionTranslation
}): QuestionTranslation | undefined {
  const cached = question.translation
  return cached && cached.sourceHash === translationSourceHash(question.prompt) ? cached : undefined
}

const CJK = /[㐀-鿿豈-﫿]/g
const LATIN = /[A-Za-z]/g

/**
 * The question is already mainly Chinese (no translation offered): more CJK
 * characters than Latin letters outside formulas.
 */
export function isMainlyChinese(prompt: string): boolean {
  const prose = stripFormulas(prompt)
  const cjk = prose.match(CJK)?.length ?? 0
  const latin = prose.match(LATIN)?.length ?? 0
  return cjk > 0 && cjk >= latin
}

/** `$$…$$`, `$…$`, `\[…\]` and `\(…\)` formulas, in order. */
export function formulasOf(text: string): string[] {
  return [...text.matchAll(/\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$[^$\n]+?\$/g)].map(
    (match) => match[0],
  )
}

function stripFormulas(text: string): string {
  return text.replace(/\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$[^$\n]+?\$/g, ' ')
}

/** Sub-part labels written in the prose: (a), (b), (l), (iv) — not f(x). */
export function subpartLabelsOf(text: string): string[] {
  const prose = stripFormulas(text.normalize('NFKC'))
  const labels: string[] = []
  for (const match of prose.matchAll(/(?<![A-Za-z0-9])\(([a-z]|[ivx]{1,4})\)/g)) {
    const label = `(${match[1]})`
    if (!labels.includes(label)) labels.push(label)
  }
  return labels
}

/** How often each number occurs (NFKC: x₁ reads as x1). */
function numberCounts(text: string): Map<string, number> {
  const counts = new Map<string, number>()
  for (const match of text.normalize('NFKC').matchAll(/\d+(?:\.\d+)?/g))
    counts.set(match[0], (counts.get(match[0]) ?? 0) + 1)
  return counts
}

const compact = (value: string): string => value.normalize('NFKC').replace(/\s+/g, '')

export interface TranslationCheck {
  ok: boolean
  /** Formulas of the original not found unchanged in the translation. */
  missingFormulas: string[]
  missingLabels: string[]
  missingNumbers: string[]
}

/**
 * Whether a translation keeps what must not change: every formula of the
 * original verbatim (spacing aside), every sub-part label, every number.
 */
export function checkTranslation(original: string, translation: string): TranslationCheck {
  const translated = compact(translation)
  const missingFormulas = formulasOf(original).filter(
    (formula) => !translated.includes(compact(formula)),
  )
  const translatedLabels = new Set(subpartLabelsOf(translation))
  const missingLabels = subpartLabelsOf(original).filter((label) => !translatedLabels.has(label))
  // Every number as often as in the original, wherever it sits (a prose
  // "x1 + 2x2 = 3" may come back as LaTeX; NFKC reads x₁ as x1).
  const have = numberCounts(translation)
  const missingNumbers = [...numberCounts(original)]
    .filter(([number, count]) => (have.get(number) ?? 0) < count)
    .map(([number]) => number)
  return {
    ok:
      translation.trim().length > 0 &&
      missingFormulas.length === 0 &&
      missingLabels.length === 0 &&
      missingNumbers.length === 0,
    missingFormulas,
    missingLabels,
    missingNumbers,
  }
}

/** One block of a question translated on its own; `separator` is the original whitespace after it. */
export interface TranslationBlock {
  text: string
  separator: string
}

/** A line that starts with a sub-part label: (a), （b）, **(c)**, (iv). */
const SUBPART_LINE = /^[ \t]*(?:\*\*)?[(（](?:[a-z]|[ivx]{1,4})[)）]/gm
const FORMULA_SPANS = /\$\$[\s\S]+?\$\$|\\[[\s\S]+?\\]|\\([\s\S]+?\\)|\$[^$\n]+?\$/g

/**
 * A long question split into its stem and one block per sub-part (lines that
 * start with a label, never inside a formula), so that each can be translated
 * on its own; joining the translations with each block's `separator` gives the
 * original layout. One block when the question has fewer than two sub-parts.
 */
export function splitTranslationBlocks(prompt: string): TranslationBlock[] {
  const formulas = [...prompt.matchAll(FORMULA_SPANS)].map((m) => [
    m.index!,
    m.index! + m[0].length,
  ])
  const starts = [...prompt.matchAll(SUBPART_LINE)]
    .map((m) => m.index!)
    .filter((at) => !formulas.some(([from, to]) => at > from! && at < to!))
  if (starts.length < 2) return [{ text: prompt.trim(), separator: '' }]
  const cuts = starts[0]! > 0 && prompt.slice(0, starts[0]).trim() ? [0, ...starts] : starts
  const blocks: TranslationBlock[] = []
  for (let i = 0; i < cuts.length; i++) {
    const segment = prompt.slice(cuts[i], cuts[i + 1] ?? prompt.length)
    const text = segment.trim()
    if (!text) continue
    blocks.push({ text, separator: i + 1 < cuts.length ? (/\s*$/.exec(segment)?.[0] ?? '\n') : '' })
  }
  return blocks
}

/** The block translations joined in the original layout. */
export function joinTranslationBlocks(
  blocks: readonly TranslationBlock[],
  texts: readonly string[],
): string {
  return blocks
    .map(
      (block, i) =>
        `${(texts[i] ?? '').trim()}${block.separator || (i + 1 < blocks.length ? '\n' : '')}`,
    )
    .join('')
    .trim()
}
