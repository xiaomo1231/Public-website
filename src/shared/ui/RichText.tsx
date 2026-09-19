import { useMemo } from 'react'
import { cn } from '@/shared/lib/utils'
import { splitMathSegments, splitParagraphs } from '@/shared/lib/mathText'
import type { InlineSpan, MarkdownBlock } from '@/shared/lib/markdownText'
import { parseLessonSections, type LessonSection } from '@/shared/lib/lessonDocument'
import { Math } from './Math'
import { TeachingBlock } from './TeachingBlock'

/**
 * Reading renderer for course text.
 *
 * Two modes:
 *
 *   - `plain` (default) — extracted source material. Paragraphs come from blank
 *     lines and only LaTeX delimiters are interpreted. Markdown is NOT parsed,
 *     because a PDF's `*` or `#` is content, not formatting.
 *   - `markdown` — AI-authored lesson text. Headings, lists, quotes, emphasis
 *     and teaching blocks are intentional, so they are rendered as semantic
 *     HTML.
 *
 * Both modes typeset LaTeX with the single shared `Math` renderer, and both
 * produce React elements — never an HTML string — so model output cannot inject
 * markup.
 */

/**
 * Textbook-like heading scale. Markdown levels map straight through to HTML:
 * `#` -> h1, `##` -> h2, `###` -> h3. The Topic page renders the topic name as
 * its h1 and `stripDuplicateTitle` removes a matching lesson `#`, so the usual
 * document has exactly one h1.
 */
const HEADING_CLASS: Record<number, string> = {
  1: 'text-[32px] font-semibold leading-[1.2] tracking-tight',
  2: 'text-[24px] font-semibold leading-snug tracking-tight',
  3: 'text-[20px] font-semibold leading-snug',
  4: 'text-[17px] font-semibold leading-snug',
}

function Inline({ spans }: { spans: InlineSpan[] }): JSX.Element {
  return (
    <>
      {spans.map((span, i) => {
        switch (span.kind) {
          case 'math':
            return <Math key={i} latex={span.value} display={span.display} />
          case 'strong':
            return (
              <strong key={i} className="font-semibold text-foreground">
                {span.value}
              </strong>
            )
          case 'em':
            return (
              <em key={i} className="italic">
                {span.value}
              </em>
            )
          case 'code':
            return (
              <code
                key={i}
                className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em] break-words"
              >
                {span.value}
              </code>
            )
          default:
            return <span key={i}>{span.value}</span>
        }
      })}
    </>
  )
}

function Block({
  block,
  paragraphClassName,
}: {
  block: MarkdownBlock
  paragraphClassName?: string
}): JSX.Element {
  switch (block.kind) {
    case 'heading': {
      const Tag = (block.level === 1
        ? 'h1'
        : block.level === 2
          ? 'h2'
          : block.level === 3
            ? 'h3'
            : 'h4') as 'h1' | 'h2' | 'h3' | 'h4'
      return (
        <Tag
          className={cn(
            'pt-3 text-foreground first:pt-0',
            HEADING_CLASS[block.level] ?? HEADING_CLASS[4],
          )}
        >
          <Inline spans={block.spans} />
        </Tag>
      )
    }
    case 'list': {
      const items = block.items.map((item, i) => (
        <li key={i} className={cn('pl-1', paragraphClassName)}>
          <Inline spans={item} />
        </li>
      ))
      return block.ordered ? (
        <ol className="ml-5 list-decimal space-y-1.5">{items}</ol>
      ) : (
        <ul className="ml-5 list-disc space-y-1.5">{items}</ul>
      )
    }
    case 'quote':
      return (
        <blockquote className="border-l-2 border-border pl-4 text-muted-foreground">
          <p className={cn('whitespace-pre-wrap [overflow-wrap:anywhere]', paragraphClassName)}>
            <Inline spans={block.spans} />
          </p>
        </blockquote>
      )
    case 'code':
      return (
        <pre className="max-w-full overflow-x-auto rounded-md bg-muted p-3 text-[13px] leading-relaxed">
          <code className="font-mono">{block.value}</code>
        </pre>
      )
    case 'math':
      return <Math latex={block.value} display />
    default:
      return (
        <p
          className={cn(
            'whitespace-pre-wrap [overflow-wrap:anywhere] text-foreground',
            paragraphClassName,
          )}
        >
          <Inline spans={block.spans} />
        </p>
      )
  }
}

function Section({
  section,
  paragraphClassName,
}: {
  section: LessonSection
  paragraphClassName?: string
}): JSX.Element {
  const blocks = section.blocks.map((block, i) => (
    <Block key={i} block={block} paragraphClassName={paragraphClassName} />
  ))

  if (!section.spec) return <>{blocks}</>

  return (
    <TeachingBlock spec={section.spec} level={section.level}>
      {blocks}
    </TeachingBlock>
  )
}

export interface RichTextProps {
  text: string
  className?: string
  /** Extra classes for each paragraph / list item. */
  paragraphClassName?: string
  /** `plain` for extracted source, `markdown` for AI-authored lessons. */
  format?: 'plain' | 'markdown'
}

export function RichText({
  text,
  className,
  paragraphClassName,
  format = 'plain',
}: RichTextProps): JSX.Element {
  const bodyClass = cn('text-[16px] leading-[1.8] text-foreground', paragraphClassName)

  const sections = useMemo<LessonSection[]>(() => {
    if (format === 'markdown') return parseLessonSections(text)
    return [
      {
        level: 0,
        blocks: splitParagraphs(text).map((paragraph) => ({
          kind: 'paragraph' as const,
          spans: splitMathSegments(paragraph),
        })),
      },
    ]
  }, [text, format])

  const hasContent = sections.some((section) => section.blocks.length > 0)
  if (!hasContent) {
    return <p className={cn('text-sm text-muted-foreground', className)}>—</p>
  }

  return (
    <div className={cn('space-y-4', className)}>
      {sections.map((section, index) => (
        <Section key={index} section={section} paragraphClassName={bodyClass} />
      ))}
    </div>
  )
}
