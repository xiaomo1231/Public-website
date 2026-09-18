import { describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfirmDialog } from '@/shared/ui/ConfirmDialog'
import { RenameProjectDialog } from '@/widgets/project/RenameProjectDialog'
import type { Project } from '@/entities/project/types'

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'Calculus I',
    subject: 'calculus',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  }
}

describe('ConfirmDialog', () => {
  it('renders title, description and details', () => {
    render(
      <ConfirmDialog
        open
        onOpenChange={vi.fn()}
        title="Delete this document?"
        description="This cannot be undone."
        details={<div>notes.pdf</div>}
        onConfirm={vi.fn()}
      />,
    )
    expect(screen.getByText('Delete this document?')).toBeInTheDocument()
    expect(screen.getByText('This cannot be undone.')).toBeInTheDocument()
    expect(screen.getByText('notes.pdf')).toBeInTheDocument()
  })

  it('calls onConfirm when no text confirmation is required', async () => {
    const onConfirm = vi.fn()
    const user = userEvent.setup()
    render(<ConfirmDialog open onOpenChange={vi.fn()} title="Proceed?" onConfirm={onConfirm} />)
    await user.click(screen.getByRole('button', { name: /confirm/i }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('keeps confirm disabled until the required text is typed exactly', async () => {
    const onConfirm = vi.fn()
    const user = userEvent.setup()
    render(
      <ConfirmDialog
        open
        onOpenChange={vi.fn()}
        title="Delete all data?"
        requireText="DELETE ALL"
        confirmLabel="Delete everything"
        onConfirm={onConfirm}
      />,
    )
    const confirmButton = screen.getByRole('button', { name: /delete everything/i })
    expect(confirmButton).toBeDisabled()

    const input = screen.getByLabelText(/type/i)
    await user.type(input, 'DELETE')
    expect(confirmButton).toBeDisabled()

    await user.type(input, ' ALL')
    await waitFor(() => expect(confirmButton).toBeEnabled())

    await user.click(confirmButton)
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('rejects a near-miss confirmation string', async () => {
    const onConfirm = vi.fn()
    const user = userEvent.setup()
    render(
      <ConfirmDialog open onOpenChange={vi.fn()} title="X" requireText="DELETE ALL" onConfirm={onConfirm} />,
    )
    await user.type(screen.getByLabelText(/type/i), 'delete all')
    expect(screen.getByRole('button', { name: /confirm/i })).toBeDisabled()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('blocks dismissal and double submission while busy', async () => {
    const onConfirm = vi.fn()
    const onOpenChange = vi.fn()
    const user = userEvent.setup()
    render(
      <ConfirmDialog open busy onOpenChange={onOpenChange} title="Working" onConfirm={onConfirm} />,
    )
    const confirmButton = screen.getByRole('button', { name: /confirm/i })
    expect(confirmButton).toBeDisabled()

    await user.keyboard('{Escape}')
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('closes on Escape when not busy', async () => {
    const onOpenChange = vi.fn()
    const user = userEvent.setup()
    render(<ConfirmDialog open onOpenChange={onOpenChange} title="Closable" onConfirm={vi.fn()} />)
    await user.keyboard('{Escape}')
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('closes via the cancel button', async () => {
    const onOpenChange = vi.fn()
    const user = userEvent.setup()
    render(<ConfirmDialog open onOpenChange={onOpenChange} title="X" onConfirm={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('resets the typed confirmation after closing', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <ConfirmDialog open onOpenChange={vi.fn()} title="X" requireText="DELETE ALL" onConfirm={vi.fn()} />,
    )
    await user.type(screen.getByLabelText(/type/i), 'DELETE ALL')
    await waitFor(() => expect(screen.getByRole('button', { name: /confirm/i })).toBeEnabled())

    rerender(
      <ConfirmDialog open={false} onOpenChange={vi.fn()} title="X" requireText="DELETE ALL" onConfirm={vi.fn()} />,
    )
    rerender(
      <ConfirmDialog open onOpenChange={vi.fn()} title="X" requireText="DELETE ALL" onConfirm={vi.fn()} />,
    )
    await waitFor(() => expect(screen.getByRole('button', { name: /confirm/i })).toBeDisabled())
  })
})

describe('RenameProjectDialog', () => {
  it('prefills the current name and disables save until it changes', async () => {
    const onRename = vi.fn()
    const user = userEvent.setup()
    render(
      <RenameProjectDialog open onOpenChange={vi.fn()} project={makeProject()} onRename={onRename} />,
    )
    const input = screen.getByLabelText(/project name/i)
    expect(input).toHaveValue('Calculus I')
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled()

    await user.clear(input)
    await user.type(input, 'Calculus II')
    await waitFor(() => expect(screen.getByRole('button', { name: /save/i })).toBeEnabled())

    await user.click(screen.getByRole('button', { name: /save/i }))
    expect(onRename).toHaveBeenCalledWith('Calculus II')
  })

  it('trims whitespace and blocks an all-whitespace name', async () => {
    const onRename = vi.fn()
    const user = userEvent.setup()
    render(
      <RenameProjectDialog open onOpenChange={vi.fn()} project={makeProject()} onRename={onRename} />,
    )
    const input = screen.getByLabelText(/project name/i)
    await user.clear(input)
    await user.type(input, '   ')
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled()
    expect(onRename).not.toHaveBeenCalled()
  })

  it('shows an inline error instead of window.alert', async () => {
    const onRename = vi.fn().mockRejectedValue(new Error('Name already in use'))
    const user = userEvent.setup()
    render(
      <RenameProjectDialog open onOpenChange={vi.fn()} project={makeProject()} onRename={onRename} />,
    )
    const input = screen.getByLabelText(/project name/i)
    await user.clear(input)
    await user.type(input, 'Duplicate')
    await user.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(screen.getByText('Name already in use')).toBeInTheDocument())
  })

  it('submits on Enter', async () => {
    const onRename = vi.fn()
    const user = userEvent.setup()
    render(
      <RenameProjectDialog open onOpenChange={vi.fn()} project={makeProject()} onRename={onRename} />,
    )
    const input = screen.getByLabelText(/project name/i)
    await user.clear(input)
    await user.type(input, 'Renamed{Enter}')
    await waitFor(() => expect(onRename).toHaveBeenCalledWith('Renamed'))
  })

  it('does not submit twice when save is clicked rapidly', async () => {
    let resolve: (() => void) | undefined
    const onRename = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolve = r
        }),
    )
    const user = userEvent.setup()
    render(
      <RenameProjectDialog open onOpenChange={vi.fn()} project={makeProject()} onRename={onRename} />,
    )
    const input = screen.getByLabelText(/project name/i)
    await user.clear(input)
    await user.type(input, 'Slow')
    const save = screen.getByRole('button', { name: /save/i })
    await user.click(save)
    await user.click(save)
    expect(onRename).toHaveBeenCalledTimes(1)
    await act(async () => {
      resolve?.()
    })
  })
})
