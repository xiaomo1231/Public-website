import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { setUILanguage } from '@/i18n'
import { ProofreadView } from '@/widgets/homework/proofread/ProofreadView'
import { SelfTestView } from '@/widgets/homework/selfTest/SelfTestView'
import type { HomeworkProofreadService, ProofreadState } from '@/services/homeworkProofreadService'
import type { HomeworkService } from '@/services/homeworkService'
import type { HomeworkQuestion, HomeworkSet } from '@/entities/homework/types'
import { findProofreadRisks } from '@/entities/homework/proofread'

afterEach(() => setUILanguage('en'))

const set: HomeworkSet = {
  id: 's',
  projectId: 'p',
  documentId: 'd',
  documentName: 'hw.pdf',
  title: 'HW',
  status: 'ready',
  language: 'en',
  questionCount: 1,
  promptVersion: 'v1',
  createdAt: 1,
  updatedAt: 1,
}

const question = (partial: Partial<HomeworkQuestion> = {}): HomeworkQuestion => ({
  id: 'q1',
  projectId: 'p',
  setId: 's',
  documentId: 'd',
  documentName: 'hw.pdf',
  order: 0,
  number: '1',
  prompt: 'Solve x – 3 = 4.\n1 2\n3 4',
  sourceRefs: [{ documentId: 'd', documentName: 'hw.pdf', page: 2 }],
  hints: [],
  generationStatus: 'ready',
  promptVersion: 'v1',
  draftText: '',
  revealedHints: 0,
  solutionRevealed: false,
  messages: [],
  createdAt: 1,
  updatedAt: 1,
  ...partial,
})

function fakeService(q: HomeworkQuestion) {
  const state = (): ProofreadState => ({
    set,
    document: { id: 'd' } as never,
    answerDocument: null,
    entries: [
      {
        question: q,
        sourceText: q.prompt,
        risks: findProofreadRisks(q.prompt),
        answerRisks: [],
        compareWithImage: true,
        page: 2,
        reconfirm: q.edits?.length ? ['hints'] : [],
        hasWalkthroughSection: false,
      },
    ],
  })
  const service = {
    load: vi.fn(async () => state()),
    renderPage: vi.fn(async () => null),
    saveQuestion: vi.fn(async (_id: string, patch: { prompt?: string }) => {
      q = {
        ...q,
        prompt: patch.prompt ?? q.prompt,
        edits: [{ at: 2, by: 'student', field: 'prompt', before: '', after: '', kinds: [] }],
      }
      return q
    }),
    setVerified: vi.fn(async (_id: string, verified: boolean) => {
      q = { ...q, verifiedAt: verified ? 3 : undefined }
      return q
    }),
    setQuestionEvalRole: vi.fn(async () => undefined),
    recordSelfTest: vi.fn(async () => undefined),
  }
  return service
}

describe('ProofreadView', () => {
  it('shows the original page, marks risks, saves through the service and marks 已核对', async () => {
    setUILanguage('zh-CN')
    const fake = fakeService(question())
    const { container } = render(
      <MemoryRouter>
        <ProofreadView
          setId="s"
          projectId="p"
          service={fake as unknown as HomeworkProofreadService}
        />
      </MemoryRouter>,
    )
    await screen.findByText('原图 · 第 2 页')
    // The page image loads in an effect after the label renders.
    await waitFor(() => expect(fake.renderPage).toHaveBeenCalledWith('d', 2))
    expect(container.querySelector('[data-compare-image]')).not.toBeNull()
    expect(container.querySelector('[data-risk="minus_sign"]')).not.toBeNull()
    expect(container.querySelector('[data-risk="matrix"]')).not.toBeNull()
    expect(screen.getByText('1 题中 1 题未核对')).toBeInTheDocument()

    const editor = screen.getByLabelText('题目文字') as HTMLTextAreaElement
    fireEvent.change(editor, { target: { value: 'Solve x - 3 = 4.' } })
    fireEvent.click(screen.getByRole('button', { name: '保存并标记已核对' }))
    await waitFor(() => expect(fake.setVerified).toHaveBeenCalledWith('q1', true))
    expect(fake.saveQuestion).toHaveBeenCalledWith('q1', {
      prompt: 'Solve x - 3 = 4.',
      number: '1',
    })
    // Derived content is flagged with a one-click action.
    await screen.findByText('需重新确认')
    expect(screen.getByRole('button', { name: /重新生成/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '第 1 题，已核对' })).toHaveAttribute(
      'data-verified',
      'true',
    )
  })

  it('splits a sub-part at the cursor', async () => {
    setUILanguage('zh-CN')
    const fake = fakeService(question({ prompt: 'Stem. (a) one two' }))
    render(
      <MemoryRouter>
        <ProofreadView
          setId="s"
          projectId="p"
          service={fake as unknown as HomeworkProofreadService}
        />
      </MemoryRouter>,
    )
    const editor = (await screen.findByLabelText('题目文字')) as HTMLTextAreaElement
    // The editor can mount before the question text is filled in.
    await waitFor(() => expect(editor.value).toContain('two'))
    editor.setSelectionRange(editor.value.indexOf('two'), editor.value.indexOf('two'))
    fireEvent.click(screen.getByRole('button', { name: '在光标处开始新小题' }))
    expect(editor.value).toContain('(b) two')
    expect(screen.getByText('小题：(a) (b)')).toBeInTheDocument()
  })
})

describe('SelfTestView', () => {
  it('hides the answer until submit and records the result', async () => {
    setUILanguage('zh-CN')
    const fake = fakeService(question())
    const held = question({
      evalRole: 'independent',
      answerStatus: 'matched',
      answerText: 'x = 7',
      prompt: 'Solve x - 3 = 4.',
    })
    render(
      <SelfTestView
        set={set}
        questions={[held, question({ id: 'q2' })]}
        homework={{} as HomeworkService}
        language="zh"
        proofread={fake as unknown as HomeworkProofreadService}
      />,
    )
    expect(screen.getByText('自测 · 1 / 1')).toBeInTheDocument()
    expect(screen.queryByText('x = 7')).toBeNull()
    fireEvent.change(screen.getByLabelText('你的作答'), { target: { value: 'x = 7' } })
    fireEvent.click(screen.getByRole('button', { name: '提交并显示答案' }))
    expect(screen.getByText('教授答案')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '对' }))
    await waitFor(() =>
      expect(fake.recordSelfTest).toHaveBeenCalledWith('q1', {
        answer: 'x = 7',
        verdict: 'correct',
        by: 'self',
      }),
    )
  })
})
