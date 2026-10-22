/**
 * The text of a selection with every rendered formula written once as its
 * LaTeX (`$\mathbb{R}^4$`).
 *
 * KaTeX renders each formula twice — a hidden MathML copy and the visible
 * HTML — so `Range.toString()` repeats it ("R 4 R 4", "W W"). Here a range
 * that starts or ends inside a formula is widened to the whole formula, and
 * each formula is replaced by its `annotation[encoding="application/x-tex"]`.
 *
 * Only for what is shown and sent (quotes, translation, questions); text
 * anchors keep using `Range.toString()` so saved passages still re-locate.
 */
export function selectionTextWithMath(range: Range): string {
  const widened = range.cloneRange()
  const startKatex = closestKatex(widened.startContainer)
  const endKatex = closestKatex(widened.endContainer)
  if (startKatex) widened.setStartBefore(startKatex)
  if (endKatex) widened.setEndAfter(endKatex)

  const fragment = widened.cloneContents()
  for (const katex of Array.from(fragment.querySelectorAll('.katex'))) {
    const tex = katex.querySelector('annotation[encoding="application/x-tex"]')?.textContent?.trim()
    const display = katex.closest('.katex-display') !== null
    const replacement = tex ? (display ? `$$${tex}$$` : `$${tex}$`) : visibleText(katex)
    katex.replaceWith(document.createTextNode(replacement))
  }
  // A stray hidden MathML copy (partial clone) must not be read twice.
  for (const hidden of Array.from(fragment.querySelectorAll('.katex-mathml'))) hidden.remove()
  return (fragment.textContent ?? '').replace(/[ \t]+/g, ' ').trim()
}

function closestKatex(node: Node | null): Element | null {
  const element = node?.nodeType === Node.ELEMENT_NODE ? (node as Element) : node?.parentElement
  return element?.closest('.katex') ?? null
}

function visibleText(katex: Element): string {
  const html = katex.querySelector('.katex-html')
  return (html ?? katex).textContent ?? ''
}
