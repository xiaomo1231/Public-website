import { splitMathSegments } from '@/shared/lib/mathText'

/**
 * A cheap, deterministic gate that decides whether a lesson is worth a second
 * AI call for a 2D graph.
 *
 * Visualizations are optional: most lessons (set theory, proofs, definitions)
 * have nothing to plot. Calling the model for every lesson would spend tokens
 * for a guaranteed empty answer, so this local check runs first. It is
 * deliberately permissive — a false positive only costs one small JSON call,
 * while a false negative merely means no graph.
 */

/** Lowercase `x` or `y` as a standalone variable, not part of a word. */
const VARIABLE = /(?<![A-Za-z])[xy](?![A-Za-z])/
/** A relation, either literal (`= < >`) or as LaTeX (`\le \ge \lt \gt`). */
const RELATION = /[=<>]|\\(?:l|g)(?:e|eq|t)(?![a-zA-Z])/
/**
 * A function-of-x form that may warrant a nonlinear graph (Phase 2): a named
 * function, a power of x, or a power of e. Deliberately permissive — the gate
 * only decides whether a second AI call is worth making; the local parser and
 * normaliser make the real decision.
 */
const FUNCTION_HINT =
  /\\(?:sin|cos|tan|exp|ln|log|sqrt)|(?<![A-Za-z])(?:sin|cos|exp|ln|log|sqrt)\s*\(|(?<![A-Za-z])x\s*(?:\^|²)|(?<![A-Za-z])e\s*\^/
const COORDINATE_PAIR = /\(\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*\)/g

/**
 * Linear-algebra / discrete-math topics are named in prose rather than in a
 * formula, so they need a separate, *clustered* signal: a single ambiguous word
 * ("edge", "graph") must not trigger a second AI call on its own.
 */
function looksLikeVectorText(text: string): boolean {
  const hasVector = /(?:\bvectors?\b|向量)/i.test(text)
  const hasContext =
    /(?:\baddition\b|\bsum\b|\bscalar\b|\blinear combination\b|\bbasis\b|\bcomponent form\b|\bcomponents?\b|加法|标量|线性组合|基向量|分量)/i.test(
      text,
    )
  return hasVector && hasContext
}

function looksLikeGraphText(text: string): boolean {
  const hasGraphWord = /(?:\bgraphs?\b|\bdigraph\b|图)/i.test(text)
  const hasStructure =
    /(?:\bvertex\b|\bvertices\b|\bnodes?\b|\bedges?\b|\bself-loop\b|顶点|节点|边)/i.test(text)
  const hasGraphType =
    /(?:directed|undirected|bipartite|weighted graph|有向图|无向图|二分图|带权图)/i.test(text)
  const hasTree = /(?:\btrees?\b|\broot node\b|\broot\b|树|根节点)/i.test(text)
  return (hasGraphWord && hasStructure) || hasGraphType || hasTree
}

/** Strong signals that a lesson is about a 2D linear transformation. */
function looksLikeTransformText(text: string): boolean {
  return /(?:linear transformation|matrix transformation|matrix times vector|rotation matrix|reflection matrix|shear(?:ing)?|determinant|area scaling|basis transformation|线性变换|矩阵变换|矩阵乘向量|旋转矩阵|反射矩阵|剪切|行列式|面积缩放|基向量变换)/i.test(
    text,
  )
}

/** Strong signals that a lesson is about eigenvalues / eigenvectors. */
function looksLikeEigenText(text: string): boolean {
  return /(?:\beigenvalues?\b|\beigenvectors?\b|\beigenspace\b|特征值|特征向量|特征空间|特征方程)/i.test(
    text,
  )
}

function looksLikeHasseText(text: string): boolean {
  return /(?:\bHasse diagram\b|\bpartial order\b|\bpartially ordered set\b|\bposet\b|Hasse 图|偏序集|偏序关系)/i.test(text)
}

/** A named probability distribution (the parameters are checked later). */
function looksLikeDistributionText(text: string): boolean {
  return /(?:normal distribution|gaussian|binomial distribution|poisson distribution|uniform distribution|exponential distribution|t[- ]distribution|student'?s t|chi-square|χ²|\bF[- ]distribution|goodness of fit|t\s*分布|卡方|F\s*分布|拟合优度|\\sim\s*(?:N|B|\\mathcal\{N\}|\\operatorname\{(?:Bin|Poisson|Exp)\})\s*\(|正态分布|二项分布|泊松分布|均匀分布|指数分布)/i.test(
    text,
  )
}

/** A set operation only counts when a set context is present (English). */
function looksLikeVennText(text: string): boolean {
  if (/(?:venn diagram|维恩图|文氏图)/i.test(text)) return true
  // Chinese set-operation terms are unambiguous on their own.
  if (/(?:并集|交集|差集|对称差|补集)/.test(text)) return true
  const hasSet = /(?:\bsets?\b|集合|子集|全集)/i.test(text)
  const hasEnglishOperation =
    /(?:\bunion\b|\bintersection\b|\bdifference\b|symmetric difference|\bcomplement\b)/i.test(text)
  return hasSet && hasEnglishOperation
}

/** Structures, energy profiles or titrations (chemistry courses only). */
export function looksLikeChemistryFigureText(text: string): boolean {
  return /(?:\bSMILES\b|polyprotic|weak base|多元酸|弱碱|structural formula|skeletal formula|functional group|energy (?:profile|diagram)|activation energy|enthalpy change|transition state|titration|equivalence point|结构式|结构简式|分子结构|官能团|能量图|能量变化图|活化能|反应热|焓变|过渡态|滴定|计量点|等当点)/i.test(
    text,
  )
}

/** Crosses, pedigrees or the central dogma (biology courses only). */
export function looksLikeBiologyFigureText(text: string): boolean {
  if (/(?<![A-Z])[ACGT]{9,}(?![A-Z])/.test(text)) return true
  return /(?:Punnett|genotypes?|phenotypes?|monohybrid|dihybrid|pedigree|\bcodons?\b|\bmRNA\b|transcription|X-linked|sex-linked|multiple alleles|codominan|chi-square|goodness of fit|棋盘法|基因型|表现型|杂交|系谱|家系|遗传病|转录|翻译|密码子|伴性|X\s*连锁|复等位|血型|共显性|卡方|拟合优度)/i.test(
    text,
  )
}

/** Forces, motion, optics or circuits (physics courses). */
export function looksLikePhysicsFigureText(text: string): boolean {
  return /(?:free-body|net force|\bforces?\b|incline|friction|velocity|acceleration|displacement|kinematics|\blens\b|\bmirror\b|focal length|resistors?|\bcircuit|Ohm|series|parallel|受力|合力|斜面|摩擦力|支持力|拉力|速度|加速度|位移|匀变速|运动学|透镜|面镜|焦距|物距|像距|电阻|电路|串联|并联|欧姆)/i.test(text)
}

/** Derivatives, integrals or series (calculus courses). */
export function looksLikeCalculusFigureText(text: string): boolean {
  return /(?:derivative|tangent line|differentiat|integral|Riemann|Taylor|Maclaurin|导数|切线|微分|积分|黎曼|泰勒|麦克劳林)/i.test(text)
}

/** Regression or interval estimation. */
export function looksLikeRegressionText(text: string): boolean {
  return /(?:regression|least squares|correlation coefficient|confidence interval|scatter plot|calibration curve|回归|最小二乘|相关系数|置信区间|散点图|标准曲线)/i.test(text)
}

/** Rate laws and the Arrhenius equation. */
export function looksLikeKineticsText(text: string): boolean {
  return /(?:rate law|rate constant|half-life|reaction order|first-order|second-order|zero-order|Arrhenius|速率方程|速率常数|半衰期|反应级数|一级反应|二级反应|零级反应|阿伦尼乌斯)/i.test(text)
}

/** Enzyme kinetics. */
export function looksLikeEnzymeText(text: string): boolean {
  return /(?:Michaelis|Lineweaver|enzyme kinetics|\bK_?m\b|V_?max|inhibit|米氏|酶动力学|酶促反应|双倒数|抑制剂|竞争性抑制)/i.test(text)
}

/** Population growth models. */
export function looksLikePopulationText(text: string): boolean {
  return /(?:population growth|logistic growth|carrying capacity|exponential growth|种群增长|逻辑斯谛|环境容纳量|指数增长|J\s*型|S\s*型曲线)/i.test(text)
}

/** Sorting algorithms and binary search trees. */
export function looksLikeAlgorithmText(text: string): boolean {
  return /(?:\bsort(?:ing)?\b|quicksort|merge sort|binary search tree|\bBST\b|traversal|in-?order|排序|冒泡|快速排序|归并|二叉搜索树|二叉排序树|遍历)/i.test(text)
}

/**
 * A formula worth exploring: some maths segment states a relation between
 * named quantities (`F = ma`, `x(t) = A\cos(\omega t)`). Used only for the
 * science subjects, where such formulas are the substance of a lesson.
 */
export function looksLikeFormulaText(markdown: string): boolean {
  for (const segment of splitMathSegments(markdown)) {
    if (segment.kind !== 'math' || !segment.value.includes('=')) continue
    const symbols = new Set(segment.value.replace(/\\[a-zA-Z]+/g, ' ').match(/[A-Za-z]/g) ?? [])
    if (symbols.size >= 2) return true
  }
  return false
}

export function hasGraphableMath(markdown: string): boolean {
  if (!markdown) return false

  for (const segment of splitMathSegments(markdown)) {
    if (segment.kind !== 'math') continue
    if (RELATION.test(segment.value) && VARIABLE.test(segment.value)) return true
    if (FUNCTION_HINT.test(segment.value) && VARIABLE.test(segment.value)) return true
  }

  const pairs = markdown.match(COORDINATE_PAIR)
  if (pairs !== null && pairs.length >= 2) return true

  return (
    looksLikeVectorText(markdown) ||
    looksLikeGraphText(markdown) ||
    looksLikeTransformText(markdown) ||
    looksLikeVennText(markdown) ||
    looksLikeEigenText(markdown) ||
    looksLikeHasseText(markdown) ||
    looksLikeDistributionText(markdown)
  )
}
