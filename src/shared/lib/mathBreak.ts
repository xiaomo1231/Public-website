/**
 * Line breaks for a display formula that is wider than its column.
 *
 * `$$a = b + c = d$$` is rewritten — at render time only, the stored text is
 * never changed — as an `aligned` block that breaks at the formula's
 * top-level relations (`=`, `\le`, `\Rightarrow`…) and, when one side is
 * still long, at its top-level `+` / `−`:
 *
 *     a &= b + c \\ &= d            (one relation per line, when needed)
 *     &\quad + e                    (a long right-hand side, continued)
 *
 * "Top level" means outside every brace group, bracket, `\left … \right`
 * pair and environment, so nothing inside `\frac{…}{…}`, `\sqrt{…}`, a matrix
 * or `\text{…}` is ever split. Formulas that already have line breaks or
 * alignment, a tag, or text / spacing / commas at the top level (where an
 * aligned chain could misstate what equals what) are left alone (`null`).
 * The caller still typesets the result and falls back if KaTeX rejects it.
 */

export interface TopLevelBreak {
  /** Index of the operator's first character. */
  index: number
  kind: 'rel' | 'bin'
}

/** Relations a chain may break before (`\to` / `\mapsto` are not: row operations use them). */
const RELATION_COMMANDS = new Set([
  'le',
  'leq',
  'leqslant',
  'ge',
  'geq',
  'geqslant',
  'ne',
  'neq',
  'approx',
  'equiv',
  'sim',
  'simeq',
  'cong',
  'propto',
  'Rightarrow',
  'Leftarrow',
  'Leftrightarrow',
  'Longrightarrow',
  'Longleftrightarrow',
  'implies',
  'impliedby',
  'iff',
  'll',
  'gg',
])

/** After these a `+` / `−` is a sign, not a binary operator. */
const OPERATOR_COMMANDS = new Set([
  'cdot',
  'times',
  'div',
  'pm',
  'mp',
  'ast',
  'circ',
  'cup',
  'cap',
  'wedge',
  'vee',
  'oplus',
  'otimes',
  'to',
  'mapsto',
  'in',
  'notin',
  'subset',
  'subseteq',
  'supset',
  'supseteq',
  'mid',
  'colon',
  'sum',
  'prod',
  'int',
  'iint',
  'oint',
  'lim',
  'not',
])

/** Spacing commands: they change nothing about whether a sign is unary. */
const SPACING_COMMANDS = new Set([',', ':', '>', ' ', '!', 'thinspace', 'medspace', 'thickspace'])

/** At the top level these make an aligned chain unsafe (text, gaps, tags, existing breaks). */
const REFUSE_COMMANDS = new Set([
  'text',
  'textrm',
  'textbf',
  'textit',
  'mbox',
  'quad',
  'qquad',
  ';',
  'tag',
  'label',
  'nonumber',
  'notag',
  'intertext',
  'newline',
  'cr',
])

function readCommand(latex: string, at: number): { name: string; end: number } {
  // `at` is the backslash.
  const rest = latex.slice(at + 1)
  const word = /^[A-Za-z]+/.exec(rest)
  if (word) return { name: word[0], end: at + 1 + word[0].length }
  return { name: rest.charAt(0), end: at + 2 }
}

/** Skip a `\left` / `\right` delimiter (`(`, `\{`, `\langle`, `.` …); returns the index after it. */
function skipDelimiter(latex: string, at: number): number {
  let i = at
  while (latex[i] === ' ') i += 1
  if (latex[i] === '\\') return readCommand(latex, i).end
  return i + 1
}

/**
 * The top-level relations and binary `+` / `−` of a formula, or `null` when
 * it has none we may use (unbalanced groups, existing `\\` / `&`, a tag, or
 * top-level text / spacing / commas).
 */
