/**
 * v1 exam-review prompt (复习提纲).
 *
 * One request per topic of an exam's review sheet. The model gets the topic,
 * the course chunks it may use (short aliases `c1…`, valid for this request
 * only), the student's mastery estimate and their open mistakes on the topic
 * (aliases `m1…`). Every claim must cite the chunk aliases it rests on; a
 * common-mistake note must cite the mistakes it comes from. Claims whose
 * aliases are not among those sent are dropped locally. The chunks and the
 * mistakes are untrusted content. The subject profile is appended by the
 * caller (`withSubject`). Nothing is cached.
 */

import { securityFooter, untrustedContentWrapper } from '../security'
import { examLanguageInstruction, examLanguageOf } from '../exam-language/v1'

export const VERSION = 'v1' as const
export const PROMPT_KIND = 'exam-review' as const

export interface ExamReviewChunk {
  alias: string
  /** "atlas.pdf p. 12". */
  where: string
  text: string
}

export interface ExamReviewMistake {
  alias: string
  question: string
  studentAnswer: string
  correctAnswer: string
  /** The analysed likely cause, when there is one. */
  cause?: string
}

export interface ExamReviewInput {
  /** `zh` | `zh_terms` | `en` | `mixed` | `exam:<code>`. */
  language: string
  exam: string
  course: string
  topic: string
  /** Mastery estimate in percent; absent without practice. */
  mastery?: number
  /** Share of past-paper marks in percent, when known. */
  marksShare?: number
  chunks: ExamReviewChunk[]
  mistakes: ExamReviewMistake[]
}

export function languageLine(language: string): string {
  const exam = examLanguageOf(language)
  if (exam) return `Write in ${examLanguageInstruction(exam)}.`
  switch (language) {
    case 'en':
      return 'Write in English.'
    case 'zh':
      return 'Write in Simplified Chinese.'
    case 'mixed':
      return 'Write in the language of the source chunks; keep technical terms as they appear there.'
    default:
      return 'Write in Simplified Chinese; at the first mention of each key technical term add the English term in parentheses, e.g. "特征值 (eigenvalue)".'
  }
}

export function buildSystemPrompt(): string {
  return [
    'You write one topic of a student’s exam review sheet (复习提纲), from the course material given.',
    'Return JSON only:',
    '{"summary":[{"text":string,"sources":["c1"]}],',
    ' "keyPoints":[{"kind":"formula"|"definition"|"fact","text":string,"sources":["c2"]}],',
    ' "questionTypes":[{"text":string,"sources":["c3"]}],',
    ' "commonMistakes":[{"text":string,"mistakes":["m1"]}]}',
    'Rules:',
    '- `summary`: 2–5 short sentences on what the topic is and what matters for the exam.',
    '- `keyPoints`: up to 8 key formulas (LaTeX in $…$) and definitions, exactly as the material states them.',
    '- `questionTypes`: up to 5 typical ways the topic is asked, as the material (past papers, practice, examples) shows; say how to approach each in one sentence.',
    '- `commonMistakes`: up to 4, ONLY from the student’s own mistakes listed; cite them with their aliases. Phrase each as "This may indicate…" / "可能的原因…", never "careless" and never a judgement of ability. Leave it empty when no mistakes are listed.',
    '- Every summary sentence, key point and question type cites, in `sources`, the aliases of the chunks that state it. Use only aliases from SOURCE CHUNKS. Do not write anything the chunks do not support; drop it instead.',
    '- Concise: a review sheet, not a lesson. Mastery figures are estimates from practice records, not a measure of ability.',
    '',
    securityFooter(),
  ].join('\n')
}

export function buildUserPrompt(input: ExamReviewInput): string {
  const facts = [
    `Exam: ${input.exam} (${input.course})`,
    `Topic: ${input.topic}`,
    input.mastery !== undefined
      ? `Mastery estimate: ${input.mastery}% (from practice records)`
      : 'Mastery estimate: no practice yet',
    ...(input.marksShare !== undefined
      ? [`Share of past-paper marks: about ${input.marksShare}%`]
      : []),
  ].join('\n')
  const chunks = input.chunks
    .map((chunk) => `[${chunk.alias} · ${chunk.where}]\n${chunk.text}`)
    .join('\n\n')
  const mistakes =
    input.mistakes.length > 0
      ? input.mistakes
          .map(
            (m) =>
              `[${m.alias}] Question: ${m.question}\nStudent answer: ${m.studentAnswer}\nCorrect answer: ${m.correctAnswer}` +
              (m.cause ? `\nLikely cause: ${m.cause}` : ''),
          )
          .join('\n\n')
      : '(none)'
  return [
    languageLine(input.language),
    untrustedContentWrapper('TOPIC', facts),
    untrustedContentWrapper('SOURCE CHUNKS', chunks || '(none)'),
    untrustedContentWrapper('STUDENT MISTAKES ON THIS TOPIC', mistakes),
    'Respond with the JSON object only.',
  ].join('\n')
}
