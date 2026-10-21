/**
 * The full walkthrough of a homework assignment, written like a study handout:
 * an opening on the tools the assignment needs, one worked section per
 * question, and a closing summary. Each question is a separate request; the
 * opening and the summary come from one more request that sees every
 * question's conclusion.
 */
import { securityFooter, untrustedContentWrapper } from '../security'

export const VERSION = 'v1' as const

export type WalkthroughPromptLanguage = 'zh_terms' | 'zh' | 'en'

function languageRule(language: WalkthroughPromptLanguage): string {
  if (language === 'en') return 'Write in English.'
  if (language === 'zh') return 'Write in Simplified Chinese.'
  return 'Write in Simplified Chinese. The first time a key technical term appears, add its English name in parentheses, e.g. 主元（pivot）、简化行阶梯形（RREF）. Keep mathematical notation unchanged.'
}

const NOTATION_RULES = [
  'Use LaTeX for all mathematics: inline $...$, display $$...$$ on lines of their own.',
  'Write an augmented matrix as \\left[\\begin{array}{ccc|c} ... \\end{array}\\right] with the bar before the last column.',
  'Write a row operation as $R_2 \\to R_2 - 2R_1$, a swap as $R_1 \\leftrightarrow R_2$.',
  'Never output Private Use Area characters or raw Unicode maths symbols as the canonical notation.',
]

// --- One question -----------------------------------------------------------

export interface WalkthroughQuestionInput {
  label: string
  question: string
  sourceText: string
  professorAnswer?: string
  previousSolution?: string
  language: WalkthroughPromptLanguage
}

export function buildQuestionSystemPrompt(options: { linearSystems: boolean }): string {
  return [
    'You are writing ONE section of a complete, document-style walkthrough of a university homework assignment. This section covers one question.',
    'Return strictly valid JSON:',
    options.linearSystems
      ? '{"status":"ready","conclusion":"...","body":"...","linearSystems":[{"label":"(a)","augmented":[["1","2","3"]],"rref":[["1","0","-19/5"]],"solution":"none|unique|infinite"}]}'
      : '{"status":"ready","conclusion":"...","body":"..."}',
    'or {"status":"insufficient","reason":"specific missing information"}.',
    '"conclusion": the final answer to every part in one or two short lines, e.g. "(a)(b) no solution; (c) infinitely many solutions".',
    '"body": Markdown. For each part, in order: what is given and what is asked, the method and why it fits, every step of the work, how to read the result, and a quick check (for example substituting back) when one is possible.',
    'Show each intermediate result the reader needs to follow the arithmetic — after every one or two operations, write the resulting matrix or expression. Never jump over several operations without showing where they lead.',
    'Keep the teaching voice short and concrete: say why a step is chosen ("row 4 is easier to scale, so swap it up") rather than repeating textbook definitions.',
    'Use "### (a) …" sub-headings for parts when the question has parts. Do not use # or ## headings; the page adds the section title.',
    ...NOTATION_RULES,
    options.linearSystems
      ? '"linearSystems": for every linear system you row-reduce, give the full augmented matrix you start from and the final RREF you reached, as arrays of rows of strings (integers or fractions such as "-19/5"), and whether it has no, a unique or infinitely many solutions. Use an empty array when the question has no row reduction. These are checked against your body, so they must match it exactly.'
      : '',
    'A confirmed professor answer is the reference for this question: follow its method and results, and never present your own added reasoning as the professor’s words.',
    'A previous AI solution is only a fallible aid. Check it; never copy an unsupported claim, and never invent a condition, figure detail or citation.',
    'If a necessary figure, symbol or value is unreadable and the result cannot be derived reliably from the text, return status insufficient with a concrete reason instead of a guessed walkthrough.',
    'Do not grade the student. No prose outside JSON and no Markdown fence around the JSON.',
    securityFooter(),
  ]
    .filter(Boolean)
    .join('\n')
}

export function buildQuestionUserPrompt(input: WalkthroughQuestionInput): string {
  return [
    languageRule(input.language),
    `This section is for question ${input.label}.`,
    untrustedContentWrapper('HOMEWORK QUESTION', input.question),
    input.sourceText.trim() && input.sourceText.trim() !== input.question.trim()
      ? untrustedContentWrapper('QUESTION SOURCE PASSAGES', input.sourceText)
      : '',
    input.professorAnswer?.trim()
      ? untrustedContentWrapper(
          'CONFIRMED PROFESSOR ANSWER FOR THIS QUESTION',
          input.professorAnswer,
        )
      : '',
    input.previousSolution?.trim()
      ? untrustedContentWrapper('PREVIOUS AI WORKED SOLUTION (UNVERIFIED)', input.previousSolution)
      : '',
    'Return JSON only.',
  ]
    .filter(Boolean)
    .join('\n')
}

