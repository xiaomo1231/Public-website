/**
 * Deterministic, realistic inputs for the token-usage harness: textbook
 * passages, a linear-algebra homework (one question with four sub-parts), a
 * worked walkthrough in Chinese with LaTeX, and conversation histories.
 * Sizes follow the app's own limits (chunks ≤ 800 chars, …).
 */

const LA_SENTENCES = [
  'A system of linear equations is consistent if it has at least one solution; otherwise it is inconsistent.',
  'Elementary row operations replace a row by the sum of itself and a multiple of another row, interchange two rows, or multiply a row by a nonzero constant.',
  'Two matrices are row equivalent if there is a sequence of elementary row operations that transforms one matrix into the other.',
  'The reduced echelon form of a matrix is unique: each matrix is row equivalent to one and only one reduced echelon matrix.',
  'A pivot position in a matrix A is a location in A that corresponds to a leading 1 in the reduced echelon form of A.',
  'The variables corresponding to pivot columns are called basic variables; the other variables are called free variables.',
  'If a linear system is consistent, then the solution set contains either a unique solution, when there are no free variables, or infinitely many solutions, when there is at least one free variable.',
  'The equation $A\\mathbf{x} = \\mathbf{b}$ has a solution if and only if $\\mathbf{b}$ is a linear combination of the columns of $A$.',
  'A set of vectors $\\{\\mathbf{v}_1, \\dots, \\mathbf{v}_p\\}$ in $\\mathbb{R}^n$ is linearly independent if the vector equation $x_1\\mathbf{v}_1 + \\dots + x_p\\mathbf{v}_p = \\mathbf{0}$ has only the trivial solution.',
  'Example: row reduce the augmented matrix $\\begin{bmatrix} 1 & -2 & 1 & 0 \\\\ 0 & 2 & -8 & 8 \\\\ 5 & 0 & -5 & 10 \\end{bmatrix}$ to echelon form.',
]

const BIO_SENTENCES = [
  'The plasma membrane is a phospholipid bilayer in which proteins are embedded; it controls the passage of substances into and out of the cell.',
  'Facilitated diffusion moves solutes down their concentration gradient through channel or carrier proteins without the expenditure of ATP.',
  'The sodium-potassium pump uses the energy of one ATP to export three Na+ ions and import two K+ ions, creating an electrochemical gradient.',
  'Glycolysis occurs in the cytosol and splits one glucose molecule into two pyruvate, yielding a net gain of two ATP and two NADH.',
  'In the citric acid cycle, acetyl CoA is oxidized to carbon dioxide while NAD+ and FAD are reduced to NADH and FADH2.',
  'Oxidative phosphorylation couples electron transport along the inner mitochondrial membrane to ATP synthesis by chemiosmosis.',
  'Enzymes lower the activation energy of a reaction; competitive inhibitors bind the active site, whereas noncompetitive inhibitors bind elsewhere.',
  'During mitosis the replicated chromosomes condense, align at the metaphase plate, and the sister chromatids separate in anaphase.',
]

/** One ~700-char passage, varied by `seed`. */
function passage(sentences: string[], seed: number): string {
  const out: string[] = []
  let i = seed
  let length = 0
  while (length < 700) {
    const sentence = sentences[i % sentences.length]!
    out.push(sentence)
    length += sentence.length + 1
    i += 3
  }
  return out.join(' ')
}

export const laPassages = Array.from({ length: 40 }, (_, i) => passage(LA_SENTENCES, i))
export const bioPassages = Array.from({ length: 40 }, (_, i) => passage(BIO_SENTENCES, i))

/** `[chunk:<uuid> · doc · pN]` snippets as `formatSnippetForPrompt` prints them. */
export function chunkSnippet(
  index: number,
  text: string,
  documentName = 'Lay - Linear Algebra.pdf',
) {
  const id = `0f8e${String(index).padStart(4, '0')}-6a1b-4c2d-9e3f-a1b2c3d4e5f6`
  return `[chunk:${id} · ${documentName} · p${12 + index}]\n${text}`
}

export const HOMEWORK_QUESTIONS = [
  {
    label: '第 1 题',
    prompt:
      'Problem 1. Consider the linear system\n$$\\begin{aligned} x_1 + 2x_2 - x_3 &= 4 \\\\ 2x_1 + 5x_2 + x_3 &= 9 \\\\ x_1 + 3x_2 + 2x_3 &= 5 \\end{aligned}$$\nWrite the augmented matrix, reduce it to reduced row echelon form, and describe the solution set in parametric vector form.',
  },
  {
    label: '第 2 题',
    prompt:
      'Problem 2. Let $\\mathbf{v}_1 = (1, 2, 0)$, $\\mathbf{v}_2 = (0, 1, 3)$, $\\mathbf{v}_3 = (2, 3, -3)$.\n(a) Determine whether $\\{\\mathbf{v}_1, \\mathbf{v}_2, \\mathbf{v}_3\\}$ is linearly independent.\n(b) Find a basis for $\\operatorname{Span}\\{\\mathbf{v}_1, \\mathbf{v}_2, \\mathbf{v}_3\\}$.\n(c) Is $\\mathbf{b} = (1, 4, 6)$ in the span? Justify your answer by row reduction.\n(d) Describe geometrically the span you found in (b).',
  },
  {
    label: '第 3 题',
    prompt:
      'Problem 3. For which values of $h$ and $k$ is the system $x_1 + h x_2 = 2$, $4x_1 + 8x_2 = k$ (i) inconsistent, (ii) uniquely solvable, (iii) solvable with infinitely many solutions? Explain using the echelon form of the augmented matrix.',
  },
]

