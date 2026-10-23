import { describe, expect, it } from 'vitest'
import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { ReviewSourcePicker } from '@/widgets/studyPlan/ReviewSourcePicker'
import { defaultReviewSources, reviewSourceGroupOf } from '@/entities/studyPlan/reviewOutline'
import type { ReviewSourceOption } from '@/services/examReviewService'
import type { LearningMaterialType } from '@/entities/document/types'

const file = (id: string, materialType: LearningMaterialType): ReviewSourceOption => ({
  id,
  name: `${id}.pdf`,
  materialType,
  group: reviewSourceGroupOf(materialType)!,
  inExam: false,
})

const FILES = [
  file('deck', 'textbook'),
  file('paper', 'past_exam'),
  file('key', 'homework_answer'),
  file('article', 'reading'),
  file('outline', 'syllabus'),
]

function Harness() {
  const [selected, setSelected] = useState(() =>
    defaultReviewSources(FILES.map((f) => ({ ...f, status: 'ready' }))),
  )
  return (
    <>
      <ReviewSourcePicker options={FILES} selected={selected} onChange={setSelected} />
      <output data-testid="chosen">{selected.join(',')}</output>
    </>
  )
}

describe('ReviewSourcePicker', () => {
  it('groups files by role with lectures, papers and answers ticked and reading unticked', () => {
    const { container } = render(<Harness />)
    const box = (id: string) =>
      container.querySelector<HTMLInputElement>(`input[data-review-source="${id}"]`)!
    expect(box('deck').checked).toBe(true)
    expect(box('paper').checked).toBe(true)
    expect(box('key').checked).toBe(true)
    expect(box('article').checked).toBe(false)
    expect(box('outline').checked).toBe(false)
    expect(
      [...container.querySelectorAll('[data-review-source-group]')].map((el) =>
        el.getAttribute('data-review-source-group'),
      ),
    ).toEqual(['lecture', 'past', 'answers', 'reading', 'syllabus'])

    fireEvent.click(box('article'))
    expect(screen.getByTestId('chosen').textContent).toBe('deck,paper,key,article')
    fireEvent.click(box('paper'))
    expect(screen.getByTestId('chosen').textContent).toBe('deck,key,article')
  })
})