export function topLevelBreaks(latex: string): TopLevelBreak[] | null {
  const breaks: TopLevelBreak[] = []
  let depth = 0
  // Whether the last top-level token was an operand (then `+` / `−` is binary).
  let operand = false
  let notAt = -1
  let i = 0
  while (i < latex.length) {
    const ch = latex[i]!
    if (ch === '%') return null
    if (ch === '\\') {
      const { name, end } = readCommand(latex, i)
      if (name === '\\') {
        if (depth === 0) return null
        i = end
        continue
      }
      if (name === 'left') {
        depth += 1
        i = skipDelimiter(latex, end)
        if (depth === 1) operand = false
        continue
      }
      if (name === 'right') {
        depth -= 1
        if (depth < 0) return null
        i = skipDelimiter(latex, end)
        if (depth === 0) operand = true
        continue
      }
      if (name === 'begin' || name === 'end') {
        depth += name === 'begin' ? 1 : -1
        if (depth < 0) return null
        if (depth === 0) operand = true
        i = end
        continue
      }
      if (name === '{' || name === '}') {
        depth += name === '{' ? 1 : -1
        if (depth < 0) return null
        if (depth === 0) operand = name === '}'
        i = end
        continue
      }
      if (depth === 0) {
        if (REFUSE_COMMANDS.has(name)) return null
        if (RELATION_COMMANDS.has(name)) {
          breaks.push({ index: notAt >= 0 ? notAt : i, kind: 'rel' })
          notAt = -1
          operand = false
        } else if (name === 'not') {
          notAt = i
          operand = false
        } else if (OPERATOR_COMMANDS.has(name)) {
          notAt = -1
          operand = false
        } else if (!SPACING_COMMANDS.has(name)) {
          notAt = -1
          operand = true
        }
      }
      i = end
      continue
    }
    if (ch === '{' || ch === '(' || ch === '[') {
      depth += 1
      i += 1
      continue
    }
    if (ch === '}' || ch === ')' || ch === ']') {
      depth -= 1
      if (depth < 0) return null
      if (depth === 0) operand = true
      i += 1
      continue
    }
    if (depth === 0) {
      if (ch === '&' || ch === ',' || ch === ';') return null
      if (ch === '=' || ch === '<' || ch === '>') {
        // `:=`, `\not=` keep their prefix on the operator's line.
        const start = notAt >= 0 ? notAt : latex[i - 1] === ':' ? i - 1 : i
        // `<=` / `>=` written as two characters stay one operator.
        const previous = breaks[breaks.length - 1]
        if (!(previous?.kind === 'rel' && /[<>=]/.test(latex[i - 1] ?? ''))) {
          breaks.push({ index: start, kind: 'rel' })
        }
        notAt = -1
        operand = false
      } else if (ch === '+' || ch === '-') {
        if (operand) breaks.push({ index: i, kind: 'bin' })
        operand = false
      } else if (ch === '^' || ch === '_') {
        operand = false
      } else if (ch !== ' ' && ch !== '\n' && ch !== '\t') {
        if (ch !== ':') notAt = -1
        operand = ch !== ':'
      }
    }
    i += 1
  }
  if (depth !== 0) return null
  return breaks
}

/** Whether `breakDisplayLatex` could split this formula at all. */
export function hasTopLevelBreaks(latex: string): boolean {
  const breaks = topLevelBreaks(latex.trim())
  return Boolean(breaks && breaks.length > 0)
}

/**
 * The formula as an `aligned` block of lines of about `budget` source
 * characters, broken only at top-level relations and `+` / `−`; `null` when
 * it cannot be broken into at least two lines.
 */
export function breakDisplayLatex(latex: string, budget: number): string | null {
  const source = latex.trim()
  const breaks = topLevelBreaks(source)
  if (!breaks || breaks.length === 0) return null
  const hasRelation = breaks.some((item) => item.kind === 'rel')

  // Atoms: the text before the first break, then one atom per break.
  const atoms: { text: string; kind: 'lead' | 'rel' | 'bin' }[] = []
  const lead = source.slice(0, breaks[0]!.index).trim()
  if (lead) atoms.push({ text: lead, kind: 'lead' })
  breaks.forEach((item, n) => {
    const end = n + 1 < breaks.length ? breaks[n + 1]!.index : source.length
    const text = source.slice(item.index, end).trim()
    if (text) atoms.push({ text, kind: item.kind })
  })
  if (atoms.length < 2) return null

  const limit = Math.max(8, Math.floor(budget))
  const rows: { atoms: typeof atoms }[] = []
  for (const atom of atoms) {
    const row = rows[rows.length - 1]
    const length = row ? row.atoms.reduce((sum, item) => sum + item.text.length + 1, 0) : 0
    // A row's first relation is its alignment point: a new relation always
    // fits on the current row while that row still has room.
    if (row && length + atom.text.length <= limit) row.atoms.push(atom)
    else rows.push({ atoms: [atom] })
  }
  if (rows.length < 2) return null

  const lines = rows.map((row, index) => {
    const first = row.atoms[0]!
    const rest = row.atoms
      .slice(1)
      .map((item) => item.text)
      .join(' ')
    const tail = rest ? ` ${rest}` : ''
    if (index === 0) {
      if (!hasRelation) return `&${first.text}${tail}`
      // Align at this row's first relation; a long left side stays alone.
      const at = row.atoms.findIndex((item) => item.kind === 'rel')
      if (at < 0) return row.atoms.map((item) => item.text).join(' ')
      const before = row.atoms
        .slice(0, at)
        .map((item) => item.text)
        .join(' ')
      const after = row.atoms
        .slice(at)
        .map((item) => item.text)
        .join(' ')
      return `${before} &${after}`
    }
    if (first.kind === 'rel') return `&${first.text}${tail}`
    return `&\\quad ${first.text}${tail}`
  })
  return `\\begin{aligned}${lines.join(' \\\\ ')}\\end{aligned}`
}
