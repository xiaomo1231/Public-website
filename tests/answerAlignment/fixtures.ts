/**
 * Synthetic answer-key layouts for the 小题 ⇄ 教授答案 alignment
 * (`entities/homework/professorMap.ts`). Every text here is written for the
 * tests; none is copied from course material. See README.md for the list of
 * layout families.
 *
 * `local`: what the deterministic pass must say per sub-part —
 *   `direct` (a labelled worked solution), `none` (the key defers it) or
 *   `unsure` (not located; the AI decides).
 * `truth`: the real coverage per sub-part (for precision / recall).
 * `reply` + `final`: a realistic AI reply (sometimes wrong) and what must be
 *   left after local validation; `confirm`: sub-parts that must be shown as
 *   「请确认」.
 */
export type Coverage = 'direct' | 'indirect' | 'none'
export type LocalCoverage = 'direct' | 'none' | 'unsure'

export interface AlignmentFixture {
  name: string
  family: string
  question: string
  answer: string
  local: Record<string, LocalCoverage>
  truth: Record<string, Coverage>
  /** Labels whose local entry must be marked misplaced / shared / keyLabel. */
  misplaced?: string[]
  shared?: string[]
  reply?: Array<{ label: string; coverage: string; quotes: string[]; note?: string }>
  final?: Record<string, Coverage>
  confirm?: string[]
}

const Q_ABC = [
  'Let U be the set of all (x, y, z) in R^3 with x - 2y + z = 0.',
  '(a) Show that U is a subspace of R^3.',
  '(b) Find a basis of U.',
  '(c) What is the dimension of U?',
].join('\n')

