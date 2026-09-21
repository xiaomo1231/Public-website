import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ClassProgressCard } from '@/widgets/tutor/ClassProgressCard'
import type { CourseContext } from '@/entities/courseContext/types'
import type { Topic } from '@/entities/courseAnalysis/types'

function topic(id: string, name: string): Topic {
  return {
    id,
    projectId: 'p1',
    name,
    description: '',
    order: 0,
    sourceRefs: [],
    createdAt: 0,
  }
}

const TOPICS = [
  topic('t1', 'Derivative basics'),
  topic('t2', 'Chain Rule'),
  topic('t3', 'Implicit Differentiation'),
]

const CONTEXT: CourseContext = {
  id: 'p1',
  projectId: 'p1',
  noteLinks: [],
  lectureLinks: [],
  sourceHash: 'x',
  updatedAt: 0,
  classProgress: {
    transcriptDocumentIds: ['d1'],
    currentTopicId: 't2',
    currentTopicName: 'Chain Rule',
    completedTopicIds: ['t1'],
    progressPercent: 67,
    updatedAt: 0,
  },
}

describe('ClassProgressCard', () => {
  it('renders nothing when there is no transcript-derived progress', () => {
    const { container } = render(<ClassProgressCard topics={TOPICS} context={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the class percentage and current topic', () => {
    render(<ClassProgressCard topics={TOPICS} context={CONTEXT} />)
    expect(screen.getByText('Class Progress')).toBeInTheDocument()
    expect(screen.getByText('67%')).toBeInTheDocument()
    expect(screen.getByText('Currently: Chain Rule')).toBeInTheDocument()
  })

  it('lists covered and upcoming topics when expanded', async () => {
    const user = userEvent.setup()
    render(<ClassProgressCard topics={TOPICS} context={CONTEXT} />)

    await user.click(screen.getByRole('button', { name: 'Details' }))
    expect(screen.getByText('Covered')).toBeInTheDocument()
    expect(screen.getByText('Not yet covered')).toBeInTheDocument()
    expect(screen.getByText('Implicit Differentiation')).toBeInTheDocument()
  })

  it('says so when progress cannot be determined, instead of guessing', () => {
    render(
      <ClassProgressCard
        topics={TOPICS}
        context={{
          ...CONTEXT,
          classProgress: { transcriptDocumentIds: ['d1'], completedTopicIds: [], updatedAt: 0 },
        }}
      />,
    )
    expect(screen.queryByText('%')).not.toBeInTheDocument()
    expect(screen.getByText('Class Progress')).toBeInTheDocument()
  })
})
