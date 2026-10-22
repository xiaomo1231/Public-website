/**
 * 教授出题习惯档案: summarise how ONE professor writes questions, from the
 * professor's own questions (homework, Professor Practice, past exams /
 * syllabi). Incremental: only new or changed documents are sent, together with
 * the current profile, and the model says which items to add, refine or
 * remove. Every item must quote the questions verbatim; the app checks each
 * quote against the text it sent and drops an item without a found quote.
 *
 * Also exports `professorStyleSection`, the block added to question-writing
 * prompts (`quiz-generator`, `practice-generate`, `oral-exam`) when the
 * profile is on and not empty. Without it those prompts are byte-identical.
 */
import { asArray, asRecord, asTrimmedString } from '../../validation'
import { securityFooter, untrustedContentWrapper } from '../security'

export const VERSION = 'v1' as const
export const PROMPT_KIND = 'question-style' as const

export type QuestionStyleLanguage = 'zh' | 'en'

export interface QuestionStyleUnit {
  /** Closed label (`U1`). */
  label: string
  kind: 'homework' | 'practice' | 'syllabus'
  documentName: string
  position?: string
  text: string
}

export interface QuestionStyleCurrentItem {
  /** Short id (`h1`). */
  id: string
  category: string
  statement: string
  /** Written by the student: never return or remove it. */
  locked: boolean
}

export interface QuestionStyleInput {
  language: QuestionStyleLanguage
  current: QuestionStyleCurrentItem[]
  units: QuestionStyleUnit[]
}

export function buildSystemPrompt(): string {
  return [
    "You analyse how ONE university professor writes homework and exam questions, using only the professor's own questions given below.",
    'Return strictly valid JSON: {"items":[{"id":null,"category":"structure","statement":"...","evidence":[{"unit":"U3","quote":"..."}]}],"remove":[]}',
    'Categories:',
    '  types — the mix of question types (computation, proof, explanation, multiple choice…);',
    '  structure — how a question is built: number of sub-parts, whether the parts build on each other or are independent;',
    '  wording — typical phrasing, instruction verbs and the language of the questions;',
    '  notation — symbols and conventions the questions use;',
    '  numbers — what the numbers look like: integers or fractions, sizes (e.g. "3×4 augmented matrices"), magnitudes, units;',
    '  traps — pitfalls the professor sets on purpose (special cases, sign conventions, inconsistent systems…);',
    '  answer_format — what the answer must contain or how it is to be written;',
    '  difficulty — level and progression within a question or an assignment.',
    'Each item states ONE habit in at most 160 characters, generalised over several questions where possible. State only what the questions show: never guess intentions, never predict exam content.',
    "Evidence: 1–3 quotes per item, each copied VERBATIM (exact characters, 5–200 characters) from ONE question unit, with that unit's label. An item without a verbatim quote is discarded.",
    'CURRENT PROFILE lists the existing items with short ids. For an existing item that the NEW QUESTIONS confirm or refine, return it with its id (a refined statement is allowed) and quotes from the new questions. Put an id in "remove" only when the new questions clearly contradict it. Existing items the new questions say nothing about are kept automatically: do not return them. Items marked [locked] were written by the student: never return or remove them, and do not add a duplicate of them. New habits use "id": null.',
    'At most 12 entries in "items". No prose outside JSON and no Markdown fence around the JSON.',
    securityFooter(),
  ].join('\n')
}

const KIND_LABEL: Record<QuestionStyleUnit['kind'], string> = {
  homework: 'homework',
  practice: 'professor practice',
  syllabus: 'exam / syllabus',
}

export function buildUserPrompt(input: QuestionStyleInput): string {
  const current =
    input.current.length > 0
      ? untrustedContentWrapper(
          'CURRENT PROFILE',
          input.current
            .map(
              (item) =>
                `${item.id}${item.locked ? ' [locked]' : ''} [${item.category}] ${item.statement}`,
            )
            .join('\n'),
        )
      : 'CURRENT PROFILE: empty.'
  const units = input.units
    .map(
      (unit) =>
        `[${unit.label}] (${KIND_LABEL[unit.kind]}: ${unit.documentName}${unit.position ? `, ${unit.position}` : ''})\n${unit.text}`,
    )
    .join('\n\n')
  return [
    input.language === 'zh'
      ? 'Write every statement in Simplified Chinese (keep symbols and quoted examples as they are). Quotes stay verbatim in the original language.'
      : 'Write every statement in English. Quotes stay verbatim in the original language.',
    current,
    untrustedContentWrapper('NEW QUESTIONS', units),
    'Respond with the JSON object only.',
  ].join('\n\n')
}

export interface QuestionStyleOutput {
  items: Array<{
    id: string | null
    category: string
    statement: string
    evidence: Array<{ unit: string; quote: string }>
  }>
  remove: string[]
}

export function normalizeOutput(raw: unknown): QuestionStyleOutput {
  const root = asRecord(raw)
  const items: QuestionStyleOutput['items'] = []
  for (const value of asArray(root?.items)) {
    const row = asRecord(value)
    if (!row) continue
    const id = asTrimmedString(row.id)
    items.push({
      id: id && id !== 'null' ? id : null,
      category: asTrimmedString(row.category).toLowerCase(),
      statement: asTrimmedString(row.statement),
      evidence: asArray(row.evidence).flatMap((each) => {
        const record = asRecord(each)
        if (!record) return []
        const quote = asTrimmedString(record.quote)
        return quote ? [{ unit: asTrimmedString(record.unit).replace(/[[\]]/g, ''), quote }] : []
      }),
    })
  }
  const remove = asArray(root?.remove)
    .map((each) => asTrimmedString(each))
    .filter(Boolean)
  return { items, remove }
}

/**
 * The block added to a question-writing prompt. `habits` is the compact list
 * from `buildHabitsBlock`; it is untrusted (derived from course documents).
 */
export function professorStyleSection(habits: string): string {
  return [
    "PROFESSOR QUESTION HABITS (observed in this professor's own homework / exam questions):",
    untrustedContentWrapper('PROFESSOR HABITS', habits),
    'Write NEW questions that follow these habits where they fit (structure, wording, notation, numbers, typical traps, answer format). Never copy an example question. The requested types, count, difficulty, language and JSON format always take precedence over these habits.',
  ].join('\n')
}
