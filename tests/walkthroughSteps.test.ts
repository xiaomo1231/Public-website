import { describe, expect, it } from 'vitest'
import {
  applyRowOps,
  entryArithmetic,
  findMatrices,
  parseCell,
  parseRowOp,
  parseRowOps,
  splitSteps,
  type WalkthroughStep,
} from '@/entities/homework/walkthroughSteps'
import { formatRational, rational } from '@/infrastructure/math/rref'

const r = (n: number, d = 1) => rational.of(BigInt(n), BigInt(d))
const text = (value: ReturnType<typeof r>) => formatRational(value)

/** The HW3 style: an operation sentence, then the resulting augmented matrix. */
const HW3 = [
  '### (a) 判断方程组是否相容',
  '',
  '写出增广矩阵（augmented matrix）：',
  '',
  '$$\\left[\\begin{array}{ccc|c} 1 & 2 & 0 & 3 \\\\ 2 & 1 & 1 & 4 \\\\ 3 & 0 & 1 & 1 \\end{array}\\right]$$',
  '',
  '作 $R_2 \\to R_2 - 2R_1$，$R_3 \\to R_3 - 3R_1$：',
  '',
  '$$\\left[\\begin{array}{ccc|c} 1 & 2 & 0 & 3 \\\\ 0 & -3 & 1 & -2 \\\\ 0 & -6 & 1 & -8 \\end{array}\\right]$$',
  '',
  '第二列下方还要消去，作 $R_3 \\to R_3 - 2R_2$：',
  '',
  '$$\\begin{bmatrix} 1 & 2 & 0 & 3 \\\\ 0 & -3 & 1 & -2 \\\\ 0 & 0 & -1 & -4 \\end{bmatrix}$$',
  '',
  '作 $R_2 \\to -\\frac{1}{3}R_2$：',
  '',
  '$$\\begin{bmatrix} 1 & 2 & 0 & 3 \\\\ 0 & 1 & -\\frac{1}{3} & \\frac{2}{3} \\\\ 0 & 0 & -1 & -4 \\end{bmatrix}$$',
  '',
  '所以方程组相容。',
].join('\n')

function steps(body: string): WalkthroughStep[] {
  return splitSteps(body).flatMap((chunk) => (chunk.kind === 'step' ? [chunk.step] : []))
}

describe('matrix and operation parsing', () => {
  it('reads cells with fractions, signs and braces', () => {
    expect(text(parseCell('-\\dfrac{1}{2}')!)).toBe('-1/2')
    expect(text(parseCell('\\frac{-3}{6}')!)).toBe('-1/2')
    expect(text(parseCell('{-4}')!)).toBe('-4')
    expect(text(parseCell('\\mathbf{7}')!)).toBe('7')
    expect(parseCell('x')).toBeNull()
  })

  it('finds an augmented array with its bar', () => {
    const [found] = findMatrices(
      '\\left[\\begin{array}{ccc|c} 1 & 2 & 0 & 3 \\\\ 2 & 1 & 1 & 4 \\end{array}\\right]',
    )
    expect(found!.matrix!.bar).toBe(3)
    expect(found!.matrix!.rows.map((row) => row.map(text))).toEqual([
      ['1', '2', '0', '3'],
      ['2', '1', '1', '4'],
    ])
  })

  it('parses row operations in the usual notations', () => {
    const op = parseRowOp('R_3 \\to R_3 - 3R_1 - 2R_2')!
    expect(op.kind).toBe('combine')
    if (op.kind !== 'combine') return
    expect(op.target).toBe(2)
    expect(op.terms.map((term) => [term.row, text(term.coef)])).toEqual([
      [2, '1'],
      [0, '-3'],
      [1, '-2'],
    ])
    expect(parseRowOp('R_1 \\leftrightarrow R_2')).toMatchObject({ kind: 'swap', a: 0, b: 1 })
    expect(parseRowOp('r_2 - 2r_1', true)).toMatchObject({ kind: 'combine', target: 1 })
    expect(parseRowOp('R_{2} \\rightarrow \\tfrac{1}{2} R_{2}')).toMatchObject({ target: 1 })
    expect(parseRowOps('R_2 \\to R_2 - 2R_1, \\quad R_3 \\to R_3 + (-3)R_1')).toHaveLength(2)
    expect(parseRowOps('R_2 \\to R_2 \\cdot x')).toBeNull()
  })
})

