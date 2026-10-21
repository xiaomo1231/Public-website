import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ProjectService } from '@/services/projectService'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { ExamTopicsPanel } from '@/widgets/syllabus/ExamTopicsPanel'
import { useDocumentsStore } from '@/features/documents/documentsStore'

async function seed() {
  const project = await new ProjectService().create({ name: 'Anatomy', subject: 'medicine' })
  const docs = new DocumentRepository()
  const doc = await docs.create({
    projectId: project.id,
    type: 'pdf',
    materialType: 'syllabus',
    name: 'Handbook.pdf',
    sizeBytes: 1,
  })
  const [chunk] = await new ChunkRepository().addMany([
    {
      documentId: doc.id,
      projectId: project.id,
      materialType: 'syllabus',
      contentType: 'paragraph',
      text: 'TOPICS OF THE FINAL EXAMINATION\nShoulder joint\nTwin formation',
      sourceReference: 'Handbook.pdf',
      order: 0,
      pageNumber: 13,
    },
  ])
  await docs.update(doc.id, {
    status: 'ready',
    syllabus: {
      method: 'local',
      extractedAt: 1,
      scopes: [
        {
          id: 's1',
          label: 'TOPICS OF THE FINAL EXAMINATION',
          kind: 'final',
          topics: [
            {
              id: 'e1',
              text: 'Shoulder joint',
              order: 0,
              page: 13,
              sourceChunkId: chunk!.id,
              source: 'local',
            },
            {
              id: 'e2',
              text: 'Twin formation',
              order: 1,
              page: 13,
              sourceChunkId: chunk!.id,
              source: 'local',
            },
          ],
        },
      ],
    },
  })
  return { projectId: project.id, documentId: doc.id }
}

describe('ExamTopicsPanel', () => {
  it('lists the exam topics with coverage and warns when there is no course material', async () => {
    const { projectId, documentId } = await seed()
    useDocumentsStore.setState({ byProject: {}, loaded: {}, loading: {}, error: {} })
    render(
      <MemoryRouter>
        <ExamTopicsPanel projectId={projectId} />
      </MemoryRouter>,
    )
    expect(await screen.findByText('Shoulder joint')).toBeInTheDocument()
    expect(screen.getByText('Twin formation')).toBeInTheDocument()
    expect(screen.getAllByText('Not found in course material')).toHaveLength(2)
    expect(screen.getByText('The syllabus has no course content of its own')).toBeInTheDocument()
    // "Quiz" links carry the exam scope and topic to the quiz setup.
    const row = screen.getByText('Shoulder joint').closest('tr')!
    const quiz = within(row).getByRole('link', { name: 'Quiz' })
    expect(quiz.getAttribute('href')).toBe(
      `/projects/${projectId}/quiz?examDoc=${documentId}&examScope=s1&examTopic=e1`,
    )
    // 「口试练习」 links preselect the oral-exam rehearsal for the topic / the list.
    const oral = within(row).getByRole('link', { name: 'Oral exam practice: Shoulder joint' })
    expect(oral.getAttribute('href')).toBe(
      `/projects/${projectId}/quiz?examDoc=${documentId}&examScope=s1&examTopic=e1&oral=1`,
    )
    expect(screen.getByRole('link', { name: 'Oral exam practice' }).getAttribute('href')).toBe(
      `/projects/${projectId}/quiz?examDoc=${documentId}&examScope=s1&oral=1`,
    )
    // Nothing covered yet: practice and mastery read "—".
    expect(within(row).getAllByText('—')).toHaveLength(2)
  })
})
