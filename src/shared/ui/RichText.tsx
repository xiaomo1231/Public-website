import { Fragment, useMemo, useRef, type ReactNode } from 'react'
import { cn } from '@/shared/lib/utils'
import {
  INITIAL_SCALE_STAGE,
  shrinkStep,
  TABLE_MIN_SCALE,
  type FitMeasurement,
  type FitSettings,
  type ScaleStage,
} from '@/shared/lib/fitToWidth'
import { useFitStage, useFitWidthSettings } from '@/shared/lib/useFitStage'
import { splitMathSegments, splitParagraphs } from '@/shared/lib/mathText'
import {
  splitInline,
  type InlineSpan,
  type MarkdownBlock,
  type TableBlock,
} from '@/shared/lib/markdownText'
import type { TableAlignment } from '@/shared/lib/markdownTable'
import { parseLessonSections, type LessonSection } from '@/shared/lib/lessonDocument'
import { useTranslation } from '@/i18n'
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

/** Alignment is a controlled enum, never an arbitrary CSS value. */
const ALIGN_CLASS: Record<TableAlignment, string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
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
                <Inline spans={splitInline(span.value)} />
              </strong>
            )
          case 'em':
            return (
              <em key={i} className="italic">
                <Inline spans={splitInline(span.value)} />
              </em>
            )
          case 'code':
            return (
              <code
                key={i}
                className="break-words rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]"
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
      const Tag = (
        block.level === 1 ? 'h1' : block.level === 2 ? 'h2' : block.level === 3 ? 'h3' : 'h4'
      ) as 'h1' | 'h2' | 'h3' | 'h4'
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
      return <CodeBlock language={block.language} value={block.value} />
    case 'math':
      return <Math latex={block.value} display />
    case 'table':
      return <TableBlockView block={block} />
    default:
      return (
        <p
          className={cn(
            'whitespace-pre-wrap text-foreground [overflow-wrap:anywhere]',
            paragraphClassName,
          )}
        >
          <Inline spans={block.spans} />
        </p>
      )
  }
}

function CodeBlock({ language, value }: { language?: string; value: string }): JSX.Element {
  // In fitted reading (the walkthrough) long lines wrap instead of scrolling.
  const fit = useFitWidthSettings() !== null
  return (
    <div className="max-w-full overflow-hidden rounded-lg bg-muted">
      {language && (
        <div className="border-b border-border/70 px-3 py-1 font-mono text-[11px] text-muted-foreground">
          {language}
        </div>
      )}
      <pre
        className={cn(
          'max-w-full p-3 text-[13px] leading-relaxed',
          fit ? 'whitespace-pre-wrap [overflow-wrap:anywhere]' : 'overflow-x-auto',
        )}
        data-fit-code={fit ? '' : undefined}
      >
        <code className="font-mono">{value}</code>
      </pre>
    </div>
  )
}

function TableBlockView({ block }: { block: TableBlock }): JSX.Element {
  const settings = useFitWidthSettings()
  return settings ? <FitTable block={block} settings={settings} /> : <Table block={block} />
}

function measureTable(element: HTMLElement): FitMeasurement | null {
  const table = element.querySelector('table')
  if (!table || element.clientWidth <= 0) return null
  return { available: element.clientWidth, content: table.scrollWidth }
}

/**
 * A table fitted to the column: cell text wraps within the column's width,
 * then the table's type shrinks down to a floor; only a table that still
 * cannot fit (many numeric columns) keeps a scroll, with a visible hint.
 */
function FitTable({ block, settings }: { block: TableBlock; settings: FitSettings }): JSX.Element {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const tableSettings = { ...settings, minScale: TABLE_MIN_SCALE }
  const stage = useFitStage<ScaleStage>(ref, {
    enabled: true,
    initial: INITIAL_SCALE_STAGE,
    resetKey: JSON.stringify([block.header, block.rows]),
    measure: measureTable,
    next: (current, measurement) => shrinkStep(current, measurement, tableSettings),
  })
  return (
    <div className="max-w-full space-y-1">
      <div
        ref={ref}
        role="region"
        aria-label={t('common.table')}
        tabIndex={stage.scroll ? 0 : undefined}
        data-fit-table
        data-fit-scroll={stage.scroll ? '' : undefined}
        className={cn(
          'max-w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          stage.scroll ? 'overflow-x-auto' : 'overflow-hidden',
        )}
      >
        {/* Auto width is already capped by the column; `anywhere` lets long
            words break so cells wrap instead of widening the table. */}
        <table className="border-collapse" style={{ fontSize: `${14 * stage.scale}px` }}>
          <TableRows block={block} cellClassName="[overflow-wrap:anywhere] px-2 py-1.5" />
        </table>
      </div>
      {stage.scroll && (
        <p className="text-xs text-muted-foreground" data-fit-hint>
          {t('common.scrollForMore')}
        </p>
      )}
    </div>
  )
}

function TableRows({
  block,
  cellClassName = 'px-3 py-2',
}: {
  block: TableBlock
  cellClassName?: string
}): JSX.Element {
  return (
    <>
      <thead>
        <tr>
          {block.header.map((cell, column) => (
            <th
              key={column}
              scope="col"
              className={cn(
                'border-b border-border align-top font-semibold text-foreground',
                cellClassName,
                ALIGN_CLASS[block.align[column] ?? 'left'],
              )}
            >
              <Inline spans={cell} />
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {block.rows.map((row, rowIndex) => (
          <tr key={rowIndex} className="border-b border-border/60 last:border-0">
            {row.map((cell, column) => (
              <td
                key={column}
                className={cn(
                  'break-words align-top',
                  cellClassName,
                  ALIGN_CLASS[block.align[column] ?? 'left'],
                )}
              >
                <Inline spans={cell} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </>
  )
}

function Table({ block }: { block: TableBlock }): JSX.Element {
  const { t } = useTranslation()
  return (
    // The wrapper owns the only horizontal scroll; the page itself never
    // scrolls sideways. It is keyboard-focusable so a wide table can be
    // scrolled without a mouse, and it has an accessible name.
    <div
      role="region"
      aria-label={t('common.table')}
      tabIndex={0}
      className="max-w-full overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <table className="border-collapse text-[15px]">
        <TableRows block={block} />
      </table>
    </div>
  )
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
  /**
   * Optional content rendered immediately after a section. Used to place a
   * lesson's visualizations next to the teaching block they illustrate; the
   * caller owns the decision, RichText stays generic.
   */
  renderAfterSection?: (section: LessonSection, index: number) => ReactNode
}

export function RichText({
  text,
  className,
  paragraphClassName,
  format = 'plain',
  renderAfterSection,
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
        <Fragment key={index}>
          <Section section={section} paragraphClassName={bodyClass} />
          {renderAfterSection?.(section, index)}
        </Fragment>
      ))}
    </div>
  )
}
