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
    looksLikeEigenText(markdown)
  )
}