export interface RawLinearSystem {
  label: string
  augmented: unknown
  rref: unknown
  solution?: 'none' | 'unique' | 'infinite'
}

export type NormalizedQuestionSection =
  | { status: 'ready'; conclusion: string; body: string; linearSystems: RawLinearSystem[] }
  | { status: 'insufficient'; reason: string }

const MAX_FIELD = 40_000

function text(value: unknown, max = MAX_FIELD): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

export function normalizeQuestionSection(raw: unknown): NormalizedQuestionSection | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const row = raw as Record<string, unknown>
  if (row.status === 'insufficient') {
    const reason = text(row.reason, 2_000)
    return reason ? { status: 'insufficient', reason } : null
  }
  if (row.status !== 'ready') return null
  const conclusion = text(row.conclusion, 2_000)
  const body = text(row.body)
  if (!conclusion || !body) return null
  const linearSystems: RawLinearSystem[] = []
  if (Array.isArray(row.linearSystems)) {
    for (const item of row.linearSystems.slice(0, 12)) {
      if (!item || typeof item !== 'object') continue
      const system = item as Record<string, unknown>
      const solution = system.solution
      linearSystems.push({
        label: text(system.label, 40) || `#${linearSystems.length + 1}`,
        augmented: system.augmented,
        rref: system.rref,
        ...(solution === 'none' || solution === 'unique' || solution === 'infinite'
          ? { solution }
          : {}),
      })
    }
  }
  return { status: 'ready', conclusion, body, linearSystems }
}

// --- Opening and summary ----------------------------------------------------

export interface WalkthroughFrameQuestion {
  label: string
  question: string
  conclusion: string
  /** The start of the worked section, so the tools named match the work. */
  excerpt: string
}

export interface WalkthroughFrameInput {
  title: string
  questions: WalkthroughFrameQuestion[]
  language: WalkthroughPromptLanguage
}

export function buildFrameSystemPrompt(): string {
  return [
    'You are writing the opening and the closing of a complete, document-style walkthrough of a university homework assignment. The worked sections for each question are already written; you see each question with its conclusion and the start of its section.',
    'Return strictly valid JSON: {"status":"ready","overview":"...","summary":"...","suggestions":["..."]}',
    '"overview": Markdown that teaches the tools the whole assignment relies on — the definitions, rules and the standard procedure, and how to read a result — so the reader can follow every section. Use short numbered lists and, when it helps, a table (for example "what the result looks like | conclusion"). Do not solve the questions here.',
    '"summary": Markdown that ties the assignment together: when the questions fall into kinds (by result or by method), a table with a column listing which questions of THIS assignment show each kind, using the labels exactly as given; then the two or three ideas most worth remembering.',
    '"suggestions": two to four concrete review actions, each naming a question by its label and saying why to redo it (e.g. "Close the answers and redo 2(a): the typical no-solution case").',
    'Use ### sub-headings inside a field when useful; never # or ##.',
    ...NOTATION_RULES,
    'Base everything on the questions and conclusions given; never invent a question, result or citation.',
    'No prose outside JSON and no Markdown fence around the JSON.',
    securityFooter(),
  ].join('\n')
}

export function buildFrameUserPrompt(input: WalkthroughFrameInput): string {
  const questions = input.questions
    .map((question) =>
      [
        `Question ${question.label}`,
        untrustedContentWrapper(`QUESTION ${question.label}`, question.question),
        untrustedContentWrapper(`CONCLUSION ${question.label}`, question.conclusion),
        question.excerpt
          ? untrustedContentWrapper(`SECTION START ${question.label}`, question.excerpt)
          : '',
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .join('\n\n')
  return [
    languageRule(input.language),
    `Assignment: ${input.title}`,
    questions,
    'Return JSON only.',
  ].join('\n')
}

export interface NormalizedFrame {
  overview: string
  summary: string
  suggestions: string[]
}

export function normalizeFrame(raw: unknown): NormalizedFrame | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const row = raw as Record<string, unknown>
  if (row.status !== undefined && row.status !== 'ready') return null
  const overview = text(row.overview)
  const summary = text(row.summary)
  const suggestions = Array.isArray(row.suggestions)
    ? row.suggestions
        .map((item) => text(item, 600))
        .filter(Boolean)
        .slice(0, 6)
    : []
  if (!overview || !summary) return null
  return { overview, summary, suggestions }
}
