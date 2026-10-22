/**
 * v3 of the homework walkthrough prompts.
 *
 * Adds, on top of v2:
 *  - an optional `analysis` field on question sections (题目分析: what is
 *    asked, what is given, each sub-part's task, the knowledge used and the
 *    form the answer takes), requested with `{ analysis: true }`;
 *  - a small stand-alone analysis request, used to add the analysis to a
 *    section written before v3 (and to split questions, whose sub-parts are
 *    written separately);
 *  - a compact opening / summary request (`{ keyPoints: true }`) that sees
 *    each question's conclusion and key points instead of the start of its
 *    worked section;
 *  - the rule that a display formula or a boxed answer takes no sentence
 *    punctuation after it (sent with the v3 options).
 *
 * Without those options every prompt is byte-identical to v2 (and so to v1),
 * and section hashes keep `CACHE_VERSION = 'v1'`: existing walkthroughs are not
 * marked out of date; new and regenerated sections simply carry the analysis.
 */
import { securityFooter, untrustedContentWrapper } from '../security'
import * as V1 from './v1'
import * as V2 from './v2'

export const VERSION = 'v3' as const
export { CACHE_VERSION } from './v2'

export type {
  NormalizedFrame,
  NormalizedPart,
  RawLinearSystem,
  SectionRevision,
  FrameRevision,
  WalkthroughFrameInput,
  WalkthroughFrameQuestion,
  WalkthroughPartEarlier,
  WalkthroughPartInput,
  WalkthroughPromptLanguage,
  WalkthroughQuestionInput,
  WalkthroughQuestionInputV2,
  WalkthroughFrameInputV2,
} from './v2'
export { buildQuestionUserPrompt, normalizeFrame, normalizePart } from './v2'

/** Boxed answers and display formulas end without a stray full stop. */
export const PUNCTUATION_RULE =
  'Never put sentence punctuation (".", ",", "。", "，") right after \\boxed{…} or at the end of a display formula $$…$$; end the sentence before the formula or continue in the next line instead.'

const ANALYSIS_RULE =
  '"analysis": a short Markdown analysis of the question shown before the worked solution, as a compact bullet list: what the question asks; the given data and notation; the task of each sub-part (one bullet each, when there are sub-parts); the knowledge and methods it uses; and the form the answer should take (e.g. "a parametric vector form", "yes / no with a reason"). Do not solve anything here and do not state results.'

const ANALYSIS_MAX = 6_000

/** Insert the analysis field into a v1 JSON shape line (`{"status":"ready","conclusion":…`). */
function withAnalysisShape(prompt: string): string {
  return prompt.replace(
    '{"status":"ready","conclusion":"...",',
    '{"status":"ready","analysis":"...","conclusion":"...",',
  )
}

/** Append rules just before the security footer (the last line). */
function beforeFooter(prompt: string, rules: string[]): string {
  const footer = securityFooter()
  const index = prompt.lastIndexOf(footer)
  if (index < 0) return [prompt, ...rules].join('\n')
  return `${prompt.slice(0, index)}${rules.join('\n')}\n${prompt.slice(index)}`
}

export function buildQuestionSystemPrompt(options: {
  linearSystems: boolean
  /** v3: also return the 题目分析 and follow the punctuation rule. */
  analysis?: boolean
}): string {
  const base = V2.buildQuestionSystemPrompt({ linearSystems: options.linearSystems })
  if (!options.analysis) return base
  return beforeFooter(withAnalysisShape(base), [ANALYSIS_RULE, PUNCTUATION_RULE])
}

export function buildPartSystemPrompt(options: {
  linearSystems: boolean
  /** v3: follow the punctuation rule (sub-parts carry no analysis of their own). */
  punctuation?: boolean
}): string {
  const base = V2.buildPartSystemPrompt({ linearSystems: options.linearSystems })
  return options.punctuation ? beforeFooter(base, [PUNCTUATION_RULE]) : base
}

/**
 * One sub-part. With `analysis` (the first sub-part of a question written
 * part by part) the reply also carries the 题目分析 of the whole question.
 */
export function buildPartUserPrompt(
  input: V2.WalkthroughPartInput & { analysis?: boolean },
): string {
  const { analysis, ...rest } = input
  const base = V2.buildPartUserPrompt(rest)
  if (!analysis) return base
  const tail = '\nReturn JSON only.'
  const block = [
    `Also add an "analysis" field to the same JSON object, covering the WHOLE question ${input.label} (every sub-part), not only (${input.part}).`,
    ANALYSIS_RULE,
  ].join('\n')
  return base.endsWith(tail)
    ? `${base.slice(0, -tail.length)}\n${block}${tail}`
    : `${base}\n${block}`
}

