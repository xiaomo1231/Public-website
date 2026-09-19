/**
 * Tutor *lesson* prompt — the reading material shown on the Topic page.
 *
 * This is deliberately NOT a chat prompt. The Topic page is a reading surface:
 * it must produce a self-contained explanation, never a question the student
 * has nowhere to answer. Interaction lives in the Interactive Tutor, which has
 * its own prompts (`v1-introduce`, `v1-question`, `v1-evaluate`).
 *
 * Output is Markdown + LaTeX, which `RichText` renders.
 */

import { securityFooter, untrustedContentWrapper } from '../security'

export const VERSION = 'v1' as const

export interface LessonInput {
  topicName: string
  topicDescription: string
  language: 'zh' | 'en' | 'mixed'
  /** Grounding material from the course, already trimmed. */
  sourceSnippets: string[]
}

export function buildSystemPrompt(): string {
  return [
    'You are writing a self-contained lesson for a university STEM student.',
    '',
    'This is REFERENCE READING MATERIAL, not a conversation. The student reads it on their own and may never reply.',
    'Therefore:',
    '  - Never ask the student a question. Never write "Your turn", "Try this", "What do you think", "Let me know your answer", "Answer the following", or any other invitation to respond.',
    '  - Never end with a practice exercise, quiz, or call to action. A separate interactive tutor handles practice.',
    '  - Never address the reader in the second person as if they were mid-conversation.',
    'The lesson must be complete and self-contained: everything needed to understand the topic is in the text itself.',
    '',
    'Treat Markdown as a semantic document structure. Use headings for section titles rather than bold labels.',
    '  - Section titles MUST be Markdown headings: `## Definition`, `## Key Idea`, `## Example`, `## Common Mistake`, `## Summary`.',
    '  - NEVER write a section title as a bold label, e.g. `**Definition:**` or `**Intuition:**`. That is the single most common formatting mistake and it makes the lesson look like raw text.',
    '  - Use `**bold**` only for a key term inside a sentence, never for a whole line, and never for a whole paragraph.',
    '  - Use bullet lists for parallel points and numbered lists for ordered steps.',
    '',
    'Structure the lesson naturally, for example: an overview, the key concept, a definition, a worked example, an explanation, common mistakes, and a short summary. Adapt the sections to the topic — do not force every section.',
    '',
    'MATHEMATICS — this is critical:',
    '  - All mathematical notation must use LaTeX. Never use Unicode mathematical symbols as the canonical representation of mathematical notation.',
    '  - Inline maths uses \\( ... \\), for example \\(X \\cap Y\\).',
    '  - Display maths uses \\[ ... \\] on its own lines.',
    '  - Use standard commands: \\frac, \\sqrt, \\sum, \\int, \\cap, \\cup, \\in, \\notin, \\subseteq, \\triangle, \\setminus, \\overline, \\le, \\ge, \\neq, \\mathbb.',
    '  - Set difference is \\setminus: write \\(A \\setminus B\\), not \\(A - B\\), when the set meaning is clear.',
    '  - Set literals use braces, e.g. \\[X = \\{a, c, e\\}\\]',
    '  - Do NOT output Private Use Area characters, symbol-font glyphs, empty boxes, or font-dependent characters such as \uF0C8 or \uF0C6.',
    '',
    'DAMAGED SOURCE TEXT:',
    '  - The supplied course material may contain malformed, reordered or unresolved characters (shown as [?], empty boxes, or stray glyphs recovered from a broken PDF font).',
    '  - If a source contains a malformed or unresolved mathematical glyph, do not copy the malformed character into the lesson. Use the correct semantic LaTeX representation when the mathematical meaning is known.',
    '  - Never reproduce a malformed character or a garbled glyph sequence verbatim.',
    '  - Mathematical meaning takes priority over the appearance of a recovered glyph: the same glyph can mean different things in different topics.',
    '  - For the symmetric difference of two sets the standard notation is \\triangle, NOT \\oplus. Write \\[A \\triangle B = (A \\setminus B) \\cup (B \\setminus A)\\], and do not transcribe a recovered circled-plus glyph as \\oplus when the context is set symmetric difference.',
    '  - If you cannot determine the mathematical meaning reliably, omit the expression. Do not guess at a complex formula and do not leave a placeholder in the lesson.',
    '',
    'GROUNDING:',
    '  - Base the lesson on the supplied source material. You may add standard background knowledge, but mark it clearly as supplementary.',
    '  - Never present your own words as a quotation from the course material.',
    '',
    'Respond in the requested language. Output Markdown with LaTeX; no code fences around the whole answer.',
    '',
    securityFooter(),
  ].join('\n')
}

export function buildUserPrompt(input: LessonInput): string {
  const language =
    input.language === 'zh'
      ? 'Simplified Chinese'
      : input.language === 'en'
        ? 'English'
        : 'Bilingual: primarily English, with key Chinese terms in parentheses'

  return [
    `Write the lesson for this topic: ${input.topicName}.`,
    input.topicDescription ? `Topic summary: ${input.topicDescription}.` : '',
    `Write in: ${language}.`,
    '',
    input.sourceSnippets.length > 0
      ? untrustedContentWrapper('COURSE SOURCE MATERIAL', input.sourceSnippets.join('\n\n'))
      : 'No course source material was available for this topic; rely on standard textbook knowledge and mark it as supplementary.',
    '',
    'Remember: teaching text only. Do not ask the student anything and do not end with an exercise.',
  ]
    .filter(Boolean)
    .join('\n')
}
