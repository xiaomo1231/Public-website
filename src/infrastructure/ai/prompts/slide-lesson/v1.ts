/**
 * v1 of the "learn by slide" lesson prompt.
 *
 * The student is looking at the original slide (image + extracted text) and
 * wants to understand *this page* before moving on. The model explains only the
 * supplied slide material, then asks exactly one short guiding question. It must
 * never invent what a picture shows when the picture was not transcribed.
 */

import { securityFooter, untrustedContentWrapper } from '../security'

export const VERSION = 'v1' as const
export const PROMPT_KIND = 'slide-lesson' as const

export interface SlideLessonInput {
  documentName: string
  slideNumber: number
  slideTotal: number
  language: 'zh' | 'en' | 'mixed'
  /** Title / body / tables / notes of THIS slide, already labelled. */
  slideMaterial: string
  /**
   * Adjacent slide material, only when it has a clear purpose (e.g. the
   * previous slide defines a term this one uses). Each entry carries its own
   * slide number so the model can cite it honestly.
   */
  neighborSlides?: Array<{ slideNumber: number; text: string; purpose: string }>
  /** True when the slide carries an image that was preserved for the student. */
  hasImage?: boolean
}

export interface SlideLessonOutput {
  explanation: string
  question: string
}

const JSON_SHAPE_HINT = `{
  "explanation": "markdown + LaTeX explanation of this slide",
  "question": "one short guiding question about this slide"
}`

export function buildSystemPrompt(): string {
  return [
    'You are a patient tutor helping a university STEM student understand ONE presentation slide.',
    'You are given the text that was extracted from that slide (title, body, tables, notes) and, when available, a note that an image was preserved for the student.',
    '',
    'Your goal is that the student can read and understand THIS page. Then you offer exactly one small question that helps them check their understanding or explain a key relationship.',
    '',
    'WHAT TO DO:',
    '  - Explain the content of this slide concisely, in the order it appears.',
    '  - Make the connection between the slide and the idea explicit: what is given, what it means, why it matters.',
    '  - Use Markdown structure: short paragraphs, bullet lists, and `##` headings only when they help.',
    '  - End `explanation` with everything the student needs to read this page; do not ask questions inside `explanation`.',
    '',
    'THE ONE QUESTION (field `question`):',
    '  - Exactly one question, one or two sentences.',
    '  - It must be answerable from this slide (or clearly point at this slide).',
    '  - Prefer "explain the relationship / why" over a recall trick.',
    '  - Never state the final answer in the question.',
    '',
    'HONESTY ABOUT IMAGES — this is critical:',
    '  - If an image is preserved for the student, you may refer to it by what the extracted text calls it ("the diagram", "the chart").',
    '  - NEVER invent numeric values, axis labels, arrow directions, colours or conclusions that are not present in the extracted text.',
    '  - If the slide clearly centres on a figure and the text does not describe it, say plainly that the figure must be read from the image and explain only what the text supports.',
    '',
    'MATHEMATICS:',
    '  - All mathematical notation must use LaTeX. Inline maths uses \\( ... \\), display maths uses \\[ ... \\] on its own line.',
    '  - Use standard commands (\\frac, \\sqrt, \\sum, \\int, \\cap, \\cup, \\le, \\ge, \\neq, \\mathbf, \\begin{bmatrix}).',
    '  - Do NOT output Private Use Area characters, symbol-font glyphs, or empty boxes. Never reproduce a malformed glyph verbatim.',
    '',
    'DAMAGED SOURCE TEXT:',
    '  - The extracted text may contain OCR errors, reordered tokens or unresolved glyphs (shown as [?] or boxes).',
    '  - If a glyph is unclear, do not guess a formula. Explain the idea in words or omit it.',
    '',
    'OUTPUT FORMAT:',
    '  - Respond with strictly valid JSON only, no prose and no code fences, matching this shape:',
    JSON_SHAPE_HINT,
    '  - `explanation` may contain Markdown and LaTeX. `question` is plain text (LaTeX allowed for maths).',
    '  - Both fields must be non-empty.',
    '',
    securityFooter(),
  ].join('\n')
}

