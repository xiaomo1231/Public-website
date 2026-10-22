import { describe, expect, it } from 'vitest'
import katex from 'katex'
import { selectionTextWithMath } from '@/shared/lib/selectionText'

/** A paragraph like the walkthrough renders: text with KaTeX formulas inside. */
function paragraph(): HTMLParagraphElement {
  const p = document.createElement('p')
  const math = (tex: string) => katex.renderToString(tex, { throwOnError: false })
  p.innerHTML = `Consider the real vector space ${math('\\mathbb{R}^4')}, and let ${math('W')} be a subset.`
  document.body.appendChild(p)
  return p
}

describe('selection text with formulas', () => {
  it('writes each formula once as LaTeX instead of repeating its MathML and HTML copies', () => {
    const p = paragraph()
    const range = document.createRange()
    range.selectNodeContents(p)
    // The plain text carries each formula more than once (hidden MathML copy).
    expect(range.toString().length).toBeGreaterThan(selectionTextWithMath(range).length)
    expect(selectionTextWithMath(range)).toBe(
      'Consider the real vector space $\\mathbb{R}^4$, and let $W$ be a subset.',
    )
    p.remove()
  })

  it('widens a selection that starts inside a formula to the whole formula', () => {
    const p = paragraph()
    const katexHtml = p.querySelector('.katex .katex-html')!
    const range = document.createRange()
    range.setStart(katexHtml, 0)
    range.setEnd(p, p.childNodes.length)
    expect(selectionTextWithMath(range).startsWith('$\\mathbb{R}^4$')).toBe(true)
    p.remove()
  })
})
