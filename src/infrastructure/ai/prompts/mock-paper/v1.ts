/**
 * AI 模拟卷: write one question of a mock paper in the style of the
 * professor's past paper, and review the written questions in batches.
 *
 * `buildSystemPrompt` / `buildUserPrompt` — ONE question for one position
 * (slot) of the paper: its type, sub-parts and marks are the past paper's;
 * its topic, difficulty and language are given. Answers that can be
 * recomputed come with a `check` (as in practice-generate) and the app drops
 * a question whose stated answer disagrees.
 *
 * `buildReviewSystemPrompt` / `buildReviewUserPrompt` — judge only (pass /
 * fail + a reason per question), like practice-review; the reply is read with
 * practice-review's `normalizeReview`.
 *
 * Not cached; no version folding.
 */
import { asArray, asNumber, asRecord, asTrimmedString } from '../../validation'
import { securityFooter, untrustedContentWrapper } from '../security'
import { NOTATION_RULES } from '../homework-walkthrough/v1'
import { professorStyleSection } from '../question-style/v1'
import { examLanguageInstruction, examLanguageOf } from '../exam-language/v1'

export const VERSION = 'v1' as const

export type MockPromptDifficulty = 'foundation' | 'medium' | 'exam' | 'above'
export type MockPromptLanguage = 'zh' | 'zh_terms' | 'en' | `exam:${string}`
export type MockPromptConvention =
  'none_of_above' | 'marks_per_part' | 'data_sheet' | 'context_story' | 'sig_figs'

const DIFFICULTY_LINES: Record<MockPromptDifficulty, string> = {
  foundation:
    'foundation — one or two steps, standard situations, checks that the basics of the topic are in place (easier than the past paper).',
  medium:
    'medium — a few steps, a less obvious set-up than a textbook drill, still easier than the hardest past-paper questions.',
  exam: 'exam — at the level of the past paper question at this position.',
  above:
    'above — slightly harder than the past paper: one more step or two ideas combined, still within the syllabus and solvable in the time.',
}

export function buildSystemPrompt(options: { sigFigs?: boolean } = {}): string {
  return [
    "You write ONE question of an AI mock exam paper for a university course. The paper imitates the professor's past paper in structure and style; it does not predict the real exam.",
    'Return strictly valid JSON: {"stem":"...","parts":[{"label":"a","prompt":"...","marks":3,"answer":"...","solution":"...","scheme":["M1 ...","A1 ..."],"check":null}],"options":[],"correct":""}',
    'Follow the SLOT exactly: the question type, the sub-part labels (same letters, same order; one part without "label" when there are none) and the marks of each sub-part (the "marks" you return must equal them).',
    'The question tests the given COURSE TOPIC at the requested DIFFICULTY:',
    ...Object.values(DIFFICULTY_LINES).map((line) => `  ${line}`),
    'The TEMPLATE is the past paper question at this position: a reference for its style, length and kind of task only. Never copy its numbers, data, wording or context.',
    'Multiple choice (type multiple_choice): no sub-parts; "options" = the option texts in order without letters (as many as the slot says); "correct" = the letter of the right option (A = first). Distractors are real confusions of the topic, similar in length and form; the right option is not the longest. Other types: "options": [] and "correct": "".',
    '"stem": the shared statement ("" when there are no sub-parts). "prompt": the sub-part task (the whole question when there are no sub-parts). Self-contained, unambiguous, solvable in exam conditions with the data given.',
    '"answer": the short final answer only. "solution": a concise worked solution in Markdown. "scheme": how the marks are earned, one line per mark allocation (e.g. "M1 correct use of v = u + at", "A1 4.2 m/s"); the lines add up to the part\'s marks.',
    '"check" lets the app recompute the answer. Use exactly one of:',
    '  {"type":"linear_system","augmented":[["1","2","3"],["0","1","-1/2"]],"solution":"none|unique|infinite"} for a linear system;',
    '  {"type":"numeric","expression":"(12.5*3)/2","unit":"m/s"} when the answer is one number: a plain arithmetic expression (numbers, + - * / ^, sqrt, sin, cos, exp, log, pi, e; no variables) that evaluates to it, and the unit in the answer ("" when none);',
    ...(options.sigFigs
      ? [
          '  For an answer computed from measured data, add "sigFigs": the number of significant figures it must have; write "answer" with exactly that many significant figures.',
        ]
      : []),
    '  {"type":"chem_equation","equation":"2H2 + O2 -> 2H2O"} when the answer is a balanced chemical equation;',
    '  {"type":"vector","components":[3,-4],"unit":"N"} when the answer is a vector ("answer" gives its components or magnitude and direction);',
    '  {"type":"nomenclature","direction":"name_to_formula|formula_to_name","formula":"Fe2(SO4)3","names":["iron(III) sulfate"]} when the answer is a formula or a name (the answer never appears in the question);',
    '  null otherwise (multiple choice, proofs, explanations, symbolic results).',
    'The "answer" must agree with the "check" (it is recomputed; a disagreeing question is discarded).',
    ...NOTATION_RULES,
    'No prose outside JSON and no Markdown fence around the JSON.',
    securityFooter(),
  ].join('\n')
}