export function buildUserPrompt(input: SlideLessonInput): string {
  const language =
    input.language === 'zh'
      ? 'Simplified Chinese'
      : input.language === 'en'
        ? 'English'
        : 'Bilingual: primarily English, with key Chinese terms in parentheses'

  const neighbors = (input.neighborSlides ?? [])
    .filter((neighbor) => neighbor.text.trim().length > 0)
    .map((neighbor) =>
      untrustedContentWrapper(
        `ADJACENT SLIDE ${neighbor.slideNumber} (${neighbor.purpose})`,
        neighbor.text,
      ),
    )

  return [
    `Explain slide ${input.slideNumber} of ${input.slideTotal} from "${input.documentName}".`,
    `Write in: ${language}.`,
    input.hasImage
      ? 'An image from this slide is preserved and shown to the student next to your explanation.'
      : '',
    '',
    untrustedContentWrapper(
      `SLIDE ${input.slideNumber} CONTENT`,
      input.slideMaterial.trim() || '(The slide had no extractable text.)',
    ),
    ...neighbors,
    '',
    'Write the explanation of THIS slide, then one short guiding question about it. JSON only.',
  ]
    .filter(Boolean)
    .join('\n')
}

export const EXPECTED_OUTPUT_TYPE = 'SlideLessonOutput' as const

export interface SlideQaHistoryItem {
  role: 'student' | 'assistant'
  content: string
}

export interface SlideQaInput {
  documentName: string
  slideNumber: number
  language: 'zh' | 'en' | 'mixed'
  slideMaterial: string
  explanation: string
  history: SlideQaHistoryItem[]
  message: string
}

/** System prompt for the free-form questions that follow a slide. */
export function buildQaSystemPrompt(): string {
  return [
    'You are a patient tutor answering a student about ONE presentation slide they are looking at.',
    'The extracted slide text and a short explanation are provided as context.',
    '',
    'RULES:',
    '  - Answer the student\'s question, staying grounded in the supplied slide material.',
    '  - You may use standard background knowledge, but say so when the slide itself does not contain the answer.',
    '  - If the question is about a figure whose content is not in the extracted text, say plainly that it can only be read from the image; NEVER invent values, labels or arrows.',
    '  - Be concise and concrete. Prefer guiding the student to the next step over dumping the full answer.',
    '  - Use LaTeX for maths: inline \\( ... \\), display \\[ ... \\].',
    '  - Do not output Private Use Area characters, symbol-font glyphs, or empty boxes.',
    '  - Reply as plain prose/Markdown (no JSON, no code fences around the whole answer).',
    '',
    securityFooter(),
  ].join('\n')
}

export function buildQaUserPrompt(input: SlideQaInput): string {
  const language =
    input.language === 'zh'
      ? 'Simplified Chinese'
      : input.language === 'en'
        ? 'English'
        : 'Bilingual: primarily English, with key Chinese terms in parentheses'

  const history = input.history
    .map((turn) => `${turn.role === 'student' ? 'Student' : 'Tutor'}: ${turn.content}`)
    .join('\n')

  return [
    `The student is asking about slide ${input.slideNumber} of "${input.documentName}".`,
    `Write your answer in: ${language}.`,
    '',
    untrustedContentWrapper(
      `SLIDE ${input.slideNumber} CONTENT`,
      input.slideMaterial.trim() || '(no extractable text on this slide)',
    ),
    input.explanation.trim()
      ? untrustedContentWrapper('EXPLANATION ALREADY GIVEN', input.explanation)
      : '',
    history ? `CONVERSATION SO FAR:\n${history}` : '',
    `Student's new question: ${input.message}`,
    '',
    'Answer the student.',
  ]
    .filter(Boolean)
    .join('\n')
}
