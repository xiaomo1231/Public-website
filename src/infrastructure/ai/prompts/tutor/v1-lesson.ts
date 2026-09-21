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
  /** Primary course material (textbook), already trimmed. */
  sourceSnippets: string[]
  /** Supplementary learner notes, matched to this topic. */
  notesSnippets?: string[]
  /** Lecture transcript excerpts — teaching style / class context. */
  transcriptSnippets?: string[]
  /** Where this topic sits in the textbook structure, e.g. "3 — Derivatives". */
  chapterLabel?: string
  sectionLabel?: string
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
    'VISUAL SOURCE MATERIAL:',
    '  - Some source material may contain diagrams, figures, charts, Venn diagrams, screenshots, or mathematical content embedded as images.',
    '  - A snippet marked as a preserved figure is shown to the student as the original image. Refer to it (for example "Consider the following Venn diagram") instead of reproducing or reconstructing its text.',
    '  - Do not invent or reconstruct a mathematical expression from uncertain OCR text. If the exact symbolic meaning is uncertain, explain the idea in words or omit it.',
    '  - Prefer the original visual source over an uncertain transcription.',
    '',
    'COURSE STRUCTURE:',
    '  - The textbook chapter and section hierarchy is authoritative. Explain the material within its original textbook context.',
    '  - Do not move content to another chapter, invent chapter numbers, or rename the chapter/section.',
    '',
    'LEARNING MATERIAL ROLES:',
    '  - The course material (textbook) is the PRIMARY source of course facts. Base definitions and results on it.',
    '  - User notes are SUPPLEMENTARY learner context: they show what the learner found important, their own explanations, examples and questions. They may contain mistakes. Use them to target the explanation; never silently treat a note as authoritative when it conflicts with the course material.',
    '  - The lecture transcript shows HOW the professor teaches (intuition, analogies, emphasis, sequence). Use it for explanation style and class context — not to replace the textbook\'s formal definitions.',
    '  - When sources disagree, state each position instead of deciding which is "correct": e.g. "The course material states X. Your notes mention Y."',
    '  - If a note says something like "the professor said this will be on the exam", phrase it as a possibility from the notes ("Your notes indicate the professor emphasised this"), never as a certainty.',
    '',
    'GROUNDING:',
    '  - Base the lesson on the supplied source material. You may add standard background knowledge, but mark it clearly as supplementary.',
    '  - Never present your own words as a quotation from the course material.',
    '  - Do not invent source citations.',
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
    input.chapterLabel || input.sectionLabel
      ? [
          'CURRENT MATERIAL (textbook position — authoritative):',
          input.chapterLabel ? `Chapter: ${input.chapterLabel}` : '',
          input.sectionLabel ? `Section: ${input.sectionLabel}` : '',
        ]
          .filter(Boolean)
          .join('\n')
      : '',
    '',
    input.sourceSnippets.length > 0
      ? untrustedContentWrapper('PRIMARY COURSE MATERIAL (TEXTBOOK)', input.sourceSnippets.join('\n\n'))
      : 'No course source material was available for this topic; rely on standard textbook knowledge and mark it as supplementary.',
    input.notesSnippets && input.notesSnippets.length > 0
      ? untrustedContentWrapper('SUPPLEMENTARY LEARNER NOTES', input.notesSnippets.join('\n\n'))
      : '',
    input.transcriptSnippets && input.transcriptSnippets.length > 0
      ? untrustedContentWrapper(
          'LECTURE TRANSCRIPT (TEACHING STYLE AND CLASS CONTEXT)',
          input.transcriptSnippets.join('\n\n'),
        )
      : '',
    '',
    'Remember: teaching text only. Do not ask the student anything and do not end with an exercise.',
  ]
    .filter(Boolean)
    .join('\n')
}
