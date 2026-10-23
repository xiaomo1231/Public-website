import { foldMathAlphanumerics } from './fontGlyphs'

/**
 * Office Math (OMML: `m:oMath`, inside PowerPoint's `a14:m` or Word's
 * paragraphs) → LaTeX.
 *
 * Deterministic and local. Only the structure written in the file is
 * translated (fractions, scripts, radicals, n-ary operators, delimiters,
 * accents, functions, limits, matrices); nothing is guessed. Unknown elements
 * fall back to their text. The result is plain LaTeX without `$`.
 */

const GREEK: Record<string, string> = {
  α: '\\alpha',
  β: '\\beta',
  γ: '\\gamma',
  δ: '\\delta',
  ε: '\\epsilon',
  ϵ: '\\epsilon',
  ζ: '\\zeta',
  η: '\\eta',
  θ: '\\theta',
  ι: '\\iota',
  κ: '\\kappa',
  λ: '\\lambda',
  μ: '\\mu',
  ν: '\\nu',
  ξ: '\\xi',
  π: '\\pi',
  ρ: '\\rho',
  σ: '\\sigma',
  τ: '\\tau',
  υ: '\\upsilon',
  φ: '\\phi',
  ϕ: '\\phi',
  χ: '\\chi',
  ψ: '\\psi',
  ω: '\\omega',
  Γ: '\\Gamma',
  Δ: '\\Delta',
  Θ: '\\Theta',
  Λ: '\\Lambda',
  Ξ: '\\Xi',
  Π: '\\Pi',
  Σ: '\\Sigma',
  Φ: '\\Phi',
  Ψ: '\\Psi',
  Ω: '\\Omega',
}

const SYMBOLS: Record<string, string> = {
  '%': '\\%',
  '#': '\\#',
  '&': '\\&',
  _: '\\_',
  $: '\\$',
  '{': '\\{',
  '}': '\\}',
  '×': '\\times',
  '⋅': '\\cdot',
  '·': '\\cdot',
  '∙': '\\cdot',
  '÷': '\\div',
  '−': '-',
  '–': '-',
  '±': '\\pm',
  '∓': '\\mp',
  '≤': '\\le',
  '≥': '\\ge',
  '≠': '\\neq',
  '≈': '\\approx',
  '≡': '\\equiv',
  '∝': '\\propto',
  '→': '\\to',
  '←': '\\leftarrow',
  '⇒': '\\Rightarrow',
  '⇔': '\\Leftrightarrow',
  '↑': '\\uparrow',
  '↓': '\\downarrow',
  '∞': '\\infty',
  '∂': '\\partial',
  '∇': '\\nabla',
  '∈': '\\in',
  '∉': '\\notin',
  '⊂': '\\subset',
  '⊆': '\\subseteq',
  '∪': '\\cup',
  '∩': '\\cap',
  '∀': '\\forall',
  '∃': '\\exists',
  '…': '\\ldots',
  '⋯': '\\cdots',
  '′': "'",
}

const FUNCTIONS = new Set([
  'sin',
  'cos',
  'tan',
  'cot',
  'sec',
  'csc',
  'log',
  'ln',
  'exp',
  'max',
  'min',
  'lim',
  'det',
  'sup',
  'inf',
])

const NARY: Record<string, string> = {
  '∑': '\\sum',
  '∏': '\\prod',
  '∐': '\\coprod',
  '∫': '\\int',
  '∬': '\\iint',
  '∭': '\\iiint',
  '∮': '\\oint',
  '⋃': '\\bigcup',
  '⋂': '\\bigcap',
}

const ACCENTS: Record<string, string> = {
  '̂': '\\hat',
  '^': '\\hat',
  '̃': '\\tilde',
  '~': '\\tilde',
  '̄': '\\bar',
  '̅': '\\bar',
  '¯': '\\bar',
  '̇': '\\dot',
  '̈': '\\ddot',
  '⃗': '\\vec',
  '→': '\\vec',
  '̌': '\\check',
}

function local(el: Element): string {
  return el.localName || el.nodeName.replace(/^.*:/, '')
}

function childElements(el: Element): Element[] {
  return Array.from(el.childNodes).filter((node): node is Element => node.nodeType === 1)
}

function child(el: Element, name: string): Element | undefined {
  return childElements(el).find((c) => local(c) === name)
}

/** `m:val` of a property child (`<m:chr m:val="∑"/>`). */
function prop(el: Element | undefined, name: string): string | undefined {
  if (!el) return undefined
  const p = child(el, name)
  if (!p) return undefined
  return (
    p.getAttribute('m:val') ??
    p.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/math', 'val') ??
    p.getAttribute('val') ??
    ''
  )
}