describe('step recognition (HW3 style)', () => {
  it('turns operation sentences followed by a matrix into numbered steps', () => {
    const found = steps(HW3)
    expect(found).toHaveLength(3)
    expect(found.map((step) => step.number)).toEqual([1, 2, 3])
    expect(found[0]!.changedRows).toEqual([1, 2])
    expect(found[0]!.mismatches).toEqual([])
    // A sentence that explains more than the operation is kept as the intro.
    expect(found[1]!.intro).toContain('第二列下方还要消去')
    expect(found[0]!.intro).toBeUndefined()
    // The text around the steps stays, without the consumed lines.
    const rest = splitSteps(HW3)
      .filter((chunk) => chunk.kind === 'text')
      .map((chunk) => (chunk.kind === 'text' ? chunk.text : ''))
      .join('\n')
    expect(rest).toContain('写出增广矩阵')
    expect(rest).toContain('所以方程组相容')
    expect(rest).not.toContain('R_3 \\to R_3 - 2R_2')
  })

  it('computes every changed entry with exact fractions', () => {
    const op = parseRowOp('R_3 \\to R_3 - 3R_1 - 2R_2')!
    const before = [
      [r(1), r(2), r(1, 2)],
      [r(0), r(1), r(1, 3)],
      [r(3), r(1), r(2)],
    ]
    const applied = applyRowOps(before, [op], 'together')!
    expect(applied.matrix[2]!.map(text)).toEqual(['0', '-7', '-1/6'])
    const origin = applied.provenance[2]!
    expect(entryArithmetic(origin, 1, applied.matrix[2]![1]!).latex).toBe(
      '1 - 3\\cdot 2 - 2\\cdot 1 = -7',
    )
    expect(entryArithmetic(origin, 2, applied.matrix[2]![2]!).text).toBe('2 − 3·1/2 − 2·1/3 = −1/6')
    const scaled = applyRowOps(before, [parseRowOp('R_2 \\to -\\frac{1}{3}R_2')!], 'together')!
    expect(entryArithmetic(scaled.provenance[1]!, 2, scaled.matrix[1]![2]!).latex).toBe(
      '-\\tfrac{1}{3}\\cdot \\tfrac{1}{3} = -\\tfrac{1}{9}',
    )
  })

  it('flags a written entry that disagrees, with the correct value', () => {
    const wrong = HW3.replace('0 & 0 & -1 & -4', '0 & 0 & -1 & -5')
    const step = steps(wrong)[1]!
    expect(step.mismatches).toHaveLength(1)
    expect(step.mismatches[0]).toMatchObject({ row: 2, col: 3 })
    expect(text(step.mismatches[0]!.expected)).toBe('-4')
    expect(text(step.mismatches[0]!.written)).toBe('-5')
  })

  it('reads chains with labelled arrows', () => {
    const chain =
      '$$\\begin{bmatrix} 1 & 2 \\\\ 3 & 4 \\end{bmatrix} \\xrightarrow{R_2 - 3R_1} \\begin{bmatrix} 1 & 2 \\\\ 0 & -2 \\end{bmatrix} \\xrightarrow{-\\frac{1}{2} R_2} \\begin{bmatrix} 1 & 2 \\\\ 0 & 1 \\end{bmatrix}$$'
    const found = steps(chain)
    expect(found).toHaveLength(2)
    expect(found.every((step) => step.mismatches.length === 0)).toBe(true)
  })

  it('leaves what it cannot read as text, without flags', () => {
    // An operation described in words changes a row the formula does not name.
    const words = HW3.replace(
      '作 $R_2 \\to -\\frac{1}{3}R_2$：',
      '作 $R_3 \\to R_3$ 并把第二行除以 $-3$：',
    )
    const result = splitSteps(words)
    expect(result.filter((chunk) => chunk.kind === 'step')).toHaveLength(2)
    expect(result.map((chunk) => (chunk.kind === 'text' ? chunk.text : '')).join('')).toContain(
      '并把第二行除以',
    )
    // A matrix with a symbolic entry, or an unreadable operation, is plain text.
    expect(
      steps(HW3.replace('0 & -3 & 1 & -2 \\\\ 0 & -6', '0 & a & 1 & -2 \\\\ 0 & -6')),
    ).toHaveLength(1)
    expect(
      steps('作 $R_2 \\to R_2 \\cdot x$：\n\n$$\\begin{bmatrix}1&2\\\\3&4\\end{bmatrix}$$'),
    ).toEqual([])
    expect(splitSteps('no matrices here').map((chunk) => chunk.kind)).toEqual(['text'])
  })
})

describe('display transforms', () => {
  it('uses full-size fractions inside matrices only', async () => {
    const { dfracInMatrices } = await import('@/entities/homework/walkthroughFormat')
    const text = String.raw`$\frac12$ and $$\begin{bmatrix} \frac{1}{2} & \tfrac{3}{4} \\ 1 & 2 \end{bmatrix}$$`
    expect(dfracInMatrices(text)).toBe(
      String.raw`$\frac12$ and $$\begin{bmatrix} \dfrac{1}{2} & \dfrac{3}{4} \\ 1 & 2 \end{bmatrix}$$`,
    )
  })

  it('bolds a term only at its first occurrence, never touching results', async () => {
    const { dedupeBoldTerms } = await import('@/entities/homework/walkthroughFormat')
    expect(dedupeBoldTerms('**pivot** here, **pivot** again, **x = 2** and **x = 2**')).toBe(
      'pivot here, pivot again, **x = 2** and **x = 2**'.replace('pivot here', '**pivot** here'),
    )
  })

  it('reads each sub-part answer from a conclusion', async () => {
    const { conclusionByPart } = await import('@/entities/homework/walkthroughFormat')
    const map = conclusionByPart('(a)(b) no solution; (c) infinitely many solutions')
    expect(map.get('a')).toBe('no solution')
    expect(map.get('b')).toBe('no solution')
    expect(map.get('c')).toBe('infinitely many solutions')
  })
})
