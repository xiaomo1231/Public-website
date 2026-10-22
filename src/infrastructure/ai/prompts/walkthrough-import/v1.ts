/**
 * Import a walkthrough the student already has (a PDF / Word file / photo /
 * Markdown write-up) into one assignment's 完整讲解.
 *
 * The model only re-typesets the author's text into the platform's Markdown +
 * LaTeX and splits it by the assignment's own question ids (a closed set). It
 * never rewrites the author's calculations: suspected mistakes are reported in
 * `issues` and shown as notes, the body keeps what the author wrote. With
 * `checkIssues: false` (只排版，不核对) the issue-finding part is left out.
 */
import { securityFooter, untrustedContentWrapper } from '../security'
import {
  languageRule,
  NOTATION_RULES,
  type RawLinearSystem,
  type WalkthroughPromptLanguage,
} from '../homework-walkthrough/v1'

export const VERSION = 'v1' as const

export interface ImportQuestionRef {
  /** The assignment's question id — the only ids the reply may use. */
  id: string
  /** `1`, `2(a)`, `Problem 3`. */
  label: string
  /** The question text (may be clipped). */
  prompt: string
}

export interface ImportSystemOptions {
  /** Report suspected mistakes (`issues`). Off for 只排版，不核对. */
  checkIssues: boolean
  /** Return the row reductions so they can be re-checked locally. */
  linearSystems: boolean
}

export function buildSystemPrompt(options: ImportSystemOptions): string {
  const questionShape = [
    '"questionId":"<one id from the QUESTION LIST>"',
    '"conclusion":"..."',
    '"analysis":"..."',
    '"body":"..."',
    options.checkIssues ? '"issues":[{"quote":"...","note":"..."}]' : '',
    options.linearSystems
      ? '"linearSystems":[{"label":"(a)","augmented":[["1","2","3"]],"rref":[["1","0","-19/5"]],"solution":"none|unique|infinite"}]'
      : '',
  ]
    .filter(Boolean)
    .join(',')
  return [
    'You are importing an EXISTING walkthrough of a university homework assignment, written by someone else, into a study app. You are a typesetter, not an author.',
    'Return strictly valid JSON:',
    `{"overview":"...","questions":[{${questionShape}}],"summary":"...","suggestions":["..."],"other":"..."}`,
    'Split the walkthrough by question. "questionId" MUST be copied exactly from the QUESTION LIST; never invent an id, never use a label as the id. Match by the numbering and content the walkthrough itself shows. A question the walkthrough does not cover is simply left out.',
    '"body": the author’s own explanation of that question, re-typeset as Markdown: keep every step, every intermediate matrix or expression, every number and every sentence of reasoning, in the author’s order and wording (only fix line breaks, spacing and extraction noise). Do not add steps, explanations or checks of your own, do not shorten, do not summarise. Use "### (a) …" sub-headings for parts; no # or ## headings.',
    'Mathematics: convert the extracted maths (Unicode symbols, broken LaTeX, R2 → R2 − 2R1, x1, ½) into LaTeX — inline $...$, display $$...$$ on lines of their own — WITHOUT changing any value, sign, coefficient or result. Never "correct" the author’s arithmetic, even when you think it is wrong.',
    ...NOTATION_RULES,
    '"conclusion": the final answer of each part in one or two short lines, taken from the author’s results (write it from the body when the author gave none).',
    '"analysis": a short 题目分析 — what is asked, what is given, the knowledge used and the form of the answer. Keep it brief; it may be written by you.',
    options.checkIssues
      ? '"issues": places where the author may have made a mistake (an arithmetic slip, a wrong sign, a conclusion that does not follow). "quote" copies the passage exactly as it appears in the walkthrough (short, at most one line); "note" says in one or two sentences what may be wrong and what to check or what the value should probably be. Report only what you can justify; use an empty array when nothing looks wrong. Reporting is the ONLY way to point out a mistake: the body keeps the author’s version.'
      : 'Do not check the work for mistakes; only typeset it.',
    options.linearSystems
      ? '"linearSystems": for every linear system the author row-reduces, the full augmented matrix the author starts from and the final RREF the author reached, as arrays of rows of strings (integers or fractions such as "-19/5"), and whether the author concludes no, a unique or infinitely many solutions. Copy the author’s matrices, do not compute your own. Use an empty array when there is none.'
      : '',
    '"overview": the author’s opening section (tools / methods needed for the whole assignment), re-typeset, or "" when there is none. "summary" and "suggestions": the author’s closing summary and review advice, re-typeset, or "" / [] when there is none.',
    '"other": any remaining content of the walkthrough that belongs to no listed question and is not the opening or the summary (for example a question that is not in the QUESTION LIST), re-typeset, or "".',
    'Drop running headers, footers, page numbers and the document title.',
    'No prose outside JSON and no Markdown fence around the JSON.',
    securityFooter(),
  ]
    .filter(Boolean)
    .join('\n')
}