/** A boolean property: present without a value, or `on` / `1` / `true`. */
function flag(el: Element | undefined, name: string): boolean {
  const value = prop(el, name)
  if (value === undefined) return false
  return value === '' || /^(?:1|on|true)$/i.test(value)
}

/** No-break, thin and narrow no-break spaces (PowerPoint writes them between words). */
const NARROW_SPACES = new RegExp(`[${String.fromCharCode(0xa0, 0x2009, 0x202f)}]`, 'g')

/** Plain run text → LaTeX: Greek, symbols, and words as `\text{…}`. */
export function textToLatex(raw: string, normalText = false): string {
  const text = foldMathAlphanumerics(raw).normalize('NFC').replace(NARROW_SPACES, ' ')
  if (!text) return ''
  // Upright ("normal text") runs are text — unless they are a lone symbol
  // such as the Δ PowerPoint sets upright.
  if (normalText && /[A-Za-z]{2,}/.test(text)) return `\\text{${text.replace(/[{}\\]/g, '')}}`
  let out = ''
  // Words of two or more letters (and the spaces around / between them) read as
  // text: "% change in quantity" → `\%\text{ change in quantity}`.
  // A lone capital after a word ("in Q") stays a maths variable.
  const pieces = text.split(/([ ]*[A-Za-z]{2,}(?:[ ]+(?:[A-Za-z]{2,}|a)(?![A-Za-z]))*[ ]*)/)
  pieces.forEach((piece, index) => {
    if (!piece) return
    if (index % 2 === 1) {
      const word = piece.trim()
      if (FUNCTIONS.has(word)) out += `\\${word} `
      else out += `\\text{${piece}}`
      return
    }
    for (const char of piece) {
      if (char === ' ') continue
      out += GREEK[char] ? `${GREEK[char]} ` : (SYMBOLS[char] ?? char)
    }
  })
  // A trailing space keeps `\Delta` apart from the next run's letter; the
  // final clean-up drops it where it is not needed.
  return out
}

function wrap(latex: string): string {
  return `{${latex}}`
}

/** Convert the children of an OMML container, merging adjacent runs. */
function convertChildren(el: Element | undefined): string {
  if (!el) return ''
  let out = ''
  let runs = ''
  let normal = false
  const flush = () => {
    if (runs) out += textToLatex(runs, normal)
    runs = ''
    normal = false
  }
  for (const node of childElements(el)) {
    const name = local(node)
    if (name === 'r') {
      const rPr = child(node, 'rPr')
      const isNormal = !!rPr && (flag(rPr, 'nor') || prop(rPr, 'sty') === 'p')
      if (runs && isNormal !== normal) flush()
      normal = isNormal
      for (const t of childElements(node)) if (local(t) === 't') runs += t.textContent ?? ''
      continue
    }
    flush()
    out += convertElement(node)
  }
  flush()
  return out
}

function delimiter(char: string | undefined, fallback: string): string {
  const c = char === undefined ? fallback : char
  if (c === '') return '.'
  if (c === '{') return '\\{'
  if (c === '}') return '\\}'
  if (c === '⟨' || c === '〈') return '\\langle'
  if (c === '⟩' || c === '〉') return '\\rangle'
  if (c === '‖') return '\\|'
  if (c === '⌊') return '\\lfloor'
  if (c === '⌋') return '\\rfloor'
  if (c === '⌈') return '\\lceil'
  if (c === '⌉') return '\\rceil'
  return c
}

