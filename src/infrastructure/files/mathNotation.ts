import {
  SYMBOL_FONT_MAP,
  isPrivateUseCodePoint,
  isSymbolFontCodePoint,
} from './textEncoding'

/**
 * Canonicalise mathematical notation in tutor text.
 *
 * ## Why this exists
 *
 * Extracted course text legitimately contains Unicode maths glyphs (a PDF
 * writes `∩`, not `\cap`) and, when the PDF font has no `ToUnicode` CMap,
 * Private Use Area code points synthesised by pdf.js. Both are fine as *source
 * data* — `normalizeExtractedText` keeps them deliberately lossless — but they
 * must not reach the AI as opaque glyphs, and they must not reach the final
 * lesson as raw characters. The lesson's maths has to be canonical LaTeX so the
 * single KaTeX renderer can typeset it.
 *
 * ## What it does
 *
 * 1. Recovers Private Use Area characters that fall in the standard Adobe
 *    Symbol window (`U+F020`–`U+F0FF`) through the existing `SYMBOL_FONT_MAP`.
 *    This is the same mechanism `repairSymbolFontText` uses; it is the only
 *    recovery the project has, and the alternative — deleting the character —
 *    loses the maths outright.
 * 2. Converts Unicode maths symbols to their LaTeX commands (`∩` → `\cap`).
 *    Symbols already inside a maths delimiter are emitted as commands; a symbol
 *    sitting in prose is wrapped in `\(…\)` so it still typesets.
 * 3. Marks any remaining (unrecoverable) Private Use Area character with an
 *    explicit `[?]` placeholder and counts it, instead of silently dropping it
 *    or guessing at a formula.
 *
 * ## What it must never touch
 *
 * Fenced code blocks, inline code spans, ordinary prose, CJK text and existing
 * LaTeX are all left exactly as they are. This is not a global
 * `text.replace(...)` sweep: only recognised maths characters in a plausible
 * maths context are rewritten.
 */

export interface MathNotationResult {
  text: string
  /** Unicode maths symbols rewritten as LaTeX. */
  converted: number
  /** Unrecoverable Private Use Area characters replaced with the marker. */
  unresolved: number
}

export interface MathNotationOptions {
  /**
   * Wrap a symbol found outside a maths delimiter in `\(…\)` so it still
   * typesets (default). Set `false` for fields that store LaTeX source rather
   * than prose — a symbol becomes `\cap` rather than `\(\cap\)`.
   */
  wrap?: boolean
}

/**
 * Placeholder for a character we know is corrupt but cannot reconstruct. It is
 * plain text so it stays valid both in prose and inside `\(…\)`.
 */
export const UNRESOLVED_MARKER = '[?]'

/** Greek letters, set theory, calculus, relations — always mathematics. */
const SYMBOL_LATEX: Readonly<Record<string, string>> = {
  // Set theory and logic
  '∩': '\\cap',
  '∪': '\\cup',
  '∈': '\\in',
  '∉': '\\notin',
  '⊆': '\\subseteq',
  '⊂': '\\subset',
  '⊇': '\\supseteq',
  '⊃': '\\supset',
  '∅': '\\emptyset',
  '∖': '\\setminus',
  '△': '\\triangle',
  '∆': '\\triangle',
  '∀': '\\forall',
  '∃': '\\exists',
  '¬': '\\neg',
  '∧': '\\land',
  '∨': '\\lor',
  '⊕': '\\oplus',
  '⊗': '\\otimes',
  // Relations
  '≤': '\\le',
  '≥': '\\ge',
  '≠': '\\neq',
  '≈': '\\approx',
  '≡': '\\equiv',
  '∝': '\\propto',
  '±': '\\pm',
  '∓': '\\mp',
  '∠': '\\angle',
  '⊥': '\\perp',
  // Calculus
  '∞': '\\infty',
  '∑': '\\sum',
  '∏': '\\prod',
  '∫': '\\int',
  '∂': '\\partial',
  '∇': '\\nabla',
  '∗': '\\ast',
  '⋅': '\\cdot',
  // Greek
  'α': '\\alpha',
  'β': '\\beta',
  'γ': '\\gamma',
  'δ': '\\delta',
  'ε': '\\epsilon',
  'ζ': '\\zeta',
  'η': '\\eta',
  'θ': '\\theta',
  'λ': '\\lambda',
  'μ': '\\mu',
  'ν': '\\nu',
  'ξ': '\\xi',
  'π': '\\pi',
  'ρ': '\\rho',
  'σ': '\\sigma',
  'τ': '\\tau',
  'φ': '\\phi',
  'χ': '\\chi',
  'ψ': '\\psi',
  'ω': '\\omega',
  'Γ': '\\Gamma',
  'Δ': '\\Delta',
  'Θ': '\\Theta',
  'Λ': '\\Lambda',
  'Ξ': '\\Xi',
  'Π': '\\Pi',
  'Σ': '\\Sigma',
  'Φ': '\\Phi',
  'Ψ': '\\Psi',
  'Ω': '\\Omega',
}

