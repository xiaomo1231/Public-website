/**
 * v6 of the homework walkthrough prompts.
 *
 * Adds, on top of v5, the professor-alignment rules (`{ alignProfessor: true }`
 * on the question, sub-part and 详细版 system prompts), sent only when the
 * question has a matched professor answer that is not left to the student.
 * The student is graded against that answer, so the walkthrough follows its
 * method, step order, matrices, notation and answer form; extra checks or
 * other methods come after it, marked as supplementary; every sub-part of the
 * question or of the answer is covered; a sub-part the professor did not
 * solve says so; an obvious typo in the answer gets a one-line note instead
 * of being copied silently.
 *
 * Without `alignProfessor` every prompt is byte-identical to v5 (and so to
 * v4 … v1), and `CACHE_VERSION` stays `'v1'`. The section hash of a question
 * WITH a professor answer carries `PROFESSOR_ALIGN_VERSION`
 * (`entities/homework/walkthrough.ts`), so only those sections are offered
 * for an update.
 */
import { securityFooter } from '../security'
import * as V4 from './v4'

export * from './v5'
export const VERSION = 'v6' as const

const ALIGN_HEADER =
  'A confirmed professor answer is given for this question and the student is graded against it, so align the walkthrough with it:'
const ALIGN_MAPPING =
  '- Read the WHOLE professor answer and map its content to the sub-parts by meaning, not only by labels: a professor solution may answer one sub-part inside another one’s solution (e.g. the first of "two ways" in (b) is in fact the treatment of (a)), and labels such as (a)/(b) inside one solution may name alternative methods rather than the question’s sub-parts.'
const ALIGN_METHOD =
  '- For every sub-part the professor solved, follow the professor’s method, the order of the steps, the matrices and row operations, the notation and the form of the final answer. Do not swap in a different method, even a shorter or more standard one, and do not reorder or replace the professor’s row operations.'
const ALIGN_TEACHING =
  '- Teaching explanation may be added, but it must support the professor’s route: explain why each of the professor’s steps works and what it achieves.'
const ALIGN_SUPPLEMENT =
  '- Put any other method or extra check (for example a determinant check) after the professor’s route, in a paragraph that starts with "**补充（考试不要求）：**" when writing Chinese or "**Supplementary (not required in the exam):**" when writing English.'
const ALIGN_COVERAGE =
  '- Cover every sub-part that appears in the question OR in the professor answer, in the body and in the conclusion; never leave one out.'
const ALIGN_UNSOLVED =
  '- For a sub-part no part of the professor answer covers, write it normally and start it with one short line saying so (e.g. "教授答案未给出此小题的解答。" / "The professor’s answer gives no solution for this part.").'
const ALIGN_TYPOS =
  '- When the professor answer has an obvious typo (a wrong part reference, a repeated symbol, a sign its own next line contradicts), follow the intended meaning and add one short note such as "注：教授答案此处写作 …，应为 …。"; never copy a wrong statement silently, and never change the professor’s result only because you prefer another.'

/** The alignment rules; `part` leaves out the whole-question coverage rule. */
export function professorAlignRules(options: { part?: boolean } = {}): string[] {
  return [
    ALIGN_HEADER,
    ALIGN_MAPPING,
    ALIGN_METHOD,
    ALIGN_TEACHING,
    ALIGN_SUPPLEMENT,
    ...(options.part ? [] : [ALIGN_COVERAGE]),
    ALIGN_UNSOLVED,
    ALIGN_TYPOS,
  ]
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
  analysis?: boolean
  steps?: boolean
  /** v6: follow the confirmed professor answer (only sent when there is one). */
  alignProfessor?: boolean
}): string {
  const { alignProfessor, ...rest } = options
  const base = V4.buildQuestionSystemPrompt(rest)
  return alignProfessor ? beforeFooter(base, professorAlignRules()) : base
}

export function buildPartSystemPrompt(options: {
  linearSystems: boolean
  punctuation?: boolean
  steps?: boolean
  /** v6: follow the confirmed professor answer (only sent when there is one). */
  alignProfessor?: boolean
}): string {
  const { alignProfessor, ...rest } = options
  const base = V4.buildPartSystemPrompt(rest)
  return alignProfessor ? beforeFooter(base, professorAlignRules({ part: true })) : base
}

export function buildVariantSystemPrompt(options: {
  linearSystems: boolean
  level: V4.WalkthroughLevel
  part?: boolean
  /** v6: the version written must stay on the professor’s route too. */
  alignProfessor?: boolean
}): string {
  const { alignProfessor, ...rest } = options
  const base = V4.buildVariantSystemPrompt(rest)
  return alignProfessor
    ? beforeFooter(base, professorAlignRules(rest.part ? { part: true } : {}))
    : base
}
