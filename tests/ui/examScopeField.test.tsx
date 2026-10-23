import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ExamScopeField, type ScopeValue } from '@/widgets/studyPlan/ExamScopeField'
import { EMPTY_MATERIALS } from '@/entities/studyPlan/types'
import type { CourseOptions } from '@/services/studyPlanService'

function options(patch: Partial<CourseOptions> = {}): CourseOptions {
  return {
    topics: [],
    scopes: [],
    chapters: [],
    analysis: 'none',
    hasSyllabus: false,
    pastExams: [],
    homework: [],
    practiceSets: [],
    reviewDocuments: [],
    documents: [],
    ...patch,
  }
}

const CHAPTERS: CourseOptions['chapters'] = [
  {
    key: 'chapter:n1',
    kind: 'chapter',
    documentId: 'book',
    documentName: 'Book.pdf',
    nodeId: 'n1',
    number: '1',
    title: 'Supply and demand',
    pageStart: 1,
    pageEnd: 4,
    chunkIds: [],
  },
  {
    key: 'section:n1s',
    kind: 'section',
    documentId: 'book',
    documentName: 'Book.pdf',
    nodeId: 'n1s',
    parentKey: 'chapter:n1',
    number: '1.1',
    title: 'Elasticity',
    chunkIds: [],
  },
  {
    key: 'file:slides',
    kind: 'file',
    documentId: 'slides',
    documentName: 'Lecture 1.pptx',
    title: 'Lecture 1.pptx',
    chunkIds: [],
  },
]

function Harness({
  opts,
  onValue,
}: {
  opts: CourseOptions
  onValue?: (value: ScopeValue) => void
}): JSX.Element {
  const [value, setValue] = useState<ScopeValue>({ scope: 'course', topicIds: [], chapterKeys: [] })
  return (
    <MemoryRouter>
      <ExamScopeField
        id="scope"
        projectId="p1"
        options={opts}
        value={value}
        materials={{ ...EMPTY_MATERIALS }}
        onChange={(next) => {
          setValue(next)
          onValue?.(next)
        }}
      />
    </MemoryRouter>
  )
}

describe('考试范围 field', () => {
  it('always offers whole course and picked materials, and says why the rest is missing', () => {
    render(<Harness opts={options()} />)
    const select = screen.getByLabelText('What the exam covers') as HTMLSelectElement
    const labels = [...select.options].map((o) => o.textContent)
    expect(labels).toEqual(['Whole course', 'Picked materials'])
    const hints = screen.getByRole('list')
    expect(within(hints).getByText(/No chapters to choose yet/)).toBeTruthy()
    expect(within(hints).getByText(/Upload the course syllabus/)).toBeTruthy()
    expect(within(hints).getByText(/Analyse the course to choose by topic/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open course analysis' }).getAttribute('href')).toBe(
      '/projects/p1?tab=analysis',
    )
    expect(
      screen.getByRole('link', { name: 'Open the exam topic list' }).getAttribute('href'),
    ).toBe('/projects/p1?tab=exams')
  })

  it('shows chapters as soon as a structure exists; a section follows its chapter', () => {
    const seen = vi.fn()
    render(<Harness opts={options({ chapters: CHAPTERS, analysis: 'running' })} onValue={seen} />)
    expect(screen.queryByText(/No chapters to choose yet/)).toBeNull()
    expect(screen.getByText(/Course analysis is running/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('What the exam covers'), {
      target: { value: 'chapters' },
    })
    const list = screen.getByRole('group', { name: 'Chapters in the exam' })
    const chapter = within(list).getByRole('checkbox', { name: /1 Supply and demand/ })
    fireEvent.click(chapter)
    expect(seen).toHaveBeenLastCalledWith(expect.objectContaining({ chapterKeys: ['chapter:n1'] }))
    const section = within(list).getByRole('checkbox', {
      name: /1\.1 Elasticity/,
    }) as HTMLInputElement
    expect(section.checked).toBe(true)
    expect(section.disabled).toBe(true)
    fireEvent.click(within(list).getByRole('checkbox', { name: /Lecture 1\.pptx/ }))
    expect(seen).toHaveBeenLastCalledWith(
      expect.objectContaining({ chapterKeys: ['chapter:n1', 'file:slides'] }),
    )
  })

  it('offers syllabus scopes and topics when they exist', () => {
    render(
      <Harness
        opts={options({
          analysis: 'ready',
          hasSyllabus: true,
          topics: [{ id: 't1', name: 'Demand' }],
          scopes: [{ documentId: 'syl', scopeId: 'mid', label: 'Midterm', topics: 5 }],
        })}
      />,
    )
    const select = screen.getByLabelText('What the exam covers') as HTMLSelectElement
    expect([...select.options].map((o) => o.textContent)).toEqual([
      'Whole course',
      'Picked materials',
      'Syllabus: Midterm (5 topics)',
      'Chosen topics',
    ])
    expect(screen.queryByText(/Analyse the course/)).toBeNull()
    expect(screen.queryByText(/Upload the course syllabus/)).toBeNull()
  })

  it('a syllabus without scopes says so', () => {
    render(<Harness opts={options({ hasSyllabus: true })} />)
    expect(screen.getByText(/No exam scope was found in the syllabus yet/)).toBeTruthy()
  })
})
