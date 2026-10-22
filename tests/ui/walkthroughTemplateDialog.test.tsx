import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ImportWalkthroughDialog } from '@/widgets/homework/walkthrough/ImportWalkthroughDialog'
import type { HomeworkSet } from '@/entities/homework/types'
import { setUILanguage } from '@/i18n'

const fake = vi.hoisted(() => ({
  template: vi.fn(async () => ({
    text: '# HW · 完整讲解模板\n<!-- walkthrough:overview -->',
    fileName: 'HW-讲解模板.md',
  })),
  isTemplateDocument: vi.fn(async () => true),
  importableDocuments: vi.fn(async () => [
    { id: 'd1', name: 'walkthrough.md', materialType: 'walkthrough_import', imported: true },
  ]),
  hasAI: () => false,
  prepare: vi.fn(),
  commit: vi.fn(),
}))
const download = vi.hoisted(() => ({ downloadText: vi.fn() }))

vi.mock('@/services/walkthroughImportService', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  buildWalkthroughImportService: async () => fake,
}))
vi.mock('@/shared/lib/download', () => download)
vi.mock('@/widgets/documents/DocumentUploadDialog', () => ({ DocumentUploadDialog: () => null }))

const set = { id: 's1', projectId: 'p1', title: 'HW' } as HomeworkSet

beforeEach(() => setUILanguage('zh-CN'))

afterEach(() => {
  vi.clearAllMocks()
})

describe('导入讲解 · 复制模板', () => {
  it('copies the template to the clipboard and downloads it as .md', async () => {
    const user = userEvent.setup()
    // After setup: user-event installs its own clipboard stub.
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    render(<ImportWalkthroughDialog set={set} open onOpenChange={() => {}} />)
    // The chosen file is a filled-in template: no AI re-typesetting, no 只排版 option.
    expect(await screen.findByText(/按模板导入，无需 AI 排版/)).toBeInTheDocument()
    expect(screen.queryByText('只排版，不核对')).not.toBeInTheDocument()
    expect(screen.getByText(/把模板和作业（可附教授答案）一起发给任意 AI/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '复制模板' }))
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining('walkthrough:overview')),
    )
    expect(fake.template).toHaveBeenCalledWith('s1')

    await user.click(screen.getByRole('button', { name: '下载模板 .md' }))
    await waitFor(() =>
      expect(download.downloadText).toHaveBeenCalledWith(
        'HW-讲解模板.md',
        expect.stringContaining('完整讲解模板'),
        'text/markdown;charset=utf-8',
      ),
    )
  })

  it('shows the template to copy by hand when the clipboard is unavailable', async () => {
    const user = userEvent.setup()
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
    render(<ImportWalkthroughDialog set={set} open onOpenChange={() => {}} />)
    await user.click(await screen.findByRole('button', { name: '复制模板' }))
    const box = await screen.findByRole('textbox', { name: '讲解模板（全选后复制）' })
    expect((box as HTMLTextAreaElement).value).toContain('walkthrough:overview')
  })
})
