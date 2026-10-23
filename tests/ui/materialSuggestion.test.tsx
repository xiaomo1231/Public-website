import { describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ProjectService } from '@/services/projectService'
import { DocumentRepository } from '@/entities/document/repository'
import { getDb } from '@/infrastructure/db/database'
import type { Document } from '@/entities/document/types'
import type { MaterialSuggestion } from '@/entities/document/materialSuggestion'
import { MaterialSuggestionNotice } from '@/widgets/documents/MaterialSuggestionNotice'
import { DocumentUploadDialog } from '@/widgets/documents/DocumentUploadDialog'

const SUGGESTION: MaterialSuggestion = {
  type: 'past_exam',
  kind: 'questions',
  confidence: 'high',
  reasons: ['marks', 'examCover'],
  by: 'local',
  at: 1,
}

async function seed(): Promise<{ projectId: string; doc: Document }> {
  const projectId = (await new ProjectService().create({ name: 'Physics', subject: 'physics' })).id
  const documents = new DocumentRepository()
  const created = await documents.create({
    projectId,
    type: 'text',
    name: 'Chapter 5.txt',
    sizeBytes: 10,
    blob: new Blob(['1. (5 marks) Calculate x.']),
  })
  const doc = await documents.update(created.id, {
    status: 'ready',
    suggestedMaterialType: SUGGESTION,
  })
  await getDb().chunks.add({
    id: 'c1',
    documentId: doc.id,
    projectId,
    materialType: 'textbook',
    contentType: 'paragraph',
    text: '1. (5 marks) Calculate x.',
    order: 0,
    createdAt: 1,
  } as never)
  return { projectId, doc }
}

function renderNotice(doc: Document, projectId: string) {
  return render(
    <MemoryRouter>
      <MaterialSuggestionNotice doc={doc} projectId={projectId} />
    </MemoryRouter>,
  )
}

describe('MaterialSuggestionNotice', () => {
  it('asks before changing and changes the role on 改', async () => {
    const user = userEvent.setup()
    const { projectId, doc } = await seed()
    renderNotice(doc, projectId)
    expect(
      screen.getByText('This looks like an exam paper. Change it to "Past exam / mock paper"?'),
    ).toBeInTheDocument()
    expect(screen.getByText(/Based on: marks \/ points/)).toBeInTheDocument()
    // Rendering alone changes nothing.
    expect((await new DocumentRepository().get(doc.id)).materialType).toBe('textbook')
    await user.click(screen.getByRole('button', { name: 'Change' }))
    await waitFor(async () =>
      expect((await new DocumentRepository().get(doc.id)).materialType).toBe('past_exam'),
    )
    const chunk = await getDb().chunks.get('c1')
    expect(chunk?.materialType).toBe('past_exam')
  })

  it('remembers 忽略 without changing the role', async () => {
    const user = userEvent.setup()
    const { projectId, doc } = await seed()
    renderNotice(doc, projectId)
    await user.click(screen.getByRole('button', { name: 'Ignore' }))
    await waitFor(async () =>
      expect(
        (await new DocumentRepository().get(doc.id)).suggestedMaterialType?.dismissedAt,
      ).toBeDefined(),
    )
    expect((await new DocumentRepository().get(doc.id)).materialType).toBe('textbook')
  })

  it('renders nothing for a dismissed or matching suggestion', async () => {
    const { projectId, doc } = await seed()
    const { container, rerender } = renderNotice(
      { ...doc, suggestedMaterialType: { ...SUGGESTION, dismissedAt: 3 } },
      projectId,
    )
    expect(container.querySelector('[data-material-suggestion]')).toBeNull()
    rerender(
      <MemoryRouter>
        <MaterialSuggestionNotice
          doc={{ ...doc, materialType: 'past_exam' }}
          projectId={projectId}
        />
      </MemoryRouter>,
    )
    expect(container.querySelector('[data-material-suggestion]')).toBeNull()
  })
})

describe('upload dialog role suggestion', () => {
  it('suggests roles from file names and folders with suggestMaterialType', async () => {
    const user = userEvent.setup()
    const projectId = (await new ProjectService().create({ name: 'Econ', subject: 'other' })).id
    render(
      <MemoryRouter>
        <DocumentUploadDialog
          projectId={projectId}
          open
          onOpenChange={() => undefined}
          allowMaterialSelect
        />
      </MemoryRouter>,
    )
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!
    await user.upload(input, [
      new File(['x'], 'midterm 2024.pdf', { type: 'application/pdf' }),
      new File(['x'], 'hw3 solutions.pdf', { type: 'application/pdf' }),
      new File(['x'], 'Lecture 1.pdf', { type: 'application/pdf' }),
    ])
    const exam = await screen.findByText(/1 file\(s\) look like "Past exam \/ mock paper"/)
    expect(exam).toBeInTheDocument()
    expect(screen.getByText(/1 file\(s\) look like "Professor answer"/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Mark as "Past exam / mock paper"' }))
    await waitFor(() =>
      expect(document.querySelector('[data-role-suggestion="past_exam"]')).toBeNull(),
    )
    expect(document.querySelector('[data-role-suggestion="homework_answer"]')).not.toBeNull()
  })
})
