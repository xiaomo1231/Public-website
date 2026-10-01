/**
 * Conservative cues for offering the linear-algebra study guide on a homework
 * question. A suggestion is never treated as a verdict: the learner chooses
 * the method, and unsupported questions keep the existing walkthrough.
 */
export const LINEAR_ALGEBRA_METHODS = [
  'span',
  'independence',
  'subspace',
  'vectorForm',
  'linearSystem',
  'flow',
] as const

export type LinearAlgebraMethod = (typeof LINEAR_ALGEBRA_METHODS)[number]

const CUES: ReadonlyArray<[LinearAlgebraMethod, RegExp]> = [
  [
    'subspace',
    /\bsubspace\b|子空间|加法封闭|数乘封闭|closed under (?:addition|scalar multiplication)/i,
  ],
  [
    'independence',
    /linear(?:ly)?\s+(?:in)?dependen|线性无关|线性相关|nontrivial solution|trivial solution/i,
  ],
  ['span', /\bspan\b|张成|线性组合|linear combination/i],
  ['vectorForm', /vector (?:form|equation)|向量形式|向量方程/i],
  ['flow', /flow.balance|inflow|outflow|流量守恒|流入|流出/i],
  ['linearSystem', /linear system|system of linear equations|线性方程组/i],
]

export function suggestLinearAlgebraMethod(prompt: string): LinearAlgebraMethod | null {
  for (const [method, cue] of CUES) {
    if (cue.test(prompt)) return method
  }
  return null
}
