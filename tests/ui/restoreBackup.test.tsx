import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RestoreBackupSection } from '@/widgets/dataManagement/RestoreBackupSection'
import { getDb } from '@/infrastructure/db/database'
import { Toaster } from '@/shared/ui/Toast'

function backup(json: Record<string, unknown>): File {
  return new File([JSON.stringify({ json, blobs: [] })], 'backup.json', {
    type: 'application/json',
  })
}

describe('RestoreBackupSection', () => {
  // Close this test's connection so the next test's database reset is quiet.
  afterEach(() => getDb().close())

  it('shows the summary and only restores after the warning is acknowledged', async () => {
    const user = userEvent.setup()
    const onExport = vi.fn()
    const { container } = render(<RestoreBackupSection onExport={onExport} exporting={false} />)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    await user.upload(
      input,
      backup({ schemaVersion: 17, projects: [{ id: 'p1', name: 'Restored course' }] }),
    )

    expect(await screen.findByText('Restore from backup?')).toBeInTheDocument()
    expect(screen.getByText(/will be replaced\. This cannot be undone/)).toBeInTheDocument()
    expect(screen.getByText(/no API key/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Export current data first' }))
    expect(onExport).toHaveBeenCalledTimes(1)

    const restore = screen.getByRole('button', { name: 'Restore' })
    expect(restore).toBeDisabled()
    await user.click(screen.getByRole('checkbox'))
    expect(restore).toBeEnabled()
    await user.click(restore)

    expect(await screen.findByText('Restore complete')).toBeInTheDocument()
    await waitFor(async () => expect(await getDb().projects.get('p1')).toBeDefined())
  })

  it('explains why an unusable backup cannot be restored', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <>
        <Toaster />
        <RestoreBackupSection onExport={vi.fn()} exporting={false} />
      </>,
    )
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    await user.upload(input, backup({ schemaVersion: 999 }))
    expect(await screen.findByText(/newer version of the app/)).toBeInTheDocument()
    expect(screen.queryByText('Restore from backup?')).not.toBeInTheDocument()
  })
})