function convertElement(el: Element): string {
  const name = local(el)
  switch (name) {
    case 'oMathPara':
    case 'oMath':
    case 'e':
    case 'num':
    case 'den':
    case 'sub':
    case 'sup':
    case 'deg':
    case 'lim':
    case 'fName':
    case 'box':
    case 'borderBox':
    case 'phant':
    case 'argPr':
      return convertChildren(el)
    case 'f': {
      const type = prop(child(el, 'fPr'), 'type')
      const num = convertChildren(child(el, 'num'))
      const den = convertChildren(child(el, 'den'))
      if (type === 'lin') return `${wrap(num)}/${wrap(den)}`
      if (type === 'noBar') return `\\genfrac{}{}{0pt}{}${wrap(num)}${wrap(den)}`
      return `\\frac${wrap(num)}${wrap(den)}`
    }
    case 'sSub':
      return `${wrap(convertChildren(child(el, 'e')))}_${wrap(convertChildren(child(el, 'sub')))}`
    case 'sSup':
      return `${wrap(convertChildren(child(el, 'e')))}^${wrap(convertChildren(child(el, 'sup')))}`
    case 'sSubSup':
      return `${wrap(convertChildren(child(el, 'e')))}_${wrap(convertChildren(child(el, 'sub')))}^${wrap(convertChildren(child(el, 'sup')))}`
    case 'sPre':
      return `{}_${wrap(convertChildren(child(el, 'sub')))}^${wrap(convertChildren(child(el, 'sup')))}${wrap(convertChildren(child(el, 'e')))}`
    case 'rad': {
      const pr = child(el, 'radPr')
      const deg = convertChildren(child(el, 'deg'))
      const body = convertChildren(child(el, 'e'))
      return !flag(pr, 'degHide') && deg ? `\\sqrt[${deg}]${wrap(body)}` : `\\sqrt${wrap(body)}`
    }
    case 'nary': {
      const pr = child(el, 'naryPr')
      const chr = prop(pr, 'chr') ?? '∫'
      const op = NARY[chr] ?? textToLatex(chr)
      const sub = flag(pr, 'subHide') ? '' : convertChildren(child(el, 'sub'))
      const sup = flag(pr, 'supHide') ? '' : convertChildren(child(el, 'sup'))
      return `${op}${sub ? `_${wrap(sub)}` : ''}${sup ? `^${wrap(sup)}` : ''} ${convertChildren(child(el, 'e'))}`
    }
    case 'd': {
      const pr = child(el, 'dPr')
      const open = delimiter(prop(pr, 'begChr'), '(')
      const close = delimiter(prop(pr, 'endChr'), ')')
      const sep = prop(pr, 'sepChr') ?? '|'
      const parts = childElements(el)
        .filter((c) => local(c) === 'e')
        .map((c) => convertChildren(c))
      return `\\left${open}${parts.join(textToLatex(sep) || '|')}\\right${close}`
    }
    case 'acc': {
      const chr = prop(child(el, 'accPr'), 'chr') ?? '̂'
      const command = ACCENTS[chr] ?? '\\hat'
      return `${command}${wrap(convertChildren(child(el, 'e')))}`
    }
    case 'bar': {
      const pos = prop(child(el, 'barPr'), 'pos')
      return `${pos === 'bot' ? '\\underline' : '\\overline'}${wrap(convertChildren(child(el, 'e')))}`
    }
    case 'groupChr': {
      const pr = child(el, 'groupChrPr')
      const pos = prop(pr, 'pos') ?? 'bot'
      const body = convertChildren(child(el, 'e'))
      return pos === 'top' ? `\\overbrace${wrap(body)}` : `\\underbrace${wrap(body)}`
    }
    case 'func': {
      const fname = convertChildren(child(el, 'fName')).trim()
      return `${fname} ${convertChildren(child(el, 'e'))}`.trim()
    }
    case 'limLow': {
      const base = convertChildren(child(el, 'e')).trim()
      const limit = convertChildren(child(el, 'lim'))
      if (base === '\\lim') return `\\lim_${wrap(limit)}`
      return `\\underset${wrap(limit)}${wrap(base)}`
    }
    case 'limUpp':
      return `\\overset${wrap(convertChildren(child(el, 'lim')))}${wrap(convertChildren(child(el, 'e')))}`
    case 'eqArr':
      return `\\begin{aligned}${childElements(el)
        .filter((c) => local(c) === 'e')
        .map((c) => convertChildren(c))
        .join(' \\\\ ')}\\end{aligned}`
    case 'm': {
      const rows = childElements(el)
        .filter((c) => local(c) === 'mr')
        .map((row) =>
          childElements(row)
            .filter((c) => local(c) === 'e')
            .map((c) => convertChildren(c))
            .join(' & '),
        )
      return `\\begin{matrix}${rows.join(' \\\\ ')}\\end{matrix}`
    }
    case 'r':
    case 't':
      return textToLatex(el.textContent ?? '')
    default:
      // Property elements (`…Pr`, `ctrlPr`) carry no content.
      if (/Pr$/.test(name)) return ''
      return convertChildren(el)
  }
}

/** LaTeX for one `m:oMath` / `m:oMathPara` element (no surrounding `$`). */
export function ommlToLatex(el: Element): string {
  return (
    convertElement(el)
      .replace(/\s+/g, ' ')
      .replace(/ ?(\\text\{)/g, '$1')
      // A command needs the space only before a letter.
      .replace(/(\\[A-Za-z]+) (?![A-Za-z])/g, '$1')
      .trim()
  )
}