export interface ImportUserInput {
  language: WalkthroughPromptLanguage
  questions: ImportQuestionRef[]
  /** The walkthrough text (or one part of it). */
  sourceText: string
  /** Set when a long walkthrough is sent in parts. */
  part?: { index: number; total: number }
  /**
   * The text is a piece of a part that was too long for one reply. Absent:
   * the prompt is exactly as before.
   */
  fragment?: boolean
}

export function buildUserPrompt(input: ImportUserInput): string {
  const list = input.questions
    .map((question) => `- id: ${question.id} | label: ${question.label} | ${question.prompt}`)
    .join('\n')
  return [
    `${languageRule(input.language)} Keep the author’s language in "body" when it differs; only "conclusion" and "analysis" follow this rule.`,
    untrustedContentWrapper('QUESTION LIST', list),
    input.part && input.part.total > 1
      ? `The walkthrough is long and is sent in ${input.part.total} parts. This is part ${input.part.index + 1} of ${input.part.total}: import only what this part contains (a question may continue from the previous part or into the next one; import the portion shown here). Leave "overview" empty unless this part contains the opening, and "summary" empty unless it contains the closing.`
      : '',
    input.fragment
      ? 'This text is only a fragment of the walkthrough (the whole was too long for one reply): import only what this fragment contains — a question may begin before it or continue after it; import the portion shown here. Leave "overview" empty unless the fragment contains the opening, and "summary" empty unless it contains the closing.'
      : '',
    untrustedContentWrapper('WALKTHROUGH TO IMPORT', input.sourceText),
    'Return JSON only.',
  ]
    .filter(Boolean)
    .join('\n')
}

// --- Reading the reply ------------------------------------------------------

export interface ImportedQuestion {
  questionId: string
  conclusion: string
  body: string
  analysis?: string
  issues: Array<{ quote: string; note: string }>
  linearSystems: RawLinearSystem[]
}

export interface NormalizedImport {
  questions: ImportedQuestion[]
  overview: string
  summary: string
  suggestions: string[]
  other: string
  /** Question ids the model used that are not in the list (their content is dropped). */
  unknownIds: string[]
}

const MAX_FIELD = 40_000

function text(value: unknown, max = MAX_FIELD): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function readLinearSystems(value: unknown): RawLinearSystem[] {
  if (!Array.isArray(value)) return []
  const systems: RawLinearSystem[] = []
  for (const item of value.slice(0, 12)) {
    if (!item || typeof item !== 'object') continue
    const system = item as Record<string, unknown>
    const solution = system.solution
    systems.push({
      label: text(system.label, 40) || `#${systems.length + 1}`,
      augmented: system.augmented,
      rref: system.rref,
      ...(solution === 'none' || solution === 'unique' || solution === 'infinite'
        ? { solution }
        : {}),
    })
  }
  return systems
}

function readIssues(value: unknown): Array<{ quote: string; note: string }> {
  if (!Array.isArray(value)) return []
  const issues: Array<{ quote: string; note: string }> = []
  for (const item of value.slice(0, 20)) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const quote = text(row.quote, 400)
    const note = text(row.note, 1_000)
    if (quote && note) issues.push({ quote, note })
  }
  return issues
}

/**
 * Parse the reply. Questions must use an id from `allowedIds` (anything else
 * is reported in `unknownIds` and dropped — never matched by guesswork); a
 * question without a body is dropped. `null` when the reply is unusable.
 */
export function normalizeImport(
  raw: unknown,
  allowedIds: ReadonlySet<string>,
  options: { checkIssues: boolean },
): NormalizedImport | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const row = raw as Record<string, unknown>
  const questions: ImportedQuestion[] = []
  const unknownIds: string[] = []
  for (const item of Array.isArray(row.questions) ? row.questions.slice(0, 200) : []) {
    if (!item || typeof item !== 'object') continue
    const entry = item as Record<string, unknown>
    const questionId = text(entry.questionId, 200)
    if (!allowedIds.has(questionId)) {
      if (questionId) unknownIds.push(questionId)
      continue
    }
    const body = text(entry.body)
    if (!body) continue
    const analysis = text(entry.analysis, 6_000)
    questions.push({
      questionId,
      conclusion: text(entry.conclusion, 2_000),
      body,
      ...(analysis ? { analysis } : {}),
      issues: options.checkIssues ? readIssues(entry.issues) : [],
      linearSystems: readLinearSystems(entry.linearSystems),
    })
  }
  const suggestions = Array.isArray(row.suggestions)
    ? row.suggestions
        .map((item) => text(item, 1_000))
        .filter(Boolean)
        .slice(0, 12)
    : []
  return {
    questions,
    overview: text(row.overview),
    summary: text(row.summary),
    suggestions,
    other: text(row.other),
    unknownIds,
  }
}