const CONVENTION_LINES: Record<Exclude<MockPromptConvention, 'none_of_above'>, string> = {
  marks_per_part:
    'Like this professor, give each sub-part its own marks (the slot already says how many).',
  data_sheet:
    "This professor's students have a data / formula sheet: do not restate standard constants or formulas it contains.",
  context_story:
    'Like this professor, set calculation questions in a short realistic context that may include a detail not needed for the answer; the data needed must still be complete.',
  sig_figs:
    'This professor grades significant figures strictly: state the required significant figures for every answer computed from measured data and give "sigFigs" in its check.',
}

export interface MockSlotPromptInput {
  /** `multiple_choice`, `calculation`, … (the past paper's question type). */
  type: string
  /** Sub-parts with their marks; [] when the question has none. */
  parts: Array<{ label: string; marks?: number }>
  /** Marks of the whole question, when stated. */
  marks?: number
  /** Multiple choice: number of options. */
  options?: number
}

export interface MockPaperInput {
  language: MockPromptLanguage
  difficulty: MockPromptDifficulty
  topic: { name: string; description?: string; concepts?: string[] }
  slot: MockSlotPromptInput
  /** The past paper question at this position (clipped; never a held-out question). */
  template?: string
  /** 教授出题习惯 block, when the profile is on and not empty. */
  professorHabits?: string
  professorConventions?: MockPromptConvention[]
  /** `none_of_above`: the professor's own wording of the last option. */
  noneOptionLabel?: string
  /** A previous version failed for this reason (local check or review). */
  rejected?: string
  /** Topics of the other questions of the paper (avoid repeating their tasks). */
  otherTopics?: string[]
}

function languageLine(language: MockPromptLanguage): string {
  const exam = examLanguageOf(language)
  if (exam)
    return `Write the question, options, answer, solution and scheme in ${examLanguageInstruction(exam)} (mathematical notation unchanged).`
  if (language === 'en') return 'Write everything in English.'
  if (language === 'zh_terms')
    return 'Write everything in Simplified Chinese; give each key technical term in English in brackets the first time it appears (mathematical notation unchanged).'
  return 'Write everything in Simplified Chinese (mathematical notation unchanged).'
}

function slotLine(slot: MockSlotPromptInput): string {
  const parts = slot.parts.length
    ? slot.parts
        .map((part) => `(${part.label})${part.marks !== undefined ? ` ${part.marks} marks` : ''}`)
        .join(', ')
    : 'none'
  return [
    `SLOT: type ${slot.type}`,
    `sub-parts: ${parts}`,
    slot.marks !== undefined ? `total marks: ${slot.marks}` : 'marks: not stated on the paper',
    slot.options ? `options: ${slot.options}` : '',
  ]
    .filter(Boolean)
    .join('; ')
}

