import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { DataManagementService } from '@/services/dataManagementService'
import { DocumentRepository } from '@/entities/document/repository'
import { MistakeService } from '@/services/mistakeService'
import { canConfirmProjectDeletion } from '@/shared/lib/deletion'
import { DeleteProjectDialog } from '@/widgets/dataManagement/DeleteProjectDialog'
import type { Project } from '@/entities/project/types'

function project(id: string, name: string): Project {
  return {
    id,
    name,
    subject: 'cs',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

describe('canConfirmProjectDeletion', () => {
  it('requires a selected project', () => {
    expect(canConfirmProjectDeletion(null, 'Calculus')).toBe(false)
  })

  it('requires the exact project name', () => {
    const p = project('p1', 'Calculus')
    expect(canConfirmProjectDeletion(p, '')).toBe(false)
    expect(canConfirmProjectDeletion(p, 'calculus')).toBe(false)
    expect(canConfirmProjectDeletion(p, 'Calculus ')).toBe(false)
    expect(canConfirmProjectDeletion(p, 'Calculus')).toBe(true)
  })

  it('rejects a different project name', () => {
    const p = project('p1', 'Calculus')
    expect(canConfirmProjectDeletion(p, 'Physics')).toBe(false)
  })
})

describe('DeleteProjectDialog', () => {
  let db: AppDatabase
  let projects: ProjectService
  let a: Project
  let b: Project

  beforeEach(async () => {
    db = new AppDatabase()
    setDbForTesting(db)
    projects = new ProjectService(db)
    a = await projects.create({ name: 'Calculus I', subject: 'calculus' })
    b = await projects.create({ name: 'Physics I', subject: 'physics' })
  })

  it('lists every project with its name and id', async () => {
    render(
      <DeleteProjectDialog open onOpenChange={vi.fn()} onDeleted={vi.fn()} />,
    )
    await waitFor(() => expect(screen.getByText('Calculus I')).toBeInTheDocument())
    expect(screen.getByText('Physics I')).toBeInTheDocument()
    // The id is shown so the user can disambiguate same-named projects.
    expect(screen.getByText(a.id)).toBeInTheDocument()
    expect(screen.getByText(b.id)).toBeInTheDocument()
  })

  it('does not preselect a project — the user must choose', async () => {
    render(
      <DeleteProjectDialog open onOpenChange={vi.fn()} onDeleted={vi.fn()} />,
    )
    await waitFor(() => expect(screen.getByText('Calculus I')).toBeInTheDocument())
    const radios = screen.getAllByRole('radio')
    expect(radios).toHaveLength(2)
    expect(radios.every((r) => r.getAttribute('aria-checked') === 'false')).toBe(true)
    // Delete is unavailable until a project is chosen and confirmed.
    expect(screen.getByRole('button', { name: /delete project/i })).toBeDisabled()
  })

  it('keeps delete disabled until the exact name is typed', async () => {
    const user = userEvent.setup()
    render(
      <DeleteProjectDialog open onOpenChange={vi.fn()} onDeleted={vi.fn()} />,
    )
    await waitFor(() => expect(screen.getByText('Calculus I')).toBeInTheDocument())

    await user.click(screen.getByRole('radio', { name: /Calculus I/ }))
    const deleteButton = screen.getByRole('button', { name: /delete project/i })
    expect(deleteButton).toBeDisabled()

    const input = screen.getByLabelText(/type/i)
    await user.type(input, 'Physics')
    expect(deleteButton).toBeDisabled()

    await user.clear(input)
    await user.type(input, 'Calculus I')
    await waitFor(() => expect(deleteButton).toBeEnabled())
  })

  it('deletes only the selected project', async () => {
    const onDeleted = vi.fn()
    const user = userEvent.setup()
    render(
      <DeleteProjectDialog open onOpenChange={vi.fn()} onDeleted={onDeleted} />,
    )
    await waitFor(() => expect(screen.getByText('Physics I')).toBeInTheDocument())

    await user.click(screen.getByRole('radio', { name: /Physics I/ }))
    await user.type(screen.getByLabelText(/type/i), 'Physics I')
    await user.click(screen.getByRole('button', { name: /delete project/i }))

    await waitFor(() => expect(onDeleted).toHaveBeenCalled())

    const remaining = await projects.list()
    expect(remaining.map((p) => p.name)).toEqual(['Calculus I'])
  })

  it('cascades: deleting a project removes its documents and mistakes', async () => {
    const docs = new DocumentRepository(db)
    const mistakes = new MistakeService(db)
    await docs.create({ projectId: a.id, type: 'text', name: 'a.txt', sizeBytes: 1, blob: new Blob(['x']) })
    await mistakes.addManual({ projectId: a.id, question: 'Q', studentAnswer: 'x', correctAnswer: 'y', knowledgePoint: 'KP' })
    await docs.create({ projectId: b.id, type: 'text', name: 'b.txt', sizeBytes: 1, blob: new Blob(['y']) })

    const user = userEvent.setup()
    render(<DeleteProjectDialog open onOpenChange={vi.fn()} onDeleted={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Calculus I')).toBeInTheDocument())

    await user.click(screen.getByRole('radio', { name: /Calculus I/ }))
    await user.type(screen.getByLabelText(/type/i), 'Calculus I')
    await user.click(screen.getByRole('button', { name: /delete project/i }))

    await waitFor(async () => {
      const inv = await new DataManagementService(db).inventory()
      expect(inv.projects).toBe(1)
      expect(inv.documents).toBe(1)
      expect(inv.mistakes).toBe(0)
    })
    expect(await docs.listByProject(a.id)).toHaveLength(0)
    expect(await docs.listByProject(b.id)).toHaveLength(1)
  })

  it('shows an empty state when there are no projects', async () => {
    await new DataManagementService(db).deleteProject(a.id)
    await new DataManagementService(db).deleteProject(b.id)
    render(<DeleteProjectDialog open onOpenChange={vi.fn()} onDeleted={vi.fn()} />)
    await waitFor(() =>
      expect(screen.getByText(/no projects to delete/i)).toBeInTheDocument(),
    )
  })

  it('honours a valid initialProjectId but still requires the name', async () => {
    const user = userEvent.setup()
    render(
      <DeleteProjectDialog open initialProjectId={b.id} onOpenChange={vi.fn()} onDeleted={vi.fn()} />,
    )
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: /Physics I/ })).toHaveAttribute('aria-checked', 'true'),
    )

    const deleteButton = screen.getByRole('button', { name: /delete project/i })
    expect(deleteButton).toBeDisabled()
    await user.type(screen.getByLabelText(/type/i), 'Physics I')
    await waitFor(() => expect(deleteButton).toBeEnabled())
  })

  it('ignores an initialProjectId that no longer exists', async () => {
    render(
      <DeleteProjectDialog open initialProjectId="gone" onOpenChange={vi.fn()} onDeleted={vi.fn()} />,
    )
    await waitFor(() => expect(screen.getByText('Calculus I')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /delete project/i })).toBeDisabled()
  })
})