/** The page the questions were read from (grounded source passages). */
export const HOMEWORK_PAGE = `[c:p1 · p1]\nMATH 221 — Homework 4 (due Friday)\n\n${HOMEWORK_QUESTIONS.map((q) => q.prompt).join('\n\n')}\n\nShow all row operations. Answers without work receive no credit.`

const WORKED_STEP = [
  '### 第 1 步：写出增广矩阵',
  '把系数和常数项按列对齐：',
  '$$\\left[\\begin{array}{ccc|c} 1 & 2 & -1 & 4 \\\\ 2 & 5 & 1 & 9 \\\\ 1 & 3 & 2 & 5 \\end{array}\\right]$$',
  '作 $R_2 \\to R_2 - 2R_1$，$R_3 \\to R_3 - R_1$：',
  '$$\\left[\\begin{array}{ccc|c} 1 & 2 & -1 & 4 \\\\ 0 & 1 & 3 & 1 \\\\ 0 & 1 & 3 & 1 \\end{array}\\right]$$',
  '第二行与第三行相同，说明有一个方程是多余的，因此存在**自由变量**。',
  '作 $R_3 \\to R_3 - R_2$，$R_1 \\to R_1 - 2R_2$ 得到**行最简形**（RREF）：',
  '$$\\left[\\begin{array}{ccc|c} 1 & 0 & -7 & 2 \\\\ 0 & 1 & 3 & 1 \\\\ 0 & 0 & 0 & 0 \\end{array}\\right]$$',
  '主元列是第 1、2 列，所以 $x_1, x_2$ 是基本变量，$x_3$ 是自由变量。',
].join('\n')

/** A worked section body of about `steps` × 600 chars. */
export function workedBody(steps: number): string {
  return Array.from({ length: steps }, (_, i) =>
    WORKED_STEP.replace('第 1 步', `第 ${i + 1} 步`),
  ).join('\n\n')
}

export const CONCLUSION =
  '方程组有无穷多解：$\\mathbf{x} = \\begin{bmatrix} 2 \\\\ 1 \\\\ 0 \\end{bmatrix} + t\\begin{bmatrix} 7 \\\\ -3 \\\\ 1 \\end{bmatrix}$，$t \\in \\mathbb{R}$。'

export const PROFESSOR_ANSWER =
  'Row reduce: R2 - 2R1, R3 - R1, then R3 - R2 gives a zero row. RREF [1 0 -7 | 2; 0 1 3 | 1; 0 0 0 | 0]. x3 free: x = (2, 1, 0) + t(7, -3, 1).'

export const PREVIOUS_SOLUTION = `Hints and full solution: ${workedBody(2)}`

export const STUDENT_ANSWER =
  'I wrote the augmented matrix and did R2-2R1 and R3-R1, then R3-R2. I get x3 free and x1 = 2 + 7t, x2 = 1 - 3t, x3 = t.'

export const QA_HISTORY = [
  { role: 'student' as const, content: '为什么第二行和第三行相同就说明有自由变量？' },
  {
    role: 'assistant' as const,
    content:
      '两行相同意味着其中一个方程可以由另一个推出，消元后会出现一整行 0。三个未知数只剩两个独立方程，所以有一个变量不受约束，它就是自由变量。',
  },
  { role: 'student' as const, content: '那参数向量形式怎么写？' },
  {
    role: 'assistant' as const,
    content:
      '把基本变量用自由变量表示：$x_1 = 2 + 7t$，$x_2 = 1 - 3t$，$x_3 = t$，再把它们写成向量 $\\mathbf{x} = (2,1,0) + t(7,-3,1)$。',
  },
]

export const ASK_HISTORY = Array.from({ length: 6 }, (_, i) => ({
  question: `第 ${i + 1} 个追问：这里的 $R_${(i % 3) + 1}$ 为什么要减去 $2R_1$？`,
  answer: `${workedBody(1).slice(0, 900)}（第 ${i + 1} 轮回答）`,
}))

export const VOCAB_TERMS = Array.from({ length: 40 }, (_, i) => ({
  word: ['phospholipid', 'chemiosmosis', 'glycolysis', 'anaphase', 'inhibitor'][i % 5]! + i,
  sentence: BIO_SENTENCES[i % BIO_SENTENCES.length]!.slice(0, 200),
}))
