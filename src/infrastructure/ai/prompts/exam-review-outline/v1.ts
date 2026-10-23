/**
 * v1 exam-review-outline prompt (复习提纲的知识点结构).
 *
 * One request per sheet: the model reads the chosen files' outline (slide /
 * section titles, aliases `c1…`), the past-paper and homework question stems
 * with their printed marks (aliases `q1…`) and the course topics when there
 * are any (aliases `t1…`), and returns the sheet's knowledge points — merged
 * across files, not one per file — each naming the outline lines and the
 * questions it covers. Aliases are a closed set checked locally
 * (`validateOutlineReply`); everything sent is untrusted content. The subject
 * profile is appended by the caller. Nothing is cached.
 */

import { securityFooter, untrustedContentWrapper } from '../security'
import { languageLine } from '../exam-review/v1'

export const VERSION = 'v1' as const
export const PROMPT_KIND = 'exam-review-outline' as const

/** Knowledge points asked for (the sheet's maximum). */
export const OUTLINE_MAX_POINTS = 15

export interface OutlineLine {
  alias: string
  /** "Lecture 3.pptx slide 4". */
  where: string
  text: string
}

export interface OutlineQuestionLine {
  alias: string
  /** "Midterm 2023 · Q3". */
  where: string
  marks?: number
  text: string
}

export interface OutlineTopicLine {
  alias: string
  name: string
}

export interface ExamReviewOutlineInput {
  language: string
  exam: string
  course: string
  lines: OutlineLine[]
  questions: OutlineQuestionLine[]
  topics: OutlineTopicLine[]
}

export function buildSystemPrompt(): string {
  return [
    'You lay out the knowledge points of a student’s exam review sheet (复习提纲) from the course material listed: lecture slide / section titles, past exam and homework questions, and the course topics when given.',
    'Return JSON only:',
    '{"points":[{"title":string,"topic":"t1"|null,"chunks":["c1","c4"],"questions":["q2"]}]}',
    'Rules:',
    `- At most ${OUTLINE_MAX_POINTS} knowledge points, in the order the course teaches them. Organise by knowledge point, never by file: the same point taught in several decks or asked in several papers is ONE point that cites all of them.`,
    '- `title`: a short name of the knowledge point (≤ 80 characters).',
    '- `chunks`: the aliases of the outline lines (c…) that teach the point; `questions`: the aliases of the questions (q…) that test it. Each point cites at least one of them. Use only aliases listed below.',
    '- `topic`: the alias of the course topic it corresponds to (t…), or null.',
    '- Points with more exam marks matter more; still include points the lectures stress even if no question tests them.',
    '- Skip administrative lines (course info, schedules, grading, reading lists).',
    '',
    securityFooter(),
  ].join('\n')
}

export function buildUserPrompt(input: ExamReviewOutlineInput): string {
  const lines = input.lines.map((line) => `[${line.alias} · ${line.where}] ${line.text}`).join('\n')
  const questions = input.questions
    .map(
      (q) =>
        `[${q.alias} · ${q.where}${q.marks !== undefined ? ` · ${q.marks} marks` : ''}] ${q.text}`,
    )
    .join('\n')
  const topics = input.topics.map((topic) => `[${topic.alias}] ${topic.name}`).join('\n')
  return [
    languageLine(input.language).replace(/^Write/, 'Write the titles'),
    untrustedContentWrapper('EXAM', `${input.exam} (${input.course})`),
    untrustedContentWrapper('LECTURE OUTLINE', lines || '(none)'),
    untrustedContentWrapper('EXAM AND HOMEWORK QUESTIONS', questions || '(none)'),
    untrustedContentWrapper('COURSE TOPICS', topics || '(none)'),
    'Respond with the JSON object only.',
  ].join('\n')
}