export const FIXTURES: AlignmentFixture[] = [
  {
    name: 'solution of (a) written under the heading of (b)',
    family: 'misplaced',
    question: Q_ABC,
    answer: [
      'Let U be the set of all (x, y, z) in R^3 with x - 2y + z = 0.',
      '(a) Show that U is a subspace of R^3.',
      '(b) Find a basis of U.',
      'Solution: Solving x = 2y - z gives two free variables y and z.',
      '(a) The set U is the solution set of one homogeneous equation, so U = span{(2, 1, 0), (-1, 0, 1)} and therefore U is a subspace.',
      '(b) The vectors (2, 1, 0) and (-1, 0, 1) are independent and span U, so they form a basis.',
      '(c) What is the dimension of U?',
      'Solution: The basis has two vectors, so dim U = 2.',
    ].join('\n'),
    local: { a: 'direct', b: 'direct', c: 'direct' },
    truth: { a: 'direct', b: 'direct', c: 'direct' },
    misplaced: ['a'],
    reply: [
      {
        label: 'a',
        coverage: 'indirect',
        quotes: ['(a) The set U is the solution set of one homogeneous equation'],
      },
      {
        label: 'b',
        coverage: 'direct',
        quotes: ['are independent and span U, so they form a basis'],
      },
      { label: 'c', coverage: 'direct', quotes: ['The basis has two vectors, so dim U = 2.'] },
    ],
    final: { a: 'direct', b: 'direct', c: 'direct' },
    confirm: ['a'],
  },
  {
    name: 'the same sub-part solved twice ("Method 1 / Method 2")',
    family: 'several-ways',
    question: Q_ABC,
    answer: [
      '(a) Method 1: U is the kernel of the linear map (x, y, z) -> x - 2y + z, hence a subspace.',
      'Method 2: If u and v satisfy the equation then so do u + v and cu, and 0 is in U.',
      '(b) A basis is {(2, 1, 0), (-1, 0, 1)}.',
      '(c) dim U = 2.',
    ].join('\n'),
    local: { a: 'direct', b: 'direct', c: 'direct' },
    truth: { a: 'direct', b: 'direct', c: 'direct' },
  },
  {
    name: 'nested labels that really are two ways of the same sub-part',
    family: 'several-ways',
    question: Q_ABC,
    answer: [
      'Let U be the set of all (x, y, z) in R^3 with x - 2y + z = 0.',
      '(a) Show that U is a subspace of R^3.',
      'Solution: U is the kernel of a linear map, hence a subspace.',
      '(b) Find a basis of U.',
      'Solution: We give two ways.',
      '(a) Parametrise: x = 2s - t, y = s, z = t, so a basis is {(2, 1, 0), (-1, 0, 1)}.',
      '(b) Alternatively pick two independent solutions, e.g. (1, 1, 1) and (2, 1, 0); they form a basis.',
      '(c) What is the dimension of U?',
      'Solution: dim U = 2.',
    ].join('\n'),
    local: { a: 'direct', b: 'direct', c: 'direct' },
    truth: { a: 'direct', b: 'direct', c: 'direct' },
    reply: [
      {
        label: 'a',
        coverage: 'direct',
        quotes: ['U is the kernel of a linear map, hence a subspace.'],
      },
      {
        label: 'b',
        coverage: 'direct',
        quotes: [
          '(a) Parametrise: x = 2s - t, y = s, z = t',
          '(b) Alternatively pick two independent solutions',
        ],
      },
      { label: 'c', coverage: 'direct', quotes: ['dim U = 2.'] },
    ],
    final: { a: 'direct', b: 'direct', c: 'direct' },
    confirm: ['b'],
  },
  {
    name: 'one block answers two sub-parts',
    family: 'shared',
    question: Q_ABC,
    answer: [
      '(a) and (b): Writing x = 2y - z shows U = span{(2, 1, 0), (-1, 0, 1)}; a span is a subspace and these two vectors are independent, so they are a basis.',
      '(c) Two basis vectors, so the dimension is 2.',
    ].join('\n'),
    local: { a: 'direct', b: 'direct', c: 'direct' },
    truth: { a: 'direct', b: 'direct', c: 'direct' },
    shared: ['a', 'b'],
  },
  {
    name: 'a range of sub-parts in one block',
    family: 'shared',
    question: [
      'Decide for each matrix whether it is invertible.',
      '(a) A = [[1, 2], [2, 4]]',
      '(b) B = [[1, 0], [0, 3]]',
      '(c) C = [[0, 1], [1, 0]]',
      '(d) D = [[2, 2], [1, 1]]',
    ].join('\n'),
    answer: [
      '(a) det A = 0, so A is not invertible.',
      '(b)–(d) Compute each determinant: det B = 3, det C = -1, det D = 0. Hence B and C are invertible and D is not.',
    ].join('\n'),
    local: { a: 'direct', b: 'direct', c: 'direct', d: 'direct' },
    truth: { a: 'direct', b: 'direct', c: 'direct', d: 'direct' },
    shared: ['b', 'c', 'd'],
  },
  {
    name: 'sub-parts answered out of order (no restated headings)',
    family: 'out-of-order',
    question: Q_ABC,
    answer: [
      '(b) Basis: {(2, 1, 0), (-1, 0, 1)}.',
      '(a) It is the null space of [1 -2 1], so it is a subspace.',
      '(c) dim U = 2 because the basis in (b) has two vectors.',
    ].join('\n'),
    local: { a: 'direct', b: 'direct', c: 'direct' },
    truth: { a: 'direct', b: 'direct', c: 'direct' },
  },
  {
    name: 'a sub-part established only by another one’s work',
    family: 'indirect',
    question: Q_ABC,
    answer: [
      '(b) Solving x = 2y - z, every vector of U is y(2, 1, 0) + z(-1, 0, 1), so U = span{(2, 1, 0), (-1, 0, 1)} and the two vectors form a basis.',
      '(c) dim U = 2.',
    ].join('\n'),
    local: { a: 'unsure', b: 'direct', c: 'direct' },
    truth: { a: 'indirect', b: 'direct', c: 'direct' },
    reply: [
      {
        label: 'a',
        coverage: 'indirect',
        quotes: ['so U = span{(2, 1, 0), (-1, 0, 1)}'],
        note: 'A span is a subspace.',
      },
      { label: 'b', coverage: 'direct', quotes: ['the two vectors form a basis'] },
      { label: 'c', coverage: 'direct', quotes: ['dim U = 2.'] },
    ],
    final: { a: 'indirect', b: 'direct', c: 'direct' },
    confirm: ['a'],
  },
  {
    name: '"same as part (x)" and a reference to a part that does not exist',
    family: 'reference',
    question: [
      'Let v1 = (1, 0), v2 = (1, 1) and v3 = (0, 1).',
      '(a) Show that {v1, v2} is a basis of R^2.',
      '(b) Show that {v2, v1} is a basis of R^2.',
      '(c) Show that {v1, v3} is a basis of R^2.',
    ].join('\n'),
    answer: [
      '(a) The matrix [v1 v2] has determinant 1, so the vectors are independent and span R^2.',
      '(b) This is the same as part (f): the order of the vectors does not matter.',
      '(c) Same as part (a): det [v1 v3] = 1.',
    ].join('\n'),
    local: { a: 'direct', b: 'direct', c: 'direct' },
    truth: { a: 'direct', b: 'direct', c: 'direct' },
    reply: [
      {
        label: 'a',
        coverage: 'direct',
        quotes: ['has determinant 1, so the vectors are independent'],
      },
      {
        label: 'b',
        coverage: 'direct',
        quotes: ['This is the same as part (f)'],
        note: '(f) is a typo for (a).',
      },
      { label: 'c', coverage: 'direct', quotes: ['Same as part (a): det [v1 v3] = 1.'] },
    ],
    final: { a: 'direct', b: 'direct', c: 'direct' },
    confirm: ['b'],
  },
  {
    name: 'key numbers what the question letters',
    family: 'numbering',
    question: Q_ABC,
    answer: [
      '1. U is the kernel of a linear map, so it is a subspace.',
      '2. A basis is {(2, 1, 0), (-1, 0, 1)}.',
      '3. The dimension is 2.',
    ].join('\n'),
    local: { a: 'direct', b: 'direct', c: 'direct' },
    truth: { a: 'direct', b: 'direct', c: 'direct' },
  },
  {
    name: 'roman numerals for lettered sub-parts',
    family: 'numbering',
    question: Q_ABC,
    answer: [
      'i) Closed under addition and scalar multiplication, and contains 0.',
      'ii) {(2, 1, 0), (-1, 0, 1)} is a basis.',
      'iii) dim U = 2.',
    ].join('\n'),
    local: { a: 'direct', b: 'direct', c: 'direct' },
    truth: { a: 'direct', b: 'direct', c: 'direct' },
  },
  {
    name: '"Part A / Part B / Part C"',
    family: 'numbering',
    question: Q_ABC,
    answer: [
      'Part A: The zero vector satisfies the equation, and sums and multiples do too.',
      'Part B: Free variables y and z give the basis {(2, 1, 0), (-1, 0, 1)}.',
      'Part C: Two vectors, so the dimension is 2.',
    ].join('\n'),
    local: { a: 'direct', b: 'direct', c: 'direct' },
    truth: { a: 'direct', b: 'direct', c: 'direct' },
  },
  {
    name: 'Chinese labels: full-width brackets',
    family: 'chinese',
    question: [
      '设 U 为满足 x - 2y + z = 0 的全体向量。',
      '(a) 证明 U 是子空间。',
      '(b) 求 U 的一组基。',
    ].join('\n'),
    answer: [
      '（a）U 是一个齐次方程的解集，因此是子空间。',
      '（b）基为 (2, 1, 0) 与 (-1, 0, 1)。',
    ].join('\n'),
    local: { a: 'direct', b: 'direct' },
    truth: { a: 'direct', b: 'direct' },
  },
  {
    name: 'Chinese labels: 第(1)问 and ① for numbered sub-parts',
    family: 'chinese',
    question: ['已知函数 f(x) = x^2 - 4x + 3。', '1. 求 f 的零点。', '2. 求 f 的最小值。'].join(
      '\n',
    ),
    answer: [
      '第(1)问：令 f(x) = 0，得 x = 1 或 x = 3。',
      '② 配方得 f(x) = (x - 2)^2 - 1，最小值为 -1。',
    ].join('\n'),
    local: { '1': 'direct', '2': 'direct' },
    truth: { '1': 'direct', '2': 'direct' },
  },
  {
    name: 'unlabelled answers in sequence',
    family: 'unlabelled',
    question: Q_ABC,
    answer: [
      'Solution: The equation is linear and homogeneous, so U is closed under addition and scaling.',
      'Taking y and z free, a basis is {(2, 1, 0), (-1, 0, 1)}.',
      'Hence the dimension of U equals 2.',
    ].join('\n'),
    local: { a: 'unsure', b: 'unsure', c: 'unsure' },
    truth: { a: 'direct', b: 'direct', c: 'direct' },
    reply: [
      {
        label: 'a',
        coverage: 'direct',
        quotes: [
          'The equation is linear and homogeneous, so U is closed under addition and scaling.',
        ],
      },
      { label: 'b', coverage: 'direct', quotes: ['a basis is {(2, 1, 0), (-1, 0, 1)}'] },
      { label: 'c', coverage: 'direct', quotes: ['Hence the dimension of U equals 2.'] },
    ],
    final: { a: 'direct', b: 'direct', c: 'direct' },
  },
  {
    name: 'deferrals: exercise, textbook, not graded',
    family: 'deferred',
    question: Q_ABC,
    answer: [
      '(a) This is left as an exercise.',
      '(b) See the textbook, Example 4.2.',
      '(c) Not graded.',
    ].join('\n'),
    local: { a: 'none', b: 'none', c: 'none' },
    truth: { a: 'none', b: 'none', c: 'none' },
  },
  {
    name: 'a restated question, then one solution that leaves the first parts to the student',
    family: 'deferred',
    question: [
      'Let T(x, y) = (x + y, x - y).',
      '1. Show that T is linear.',
      '2. Find the standard matrix of T.',
      '3. Is T invertible?',
    ].join('\n'),
    answer: [
      'Let T(x, y) = (x + y, x - y).',
      '1. Show that T is linear.',
      '2. Find the standard matrix of T.',
      '3. Is T invertible?',
      'Solution: The first two parts are left to you. The standard matrix [[1, 1], [1, -1]] has determinant -2, which is not 0, so T is invertible.',
    ].join('\n'),
    local: { '1': 'none', '2': 'none', '3': 'unsure' },
    truth: { '1': 'none', '2': 'none', '3': 'direct' },
    reply: [
      { label: '1', coverage: 'none', quotes: [] },
      { label: '2', coverage: 'none', quotes: [] },
      {
        label: '3',
        coverage: 'direct',
        quotes: ['has determinant -2, which is not 0, so T is invertible.'],
      },
    ],
    final: { '1': 'none', '2': 'none', '3': 'direct' },
  },
  {
    name: 'final answers only, several on one line',
    family: 'final-only',
    question: [
      'Compute.',
      '(a) 3 + 4 * 2',
      '(b) the derivative of x^3 at x = 1',
      '(c) the integral of 2x from 0 to 3',
    ].join('\n'),
    answer: ['(a) 11    (b) 3', '(c) 9'].join('\n'),
    local: { a: 'direct', b: 'direct', c: 'direct' },
    truth: { a: 'direct', b: 'direct', c: 'direct' },
  },
  {
    name: 'an extra sub-part in the key, and a sub-part the key lacks',
    family: 'extra-missing',
    question: Q_ABC,
    answer: [
      '(a) U is a kernel, hence a subspace.',
      '(b) Basis {(2, 1, 0), (-1, 0, 1)}.',
      '(d) Bonus: U is a plane through the origin.',
    ].join('\n'),
    local: { a: 'direct', b: 'direct', c: 'unsure' },
    truth: { a: 'direct', b: 'direct', c: 'none' },
    reply: [
      { label: 'a', coverage: 'direct', quotes: ['U is a kernel, hence a subspace.'] },
      { label: 'b', coverage: 'direct', quotes: ['Basis {(2, 1, 0), (-1, 0, 1)}.'] },
      { label: 'c', coverage: 'none', quotes: [] },
      { label: 'd', coverage: 'direct', quotes: ['U is a plane through the origin.'] },
    ],
    final: { a: 'direct', b: 'direct', c: 'none' },
  },
  {
    name: 'an answer that refers to an earlier problem set',
    family: 'reference',
    question: Q_ABC,
    answer: [
      '(a) As in Problem Set 3, Problem 2, a solution set of a homogeneous system is a subspace.',
      '(b) Basis {(2, 1, 0), (-1, 0, 1)}.',
      '(c) dim U = 2.',
    ].join('\n'),
    local: { a: 'direct', b: 'direct', c: 'direct' },
    truth: { a: 'direct', b: 'direct', c: 'direct' },
  },
  {
    name: 'an AI reply with invented excerpts and a wrong label',
    family: 'ai-errors',
    question: Q_ABC,
    answer: [
      '(a) U is the kernel of a linear map, so it is a subspace.',
      '(b) A basis is {(2, 1, 0), (-1, 0, 1)}.',
      '(c) The dimension is 2.',
    ].join('\n'),
    local: { a: 'direct', b: 'direct', c: 'direct' },
    truth: { a: 'direct', b: 'direct', c: 'direct' },
    reply: [
      { label: 'a', coverage: 'direct', quotes: ['U is clearly closed under every operation'] },
      { label: '(b)', coverage: 'direct', quotes: ['A basis is {(2, 1, 0), (-1, 0, 1)}.'] },
      { label: 'c', coverage: 'none', quotes: [] },
      { label: 'z', coverage: 'direct', quotes: ['The dimension is 2.'] },
    ],
    // (a): the invented excerpt is dropped ⇒ the local entry stands; (c): the
    // key labels a worked solution ⇒ restored, to confirm.
    final: { a: 'direct', b: 'direct', c: 'direct' },
    confirm: ['c'],
  },
]
