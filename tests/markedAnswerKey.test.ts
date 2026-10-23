import { beforeAll, describe, expect, it } from 'vitest'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { extractPdf } from '@/infrastructure/files/pdfExtractor'
import { chunksFromPdf } from '@/infrastructure/files/chunking'
import { findMarkedOptions, markedAnswerLine } from '@/infrastructure/files/markedOptions'
import { matchAnswersToQuestions, parseAnswerEntries } from '@/entities/homework/answerMatching'

// A 1×1 yellow PNG: the highlight stamp an answer key places over a letter.
const YELLOW_PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
  ),
  (c) => c.charCodeAt(0),
)

beforeAll(async () => {
  ;(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker =
    // @ts-expect-error -- pdfjs-dist ships no type declarations for the worker bundle.
    await import('pdfjs-dist/legacy/build/pdf.worker.mjs')
})

/** A synthetic MC key: the paper's text, with stamps over the chosen letters. */
async function markedKey(
  questions: Array<{ prompt: string; options: string[]; marked: number[] }>,
): Promise<Blob> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const stamp = await doc.embedPng(YELLOW_PNG)
  const page = doc.addPage([612, 792])
  let y = 740
  for (const [index, question] of questions.entries()) {
    page.drawText(`(${index + 1}.) ${question.prompt}`, { x: 72, y, size: 11, font })
    y -= 22
    question.options.forEach((option, k) => {
      const letter = String.fromCharCode(97 + k)
      page.drawText(`(${letter}) ${option}`, { x: 86, y, size: 11, font, color: rgb(0, 0, 0) })
      if (question.marked.includes(k))
        page.drawImage(stamp, { x: 84, y: y - 5, width: 18, height: 18, opacity: 0.5 })
      y -= 18
    })
    y -= 14
  }
  const bytes = await doc.save()
  return new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'application/pdf' })
}

describe('multiple-choice keys marked over the option letter', () => {
  it('reads the marked letter of each question and pairs it one-to-one', async () => {
    const blob = await markedKey([
      {
        prompt: 'What is the opportunity cost?',
        options: ['$ 12,000', '$ 25,000', '$ 47,000'],
        marked: [2],
      },
      {
        prompt: 'Should you go?',
        options: ['go; greater', 'go; less', 'not go; less'],
        marked: [0],
      },
      {
        prompt: 'Supply increases when',
        options: ['input prices fall', 'income rises'],
        marked: [],
      },
    ])
    const result = await extractPdf(blob)
    expect(result.pages[0]!.markedOptions).toEqual([
      { question: '1', option: 'c', text: '$ 47,000' },
      { question: '2', option: 'a', text: 'go; greater' },
    ])
    const chunks = chunksFromPdf(
      { documentId: 'd', projectId: 'p', documentName: 'key.pdf', type: 'pdf' },
      result.pages,
    ).map((chunk, i) => ({ ...chunk, id: `c${i}` }))
    const entries = parseAnswerEntries(chunks)
    const matched = matchAnswersToQuestions(
      [
        { id: 'q1', number: '1' },
        { id: 'q2', number: '2' },
        { id: 'q3', number: '3' },
      ],
      entries,
    )
    const byQuestion = Object.fromEntries(
      matched.assignments.map((a) => [
        a.questionId,
        a.status === 'matched' ? entries[a.answerIndex!]!.text : a.status,
      ]),
    )
    expect(byQuestion.q1).toBe('(c) $ 47,000')
    expect(byQuestion.q2).toBe('(a) go; greater')
    // No mark on question 3: no answer is invented.
    expect(byQuestion.q3).not.toMatch(/^\(/)
  })

  it('leaves a mark covering two options of one question to the student', () => {
    const items = [
      { str: '(4.) Pick one', x: 72, y: 700, width: 80, height: 11 },
      { str: '(a) yes', x: 86, y: 680, width: 40, height: 11 },
      { str: '(b) no', x: 86, y: 668, width: 40, height: 11 },
    ]
    const result = findMarkedOptions(items, [{ x0: 84, y0: 664, x1: 104, y1: 694 }])
    expect(result).toEqual({ marked: [], ambiguous: ['4'] })
  })

  it('splits one tall stamp that spans the answers of two questions', () => {
    const items = [
      { str: '(10.) First', x: 72, y: 700, width: 80, height: 11 },
      { str: '(c) three', x: 86, y: 660, width: 40, height: 11 },
      { str: '(d) four', x: 86, y: 642, width: 40, height: 11 },
      { str: '(11.) Second', x: 72, y: 610, width: 80, height: 11 },
      { str: '(a) one', x: 86, y: 566, width: 40, height: 11 },
      { str: '(b) two', x: 86, y: 548, width: 40, height: 11 },
    ]
    // A highlight annotation box and an image box both count as marks.
    const result = findMarkedOptions(items, [{ x0: 84, y0: 560, x1: 105, y1: 655 }])
    expect(result.marked.map((m) => `${m.question}${m.option}`)).toEqual(['10d', '11a'])
  })

  it('ignores a figure and bare numbers inside sentences', () => {
    const items = [
      {
        str: '(1.) The ticket costs $ 60. You value it at $ 15.',
        x: 72,
        y: 700,
        width: 300,
        height: 11,
      },
      { str: '15.', x: 300, y: 690, width: 15, height: 11 },
      { str: '(a) go', x: 86, y: 670, width: 40, height: 11 },
    ]
    const figure = { x0: 60, y0: 600, x1: 400, y1: 720 }
    expect(findMarkedOptions(items, [figure]).marked).toEqual([])
    expect(markedAnswerLine({ question: '7', option: 'c', text: '1.25; lower' })).toBe(
      'Answer 7: (c) 1.25; lower',
    )
  })
})