export function buildUserPrompt(input: MockPaperInput): string {
  const conventions = input.professorConventions ?? []
  const lines: string[] = []
  if (conventions.includes('none_of_above') && input.slot.type === 'multiple_choice') {
    lines.push(
      `- The LAST option is the professor's "none" option${input.noneOptionLabel ? `, worded exactly "${input.noneOptionLabel}"` : ' ("None of the options are correct")'}; in about one question in five it is the correct answer.`,
    )
  }
  for (const convention of conventions) {
    if (convention !== 'none_of_above') lines.push(`- ${CONVENTION_LINES[convention]}`)
  }
  const topic = [
    input.topic.name,
    input.topic.description ? `Description: ${input.topic.description}` : '',
    input.topic.concepts?.length ? `Key concepts: ${input.topic.concepts.join('; ')}` : '',
  ]
    .filter(Boolean)
    .join('\n')
  return [
    languageLine(input.language),
    input.professorHabits ? professorStyleSection(input.professorHabits) : '',
    lines.length ? ['PROFESSOR CONVENTIONS:', ...lines].join('\n') : '',
    untrustedContentWrapper('COURSE TOPIC', topic),
    `DIFFICULTY: ${DIFFICULTY_LINES[input.difficulty]}`,
    slotLine(input.slot),
    input.template ? untrustedContentWrapper('TEMPLATE (past paper question)', input.template) : '',
    input.otherTopics?.length
      ? `Other questions of this paper cover: ${input.otherTopics.join('; ')}. Do not repeat their tasks.`
      : '',
    input.rejected
      ? `Rejected before: ${input.rejected}. Write a different question that avoids it.`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

// --- Reading the reply ---------------------------------------------------------------

export interface GeneratedMockPart {
  label?: string
  prompt: string
  marks?: number
  answer: string
  solution: string
  scheme: string[]
  check: Record<string, unknown> | null
}

export interface GeneratedMockQuestion {
  stem: string
  parts: GeneratedMockPart[]
  options: string[]
  correct: string
}

/** The reply, or null when it has no usable part. */
export function normalizeQuestion(raw: unknown): GeneratedMockQuestion | null {
  const row = asRecord(raw)
  if (!row) return null
  const parts: GeneratedMockPart[] = []
  for (const item of asArray(row.parts)) {
    const part = asRecord(item)
    if (!part) continue
    const prompt = asTrimmedString(part.prompt)
    if (!prompt) continue
    const label = asTrimmedString(part.label)
      .replace(/[()（）]/g, '')
      .toLowerCase()
    const marks = asNumber(part.marks, 0)
    parts.push({
      ...(label ? { label } : {}),
      prompt,
      ...(marks > 0 ? { marks } : {}),
      answer: asTrimmedString(part.answer),
      solution: asTrimmedString(part.solution),
      scheme: asArray(part.scheme)
        .map((line) => asTrimmedString(line))
        .filter(Boolean)
        .slice(0, 20),
      check: asRecord(part.check),
    })
  }
  if (parts.length === 0) return null
  return {
    stem: asTrimmedString(row.stem),
    parts,
    options: asArray(row.options)
      .map((option) =>
        asTrimmedString(option)
          .replace(/^\(?[A-Fa-f][.)]\s+/, '')
          .trim(),
      )
      .filter(Boolean),
    correct: asTrimmedString(row.correct)
      .replace(/[^A-Za-z]/g, '')
      .toUpperCase(),
  }
}

// --- Review --------------------------------------------------------------------------

export function buildReviewSystemPrompt(): string {
  return [
    "You review the questions of an AI mock exam paper written in the style of a professor's past paper. You only judge; you never rewrite anything.",
    'Return strictly valid JSON: {"results":[{"id":"s1","pass":true,"reason":"..."}]} with exactly one entry per QUESTION id listed (copy the ids exactly).',
    'A question passes only when ALL hold:',
    '  1. On topic: it tests the stated course topic.',
    '  2. Structure: the stated type, sub-parts and marks per sub-part.',
    '  3. Clear: complete, unambiguous and solvable in exam conditions with the given data.',
    '  4. Difficulty: as requested, compared with the PAST PAPER (foundation < medium < exam level < above).',
    '  5. The answer and the marking scheme fit the question; the scheme lines add up to the marks; a multiple-choice question has exactly one right option.',
    'The given answers were computed or checked by the app; do not correct them. Judge whether the question belongs on this mock paper.',
    '"reason": one short sentence (why it fails, or "ok"). Write it in the language of the questions.',
    'No prose outside JSON and no Markdown fence around the JSON.',
    securityFooter(),
  ].join('\n')
}

export interface MockReviewQuestion {
  id: string
  type: string
  difficulty: MockPromptDifficulty
  topic: string
  /** Sub-parts and marks, as text. */
  structure: string
  /** The question as printed (clipped). */
  text: string
  answers: string
  scheme: string
}

export function buildReviewUserPrompt(input: {
  /** Past paper questions (clipped; never held-out ones). */
  pastPaper: string
  questions: MockReviewQuestion[]
}): string {
  return [
    input.pastPaper ? untrustedContentWrapper('PAST PAPER', input.pastPaper) : '',
    untrustedContentWrapper(
      'QUESTIONS',
      input.questions
        .map((question) =>
          [
            `[${question.id}] type: ${question.type}; difficulty: ${question.difficulty}; topic: ${question.topic}; structure: ${question.structure}`,
            question.text,
            `Answer: ${question.answers}`,
            `Scheme: ${question.scheme}`,
          ].join('\n'),
        )
        .join('\n\n'),
    ),
  ]
    .filter(Boolean)
    .join('\n\n')
}
