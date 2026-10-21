import type { Topic } from '@/entities/courseAnalysis/types'

/**
 * Presentation shared by the lesson readers (Topic page, slide study).
 *
 * The lesson body is rendered by the shared `RichText`/`TeachingBlock`, which
 * stay style-agnostic. The two interface styles reshape it from the outside
 * through descendant variants on the RichText container:
 *
 * - lecture: serif headings, booktabs tables, teaching blocks as side-rule
 *   callouts instead of boxes, small letter-spaced block labels.
 * - lab: numbered `h2`s (`--lesson-num` prefix + a CSS counter, so the numbers
 *   are presentation only and never reach the accessible name), hairline
 *   tables with mono header labels, square accent-ruled blocks.
 */
export const LESSON_PROSE_CLASS = [
  // lecture — headings
  'lecture:[&_h2]:pt-5 lecture:[&_h2]:font-heading lecture:[&_h2]:text-[22px] lecture:[&_h2]:font-bold lecture:[&_h2]:tracking-normal',
  'lecture:[&_h3]:font-heading lecture:[&_h3]:font-bold lecture:[&_h3]:tracking-normal',
  // lecture — teaching blocks become side-rule callouts on the paper
  'lecture:[&_section[aria-label]]:rounded-none lecture:[&_section[aria-label]]:border-0 lecture:[&_section[aria-label]]:border-l-2 lecture:[&_section[aria-label]]:bg-transparent lecture:[&_section[aria-label]]:py-1 lecture:[&_section[aria-label]]:pl-5 lecture:[&_section[aria-label]]:pr-0',
  'lecture:[&_section[aria-label]>h2]:pt-0 lecture:[&_section[aria-label]>h2]:font-sans lecture:[&_section[aria-label]>h2]:text-[12.5px] lecture:[&_section[aria-label]>h2]:font-medium lecture:[&_section[aria-label]>h2]:tracking-[0.14em] lecture:[&_section[aria-label]>h2]:text-muted-foreground',
  'lecture:[&_section[aria-label]>h3]:font-sans lecture:[&_section[aria-label]>h3]:text-[12.5px] lecture:[&_section[aria-label]>h3]:font-medium lecture:[&_section[aria-label]>h3]:tracking-[0.14em] lecture:[&_section[aria-label]>h3]:text-muted-foreground',
  // lecture — booktabs tables
  'lecture:[&_table]:w-full lecture:[&_thead_th]:border-y lecture:[&_thead_th]:border-t-[1.5px] lecture:[&_thead_th]:border-foreground',
  'lecture:[&_tbody_tr:last-child]:border-b-[1.5px] lecture:[&_tbody_tr:last-child]:border-foreground',
  // lab — numbered section headings
  'lab:[counter-reset:lesson-h2] lab:[&_h2]:[counter-increment:lesson-h2] lab:[&_h2]:pt-4 lab:[&_h2]:text-[17px] lab:[&_h2]:tracking-normal',
  'lab:[&_h2]:before:mr-2.5 lab:[&_h2]:before:font-mono lab:[&_h2]:before:text-xs lab:[&_h2]:before:font-normal lab:[&_h2]:before:text-muted-foreground lab:[&_h2]:before:content-[var(--lesson-num)_counter(lesson-h2)]',
  'lab:[&_h3]:text-[15px]',
  // lab — blocks keep a hairline and gain an accent rule
  'lab:[&_section[aria-label]]:border-l-2',
  'lab:[&_section[aria-label]>h2]:pt-0 lab:[&_section[aria-label]>h2]:text-[15px] lab:[&_section[aria-label]>h3]:text-[15px]',
  // lab — dense hairline tables with mono header labels
  'lab:[&_table]:w-full lab:[&_table]:text-sm lab:[&_th]:border lab:[&_td]:border lab:[&_th]:bg-muted lab:[&_th]:font-mono lab:[&_th]:text-[11px] lab:[&_th]:font-medium lab:[&_th]:uppercase lab:[&_th]:tracking-[0.05em] lab:[&_th]:text-muted-foreground',
].join(' ')

/** Body text of the lesson: 17px / 1.9 on paper, 15px / 1.85 on the panel. */
export const LESSON_PARAGRAPH_CLASS =
  'text-[16.5px] leading-[1.8] lecture:text-[17px] lecture:leading-[1.9] lab:text-[15px] lab:leading-[1.85]'

/**
 * Value for the `--lesson-num` custom property: a CSS string such as `"1.2."`
 * that prefixes the lab heading counter. Empty when the topic has no number.
 */
export function lessonNumberVar(number: string | undefined): string {
  if (!number) return '""'
  return `"${number.replace(/["\\]/g, '')}."`
}

/**
 * A rough reading-time estimate for a lesson, in whole minutes (≥ 1).
 *
 * CJK text is counted per character (~400/min), everything else per word
 * (~200/min). LaTeX is left in: formulas take reading time too. It is shown
 * as "about N min" and never used for anything but display.
 */
export function estimateReadingMinutes(text: string): number {
  const cjk = text.match(/[\u3400-\u9fff\uf900-\ufaff]/g)?.length ?? 0
  const words =
    text.replace(/[\u3400-\u9fff\uf900-\ufaff]/g, ' ').match(/[A-Za-z0-9]+/g)?.length ?? 0
  return Math.max(1, Math.round(cjk / 400 + words / 200))
}

/** Countable characters (CJK characters + Latin words), for a readout sub-line. */
export function countLessonWords(text: string): number {
  const cjk = text.match(/[\u3400-\u9fff\uf900-\ufaff]/g)?.length ?? 0
  const words = text.replace(/[\u3400-\u9fff\uf900-\ufaff]/g, ' ').match(/[A-Za-z]+/g)?.length ?? 0
  return cjk + words
}

/** The topic's number: its textbook section number, else its course position. */
export function topicNumber(topic: Topic, index: number): string {
  return topic.sectionNumber ?? String(index + 1).padStart(2, '0')
}

/** "1 Linear systems · 1.2" — the lecture kicker above the lesson title. */
export function topicKicker(topic: Topic): string {
  const chapter =
    topic.chapterNumber && topic.chapterTitle
      ? `${topic.chapterNumber} ${topic.chapterTitle}`
      : (topic.chapterTitle ?? topic.chapterNumber)
  return [chapter, topic.sectionNumber].filter(Boolean).join(' · ')
}