export function buildFrameSystemPrompt(options: { keyPoints?: boolean } = {}): string {
  const base = V2.buildFrameSystemPrompt()
  if (!options.keyPoints) return base
  return beforeFooter(
    base.replace(
      'you see each question with its conclusion and the start of its section.',
      'you see each question with its conclusion and the key points of its section.',
    ),
    [PUNCTUATION_RULE],
  )
}

export interface WalkthroughFrameKeyPointsQuestion {
  label: string
  question: string
  conclusion: string
  /** Headings and terms of the worked section, one per line. */
  keyPoints: string
}

/** The compact opening / summary request: conclusions and key points only. */
export function buildFrameKeyPointsUserPrompt(input: {
  title: string
  questions: WalkthroughFrameKeyPointsQuestion[]
  language: V1.WalkthroughPromptLanguage
  revision?: V2.FrameRevision
}): string {
  const { revision, questions, ...rest } = input
  // v2 with no questions leaves an empty line after the title; the key-point
  // blocks go there, so the revision block and the closing line stay v2's.
  const marker = `Assignment: ${input.title}\n\n`
  const blocks = questions.map(keyPointsBlock).join('\n\n')
  return V2.buildFrameUserPrompt({
    ...rest,
    questions: [],
    ...(revision ? { revision } : {}),
  }).replace(marker, () => `Assignment: ${input.title}\n${blocks}\n`)
}

function keyPointsBlock(question: WalkthroughFrameKeyPointsQuestion): string {
  return [
    `Question ${question.label}`,
    untrustedContentWrapper(`QUESTION ${question.label}`, question.question),
    untrustedContentWrapper(`CONCLUSION ${question.label}`, question.conclusion),
    question.keyPoints
      ? untrustedContentWrapper(`KEY POINTS ${question.label}`, question.keyPoints)
      : '',
  ]
    .filter(Boolean)
    .join('\n')
}

// --- 题目分析 on its own ------------------------------------------------------

export function buildAnalysisSystemPrompt(): string {
  return [
    'You are writing the short question analysis (题目分析) that opens one question of a document-style walkthrough of a university homework assignment. The worked solution is already written; this block only helps the reader understand the question before reading it.',
    'Return strictly valid JSON: {"status":"ready","analysis":"..."}',
    ANALYSIS_RULE,
    ...V1.NOTATION_RULES,
    PUNCTUATION_RULE,
    'Base everything on the question text; never invent a condition, figure detail or citation.',
    'No prose outside JSON and no Markdown fence around the JSON.',
    securityFooter(),
  ].join('\n')
}

export function buildAnalysisUserPrompt(input: {
  label: string
  question: string
  sourceText: string
  /** The section's conclusion, so the expected answer form matches the work. */
  conclusion?: string
  language: V1.WalkthroughPromptLanguage
}): string {
  return [
    V1.languageRule(input.language),
    `This analysis is for question ${input.label}.`,
    untrustedContentWrapper('HOMEWORK QUESTION', input.question),
    input.sourceText.trim() && input.sourceText.trim() !== input.question.trim()
      ? untrustedContentWrapper('QUESTION SOURCE PASSAGES', input.sourceText)
      : '',
    input.conclusion?.trim()
      ? untrustedContentWrapper('CONCLUSION OF THE WORKED SOLUTION', input.conclusion)
      : '',
    'Return JSON only.',
  ]
    .filter(Boolean)
    .join('\n')
}

/** The analysis text of a section or analysis reply; empty when absent. */
export function readAnalysis(raw: unknown): string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ''
  const value = (raw as Record<string, unknown>).analysis
  return typeof value === 'string' ? value.trim().slice(0, ANALYSIS_MAX) : ''
}

export interface NormalizedQuestionSectionV3 {
  status: 'ready'
  analysis: string
  conclusion: string
  body: string
  linearSystems: V1.RawLinearSystem[]
}

export function normalizeQuestionSection(
  raw: unknown,
): NormalizedQuestionSectionV3 | { status: 'insufficient'; reason: string } | null {
  const base = V1.normalizeQuestionSection(raw)
  if (!base || base.status === 'insufficient') return base
  return { ...base, analysis: readAnalysis(raw) }
}