/**
 * Symbols that also carry meaning in ordinary prose (`2 × 2`, `10 − 20`,
 * `A → B`). Converted only when they are already inside a maths delimiter.
 */
const MATH_ONLY = new Set(['×', '÷', '·', '−', '→', '←', '↔', '⇒', '⇔'])

/** LaTeX for the multiplication/division signs, converted inside maths only. */
const MATH_ONLY_LATEX: Readonly<Record<string, string>> = {
  '×': '\\times',
  '÷': '\\div',
  '·': '\\cdot',
  '−': '-',
  '→': '\\to',
  '←': '\\leftarrow',
  '↔': '\\leftrightarrow',
  '⇒': '\\Rightarrow',
  '⇔': '\\Leftrightarrow',
}

const SUPERSCRIPTS: Readonly<Record<string, string>> = {
  '⁰': '0',
  '¹': '1',
  '²': '2',
  '³': '3',
  '⁴': '4',
  '⁵': '5',
  '⁶': '6',
  '⁷': '7',
  '⁸': '8',
  '⁹': '9',
}

const SUBSCRIPTS: Readonly<Record<string, string>> = {
  '₀': '0',
  '₁': '1',
  '₂': '2',
  '₃': '3',
  '₄': '4',
  '₅': '5',
  '₆': '6',
  '₇': '7',
  '₈': '8',
  '₉': '9',
}

