/**
 * Display-time LaTeX transforms shared by every math surface (lessons, the
 * walkthrough and its step cards / RREF checks, mistakes, review cards…).
 *
 * They change only how a formula is typeset, never what it says, and are
 * applied by the single `Math` renderer so every page looks the same.
 */

const MATRIX_BLOCK =
  /\\begin\{(bmatrix|pmatrix|Bmatrix|vmatrix|Vmatrix|matrix|smallmatrix|array)\}[\s\S]*?\\end\{\1\}/g

/**
 * Fractions inside matrices are typeset full size (`\dfrac`): KaTeX's matrix
 * cells use text style, where `\frac` / `\tfrac` shrink and adjacent rows
 * collide. Fractions outside matrices are left untouched.
 */
export function dfracInMatrices(text: string): string {
  if (!text.includes('\\begin{')) return text
  return text.replace(MATRIX_BLOCK, (block) => block.replace(/\\t?frac(?=\s*[{\d])/g, '\\dfrac'))
}

/**
 * A stored formula / symbol as bare LaTeX: surrounding `$…$`, `$$…$$`,
 * `\(…\)` or `\[…\]` are removed (the model sometimes includes them).
 */
export function stripMathDelimiters(latex: string): string {
  const text = latex.trim()
  const wrapped =
    /^\$\$([\s\S]+)\$\$$/.exec(text) ??
    /^\$([^$]+)\$$/.exec(text) ??
    /^\\\(([\s\S]+)\\\)$/.exec(text) ??
    /^\\\[([\s\S]+)\\\]$/.exec(text)
  return (wrapped?.[1] ?? text).trim()
}

/** A formula / symbol as an inline `$…$` segment for text rendered by `RichText`. */
export function inlineMath(latex: string): string {
  const bare = stripMathDelimiters(latex)
  return bare ? `$${bare}$` : ''
}

/** Everything applied to a LaTeX source right before it is typeset. */
export function prepareLatexForDisplay(latex: string): string {
  return dfracInMatrices(latex)
}
