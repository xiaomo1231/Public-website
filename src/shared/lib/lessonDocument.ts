import {
  inlineText,
  parseMarkdownBlocks,
  type InlineSpan,
  type MarkdownBlock,
} from './markdownText'
import {
  classifyTeachingBlock,
  normalizeHeadingText,
  stripTrailingColon,
  type TeachingBlockSpec,
} from './teachingBlocks'

/**
 * Turn a lesson's Markdown into the sectioned structure the UI renders.
 *
 * Two jobs, both pure and testable:
 *
 *   1. Promote headings the model wrote as bold text (`**Intuition:**`) into
 *      real headings. The prompt forbids this form, but older cached lessons
 *      and the occasional slip still contain it, and rendering it literally
 *      would look broken.
 *   2. Group blocks under the teaching block that introduces them, so
 *      `## Example` plus everything up to the next same-or-higher heading
 *      becomes one `<section>` rather than loose paragraphs.
 */

export interface LessonSection {
  /** Present when the section is a recognised teaching block. */
  spec?: TeachingBlockSpec
  /** Heading level of the block that opened the section. */
  level: number
  blocks: MarkdownBlock[]
}

/**
 * `**Intuition:**` parses to a paragraph containing a single `strong` span.
 * Detect that shape from the spans themselves — flattening the spans first
 * would drop the emphasis markers we are looking for.
 */
function pseudoHeadingLabel(spans: InlineSpan[]): string | undefined {
  const meaningful = spans.filter((span) => !(span.kind === 'text' && span.value.trim() === ''))
  if (meaningful.length !== 1) return undefined

  const only = meaningful[0]
  if (!only || only.kind !== 'strong') return undefined

  const label = stripTrailingColon(only.value)
  return label && classifyTeachingBlock(label) ? label : undefined
}

/** Rewrite `**Intuition:**` paragraphs as level-2 headings. */
export function promotePseudoHeadings(blocks: MarkdownBlock[]): MarkdownBlock[] {
  return blocks.map((block) => {
    if (block.kind !== 'paragraph') return block
    const label = pseudoHeadingLabel(block.spans)
    if (!label) return block
    return { kind: 'heading', level: 2, spans: [{ kind: 'text', value: label }] }
  })
}

/**
 * Group blocks into sections. A teaching block owns everything up to the next
 * heading at its own level or higher; anything before the first teaching block
 * (and between plain headings) stays in an untyped section.
 */
export function groupIntoSections(blocks: MarkdownBlock[]): LessonSection[] {
  const sections: LessonSection[] = []
  let current: LessonSection = { level: 0, blocks: [] }

  for (const block of blocks) {
    if (block.kind === 'heading') {
      const spec = classifyTeachingBlock(inlineText(block.spans))

      if (spec) {
        if (current.blocks.length > 0) sections.push(current)
        current = { spec, level: block.level, blocks: [] }
        continue
      }

      // A plain heading at or above the current teaching block's level closes it.
      if (current.spec && block.level <= current.level) {
        sections.push(current)
        current = { level: block.level, blocks: [] }
      }
    }
    current.blocks.push(block)
  }

  if (current.blocks.length > 0) sections.push(current)
  return sections
}

/** Full pipeline: Markdown text to renderable sections. */
export function parseLessonSections(markdown: string): LessonSection[] {
  return groupIntoSections(promotePseudoHeadings(parseMarkdownBlocks(markdown)))
}

/**
 * The Topic page already renders the topic name as its `<h1>`, so a lesson that
 * opens with `# Topic Name` would repeat it. Drop that one heading when it
 * matches.
 */
export function stripDuplicateTitle(content: string, topicName: string): string {
  const lines = content.replace(/\r\n?/g, '\n').split('\n')
  const index = lines.findIndex((line) => line.trim() !== '')
  if (index === -1) return content

  const match = /^#\s+(.*)$/.exec((lines[index] ?? '').trim())
  if (!match) return content
  if (normalizeHeadingText(match[1] ?? '') !== normalizeHeadingText(topicName)) return content

  lines.splice(index, 1)
  return lines.join('\n')
}
