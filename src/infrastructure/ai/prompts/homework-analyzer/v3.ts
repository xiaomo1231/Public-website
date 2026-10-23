/**
 * Homework / past-paper extraction that also splits out each question's
 * answer when the material prints one (a worked solution, a final answer, a
 * circled or highlighted option, an `Answer n: (c)` line, a marking-scheme or
 * rubric box). The answer is copied verbatim and checked locally against the
 * cited passages (`entities/homework/inlineAnswer.ts`); an answer that cannot
 * be found there is dropped and the question is kept.
 *
 * Output stays backward compatible with v1 / v2: `answer` and
 * `answerSourceChunkIds` are optional, so material without answers reads as
 * before.
 */
import * as v1 from './v1'
import { securityFooter } from '../security'

export const VERSION = 'v3' as const
export const PROMPT_KIND = v1.PROMPT_KIND
export type HomeworkAnalyzerInput = v1.HomeworkAnalyzerInput

export interface HomeworkAnalyzerOutput {
  questions: Array<{
    number?: string | null
    prompt: string
    sourceChunkIds: string[]
    answer?: string | null
    answerSourceChunkIds?: string[]
  }>
}

export const EXPECTED_OUTPUT_TYPE = v1.EXPECTED_OUTPUT_TYPE

const JSON_SHAPE_HINT = `
{
  "questions": [
    {
      "number": "string | null",
      "prompt": "string",
      "sourceChunkIds": ["c-id"],
      "answer": "string | null",
      "answerSourceChunkIds": ["c-id"]
    }
  ]
}
`.trim()

export function buildSystemPrompt(): string {
  return [
    'You extract the individual questions from a student homework assignment or exam paper.',
    'Return each distinct question exactly once, in the order it appears in the material.',
    'Reproduce the question text faithfully; you may tidy obvious whitespace only.',
    'Never answer, solve, or explain a question here, and never invent a question that is not in the material.',
    '',
    'QUESTION SOURCES — this is critical:',
    '  - Every passage of the document begins with a bracketed label whose first part is a chunk id, e.g. `[c:9f3a… · Ch 3 · 3.1 · p12]`.',
    '  - For each question set `sourceChunkIds` to the ids of the passages it actually comes from.',
    '  - Use the ids exactly as printed. Never invent an id, and never use one that does not appear in the document content.',
    '  - If a question is not clearly tied to one passage, list the closest passage rather than leaving it empty.',
    '',
    'ANSWERS PRINTED IN THE MATERIAL:',
    '  - Some material already contains the answer to a question: a worked solution, a final answer, a circled / highlighted / ticked option, a line such as `Answer 7: (c) 1.25`, or a marking-scheme / rubric box (lines like `2 pts: …`, `M1`, `A1`, `[2 marks] …`).',
    '  - When it does, put that answer in `answer` and keep it OUT of `prompt`: `prompt` is the question only.',
    '  - Copy `answer` exactly as printed, character for character. Do not rewrite it, do not convert it to LaTeX, do not complete or correct it, and do not add anything. If you must skip text that is not part of the answer (a page header, another question), join the verbatim pieces with ` … `.',
    '  - Marking-scheme and rubric lines belong to the answer. Marks printed in the question itself, such as `(3 marks)` or `[5]` after the stem or a sub-part, stay in `prompt`.',
    '  - Set `answerSourceChunkIds` to the ids of the passages the answer comes from.',
    '  - If the material does not print an answer for a question, set `answer` to null. Never write an answer yourself.',
    '',
    'TRANSCRIPTION FORMAT (question text):',
    '  - Preserve the document language. Do not translate the problem.',
    '  - Keep the stem and each lettered or numbered subpart as separate lines in the prompt string; use blank lines between subparts.',
    '  - Preserve mathematical meaning and notation. Typeset clear formulas in the question with $...$ or $$...$$ LaTeX; use \\mathbb{R}, superscripts, subscripts, matrices and vectors where the source supports them.',
    '  - Never infer missing symbols, labels, or diagram content. If a figure is referenced, retain that reference in the question text.',
    '  - Keep each question self-contained, including all subparts, without solving it.',
    '',
    'JSON schema:',
    JSON_SHAPE_HINT,
    '',
    securityFooter(),
  ].join('\n')
}

export function buildUserPrompt(input: HomeworkAnalyzerInput): string {
  return v1.buildUserPrompt({ ...input, language: 'mixed' })
}
