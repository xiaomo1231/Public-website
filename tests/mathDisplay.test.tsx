import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import {
  dfracInMatrices,
  inlineMath,
  prepareLatexForDisplay,
  stripMathDelimiters,
} from '@/shared/lib/mathDisplay'
import { Math as TeX } from '@/shared/ui/Math'
import { RichText } from '@/shared/ui/RichText'
import { MistakeCard } from '@/widgets/mistakes/MistakeCard'
import type { Mistake } from '@/entities/mistake/types'

const annotations = (root: HTMLElement): string[] =>
  Array.from(root.querySelectorAll('annotation[encoding="application/x-tex"]')).map(
    (node) => node.textContent ?? '',
  )

describe('shared math display transform', () => {
  it('uses full-size fractions inside every matrix environment only', () => {
    const latex = String.raw`\frac12 + \begin{pmatrix} \tfrac{1}{2} \\ \frac 3 4 \end{pmatrix} \begin{array}{cc} \frac{1}{3} & 1 \end{array}`
    expect(dfracInMatrices(latex)).toBe(
      String.raw`\frac12 + \begin{pmatrix} \dfrac{1}{2} \\ \dfrac 3 4 \end{pmatrix} \begin{array}{cc} \dfrac{1}{3} & 1 \end{array}`,
    )
    expect(prepareLatexForDisplay(String.raw`\frac{a}{b}`)).toBe(String.raw`\frac{a}{b}`)
  })

  it('is applied by the single Math renderer (lessons, RREF checks, step cards)', () => {
    const { container } = render(
      <TeX
        latex={String.raw`\begin{bmatrix} 1 & \frac{1}{2} \\ 0 & \tfrac{3}{4} \end{bmatrix}`}
        display
      />,
    )
    const [tex] = annotations(container)
    expect(tex).toContain(String.raw`\dfrac{1}{2}`)
    expect(tex).toContain(String.raw`\dfrac{3}{4}`)
    expect(tex).not.toMatch(/\\t?frac/)
  })

  it('lets an inline matrix scroll in its own box instead of being clipped', () => {
    const { container } = render(<TeX latex={String.raw`\begin{bmatrix}1&2\end{bmatrix}`} />)
    expect(container.querySelector('.katex-host')?.className).toContain('overflow-x-auto')
    const plain = render(<TeX latex="x^2" />)
    expect(plain.container.querySelector('.katex-host')?.className).not.toContain('overflow-x-auto')
  })

  it('strips stored delimiters from formulas and symbols', () => {
    expect(stripMathDelimiters(' $\\lambda$ ')).toBe('\\lambda')
    expect(stripMathDelimiters('$$a+b$$')).toBe('a+b')
    expect(stripMathDelimiters('\\(x\\)')).toBe('x')
    expect(stripMathDelimiters('\\[x\\]')).toBe('x')
    expect(stripMathDelimiters('A\\mathbf{x}=b')).toBe('A\\mathbf{x}=b')
    expect(inlineMath('$a_i$')).toBe('$a_i$')
    expect(inlineMath('')).toBe('')
  })

  it('renders stored Markdown + LaTeX as formatted text', () => {
    const { container } = render(
      <RichText text={'**行阶梯形** 是 $\\begin{bmatrix}1&0\\end{bmatrix}$'} format="markdown" />,
    )
    expect(container.querySelector('strong')?.textContent).toBe('行阶梯形')
    expect(container.querySelector('.katex')).not.toBeNull()
    expect(container.textContent).not.toContain('**')
  })
})

describe('mistake card', () => {
  const mistake: Mistake = {
    id: 'm1',
    projectId: 'p',
    knowledgePoint: '行阶梯形',
    difficulty: 'intermediate',
    questionType: 'expression',
    question: String.raw`将 $\begin{bmatrix}1&2\\3&4\end{bmatrix}$ 化为**简化行阶梯形**`,
    studentAnswer: String.raw`$\begin{bmatrix}1&2\\0&-2\end{bmatrix}$`,
    correctAnswer: String.raw`$\begin{bmatrix}1&0\\0&\frac{1}{2}\end{bmatrix}$`,
    mistakeType: 'calculation',
    analysisStatus: 'pending',
    status: 'active',
    source: 'auto',
    attemptIds: [],
    attemptCount: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }

  it('typesets the question and both answers instead of showing LaTeX source', () => {
    const noop = vi.fn(async () => {})
    const { container } = render(
      <MistakeCard
        mistake={mistake}
        onAnalyze={noop}
        onMarkUnderstood={noop}
        onArchive={noop}
        onRestore={noop}
        onRemove={noop}
        onPractice={noop}
      />,
    )
    expect(container.querySelectorAll('.katex')).toHaveLength(3)
    expect(container.querySelector('strong')?.textContent).toBe('简化行阶梯形')
    expect(annotations(container).join(' ')).toContain(String.raw`\dfrac{1}{2}`)
    // Only KaTeX's hidden annotation still holds the source.
    const visible = Array.from(container.querySelectorAll('p, dd'))
      .map((node) => {
        const copy = node.cloneNode(true) as HTMLElement
        copy.querySelectorAll('annotation').forEach((a) => a.remove())
        return copy.textContent ?? ''
      })
      .join(' ')
    expect(visible).not.toContain('\\begin')
    expect(visible).not.toContain('$')
  })
})
