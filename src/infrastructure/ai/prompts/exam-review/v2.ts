/**
 * v2 exam-review prompt (复习提纲, one knowledge point of a consolidated sheet).
 *
 * The sheet is organised by knowledge point across files (see
 * `exam-review-outline/v1`); each point is written from the course chunks it
 * was laid out with (aliases `c1…`), the past-paper / homework questions that
 * test it (aliases `q1…`, with printed marks) and the professor's answers to
 * those questions (aliases `a1…`). On top of v1 the reply says which questions
 * test the point (`examQuestions`) and how the professor gave marks
 * (`marking`, quoted verbatim from an answer; omitted when there is none).
 * Every claim cites aliases that were sent; anything else is dropped locally.
 * All material is untrusted content. The subject profile is appended by the
 * caller (`withSubject`). Nothing is cached. v1 is kept (older sheets).
 */

import { securityFooter, untrustedContentWrapper } from '../security'
import { languageLine, type ExamReviewChunk, type ExamReviewMistake } from './v1'

export const VERSION = 'v2' as const
export const PROMPT_KIND = 'exam-review' as const

export { languageLine }
export type { ExamReviewChunk, ExamReviewMistake }

export interface ExamReviewQuestion {
  alias: string
  /** "Midterm 2023 · Q3". */
  where: string
  /** Printed marks of the whole question, when known. */
  marks?: number
  text: string
}

export interface ExamReviewAnswer {
  alias: string
  /** The question alias it answers. */
  question: string
  text: string
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
  questions: ExamReviewQuestion[]
  answers: ExamReviewAnswer[]
  mistakes: ExamReviewMistake[]
}

export function buildSystemPrompt(): string {
  return [
    'You write one knowledge point of a student’s exam review sheet (复习提纲), synthesised from the course material, the past exam / homework questions and the professor’s answers given. Do not organise it by file.',
    'Return JSON only:',
    '{"summary":[{"text":string,"sources":["c1"]}],',
    ' "keyPoints":[{"kind":"formula"|"definition"|"fact","text":string,"sources":["c2"]}],',
    ' "questionTypes":[{"text":string,"sources":["c3"]}],',
    ' "examQuestions":[{"questions":["q1"],"text":string}],',
    ' "marking":[{"answer":"a1","quote":string,"text":string}],',
    ' "commonMistakes":[{"text":string,"mistakes":["m1"]}]}',
    'Rules:',
    '- `summary`: 2–5 short sentences on what the point is and what matters for the exam.',
    '- `keyPoints`: up to 8 key formulas (LaTeX in $…$) and definitions, exactly as the material states them.',
    '- `questionTypes`: up to 5 typical ways the point is asked, as the questions and material show; say how to approach each in one sentence.',
    '- `examQuestions`: the listed questions that test this point (cite their aliases), each with one sentence on what it asks and how to answer it. Leave it empty when no questions are listed.',
    '- `marking`: up to 4 notes on how the professor gave marks for this point, each quoting (`quote`, copied word for word, at least a few words) a line of one listed answer (`answer` = its alias) and saying in `text` what earns the marks. Leave it empty when no answers are listed or they show nothing about marks.',
    '- `commonMistakes`: up to 4, ONLY from the student’s own mistakes listed; cite them with their aliases. Phrase each as "This may indicate…" / "可能的原因…", never "careless" and never a judgement of ability. Leave it empty when no mistakes are listed.',
    '- Every summary sentence, key point and question type cites, in `sources`, the aliases of the chunks (c…) or questions (q…) that state it. Use only aliases given below. Do not write anything the material does not support; drop it instead.',
    '- Concise: a review sheet, not a lesson. Mastery figures are estimates from practice records, not a measure of ability. Never predict the next exam.',
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
  const questions = input.questions
    .map(
      (q) =>
        `[${q.alias} · ${q.where}${q.marks !== undefined ? ` · ${q.marks} marks` : ''}]\n${q.text}`,
    )
    .join('\n\n')
  const answers = input.answers
    .map((a) => `[${a.alias} · answer to ${a.question}]\n${a.text}`)
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
    untrustedContentWrapper('EXAM AND HOMEWORK QUESTIONS', questions || '(none)'),
    untrustedContentWrapper('PROFESSOR ANSWERS', answers || '(none)'),
    untrustedContentWrapper('STUDENT MISTAKES ON THIS TOPIC', mistakes),
    'Respond with the JSON object only.',
  ].join('\n')
}