const FENCE = /^\s*```/

/** `\command` form of a recovered/mapped symbol, or `undefined`. */
function latexFor(symbol: string): string | undefined {
  return SYMBOL_LATEX[symbol] ?? MATH_ONLY_LATEX[symbol]
}

/**
 * Indices of `$` that are part of a matched `$…$` pair on this line.
 *
 * A currency sign (`costs $5`) must not be mistaken for a maths delimiter and
 * flip the rest of the line into maths context. Only single `$` characters that
 * pair up are treated as delimiters; an unpaired one stays literal.
 */
function pairedDollarIndices(line: string): Set<number> {
  const singles: number[] = []
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '$' && line[i - 1] !== '$' && line[i + 1] !== '$') singles.push(i)
  }
  const paired = new Set<number>()
  for (let k = 0; k + 1 < singles.length; k += 2) {
    paired.add(singles[k]!)
    paired.add(singles[k + 1]!)
  }
  return paired
}

/** Balanced `(...)` starting at `openIndex`, or `-1` when unbalanced. */
function findClosingParen(text: string, openIndex: number): number {
  let depth = 0
  for (let i = openIndex; i < text.length; i++) {
    if (text[i] === '(') depth++
    else if (text[i] === ')') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/** Convert symbols inside a fragment that is already known to be maths. */
function convertMathFragment(fragment: string): { text: string; converted: number } {
  let out = ''
  let converted = 0
  for (const char of fragment) {
    const latex = SYMBOL_LATEX[char] ?? MATH_ONLY_LATEX[char]
    if (latex) {
      out += latex
      converted++
    } else if (SUPERSCRIPTS[char]) {
      out += `^{${SUPERSCRIPTS[char]}}`
      converted++
    } else if (SUBSCRIPTS[char]) {
      out += `_{${SUBSCRIPTS[char]}}`
      converted++
    } else {
      out += char
    }
  }
  return { text: out, converted }
}

interface LineResult {
  text: string
  inMath: boolean
  converted: number
  unresolved: number
}

function processLine(line: string, startsInMath: boolean, wrap: boolean): LineResult {
  let out = ''
  let converted = 0
  let unresolved = 0
  let inMath = startsInMath
  let inCode = false
  const dollarDelimiters = pairedDollarIndices(line)

  /** Emit a LaTeX command, wrapping it in maths delimiters when needed. */
  const emit = (latex: string, insideMath: boolean): string =>
    insideMath || !wrap ? latex : `\\(${latex}\\)`

  for (let i = 0; i < line.length; ) {
    const char = line[i]!

    // Inline code spans are opaque; never rewrite their contents.
    if (char === '`') {
      inCode = !inCode
      out += char
      i++
      continue
    }
    if (inCode) {
      out += char
      i++
      continue
    }

    const next = line[i + 1]

    // Maths delimiters. `\(`/`\)` and `\[`/`\]` open and close; `$`/`$$` toggle.
    if (char === '\\' && (next === '(' || next === '[')) {
      inMath = true
      out += char + next
      i += 2
      continue
    }
    if (char === '\\' && (next === ')' || next === ']')) {
      inMath = false
      out += char + next
      i += 2
      continue
    }
    if (char === '$') {
      if (next === '$') {
        inMath = !inMath
        out += '$$'
        i += 2
        continue
      }
      if (dollarDelimiters.has(i)) {
        inMath = !inMath
        out += '$'
        i++
        continue
      }
      // Unpaired `$` (e.g. a price) is literal text, not a maths delimiter.
      out += char
      i++
      continue
    }

    // Private Use Area: recover via the Symbol font table, or mark it.
    const cp = char.codePointAt(0)!
    if (isPrivateUseCodePoint(cp)) {
      const recovered = isSymbolFontCodePoint(cp) ? SYMBOL_FONT_MAP[cp - 0xf000] : undefined
      if (recovered !== undefined) {
        const latex = latexFor(recovered)
        if (latex) {
          out += emit(latex, inMath)
          converted++
        } else {
          out += recovered
        }
      } else {
        out += UNRESOLVED_MARKER
        unresolved++
      }
      i++
      continue
    }

    // Square root takes an argument, so it cannot be a plain table entry.
    if (char === '√') {
      let argument = ''
      if (next === '(') {
        const close = findClosingParen(line, i + 1)
        if (close !== -1) {
          const inner = convertMathFragment(line.slice(i + 2, close))
          argument = inner.text
          converted += inner.converted
          i = close + 1
        } else {
          i++
        }
      } else if (next && /[A-Za-z0-9]/.test(next)) {
        argument = next
        i += 2
      } else {
        i++
      }
      const latex = `\\sqrt{${argument}}`
      out += emit(latex, inMath)
      converted++
      continue
    }

    // Unambiguous maths symbols are converted even in prose; they are wrapped
    // in `\(…\)` so the renderer still typesets them.
    const latex = SYMBOL_LATEX[char]
    if (latex) {
      out += emit(latex, inMath)
      converted++
      i++
      continue
    }

    if (inMath && MATH_ONLY.has(char)) {
      const mapped = MATH_ONLY_LATEX[char]
      if (mapped) {
        out += mapped
        converted++
        i++
        continue
      }
    }

    // Superscripts and subscripts are only safe to rewrite inside maths, where
    // `x²` is unambiguously `x^{2}` and not a chemistry formula in prose.
    if (inMath && (SUPERSCRIPTS[char] || SUBSCRIPTS[char])) {
      const digit = SUPERSCRIPTS[char] ?? SUBSCRIPTS[char]!
      out += SUPERSCRIPTS[char] ? `^{${digit}}` : `_{${digit}}`
      converted++
      i++
      continue
    }

    out += char
    i++
  }

  return { text: out, inMath, converted, unresolved }
}

/**
 * Rewrite Unicode maths and recover/mark Private Use Area characters.
 *
 * Structure-aware: fenced code blocks are passed through verbatim, inline code
 * spans are left alone, and prose outside a maths delimiter only has its
 * unambiguous maths symbols converted (wrapped in `\(…\)` so they still
 * typeset). `unresolved > 0` means a character could not be recovered and was
 * replaced with `[?]` — callers should surface that rather than pretend the
 * text is intact.
 */
export function normalizeMathNotation(
  text: string,
  options: MathNotationOptions = {},
): MathNotationResult {
  if (!text) return { text: '', converted: 0, unresolved: 0 }

  const wrap = options.wrap ?? true
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  let inMath = false
  let inFence = false
  let converted = 0
  let unresolved = 0
  const outLines: string[] = []

  for (const line of lines) {
    if (FENCE.test(line)) {
      inFence = !inFence
      outLines.push(line)
      continue
    }
    if (inFence) {
      outLines.push(line)
      continue
    }
    const result = processLine(line, inMath, wrap)
    inMath = result.inMath
    converted += result.converted
    unresolved += result.unresolved
    outLines.push(result.text)
  }

  return { text: outLines.join('\n'), converted, unresolved }
}
