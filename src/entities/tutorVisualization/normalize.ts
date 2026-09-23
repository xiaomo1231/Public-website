import { stripThinkBlocks } from '@/infrastructure/ai/responseText'
import {
  TUTOR_VISUALIZATION_SCHEMA_VERSION,
  type TutorVisualization,
  type TutorVisualizationType,
  type VisualizationDraft,
  type VisualizationExpression,
  type VisualizationPoint,
} from './types'
import { normalizeViewport, parseRelationLatex } from './linear'
import { normalizeFunctionDomain, parseExplicitFunction } from './nonlinear'

/**
 * Turn untrusted model output into stored visualizations.
 *
 * The model is treated exactly like any other untrusted source: every field is
 * type-checked, every relation is re-parsed locally, and anything that cannot
 * be understood is dropped. A rejected visualization never rejects the lesson.
 */

const MAX_VISUALIZATIONS = 4
const MAX_EXPRESSIONS = 6
const MAX_POINTS = 40
const MAX_CAPTION_LENGTH = 300
const MAX_LABEL_LENGTH = 40
const MAX_MAGNITUDE = 1e6

const ALL_TYPES: readonly TutorVisualizationType[] = [
  'function_2d',
  'equation_2d',
  'inequality_2d',
  'points_2d',
  'table_2d',
]

const LINE_TYPES: readonly TutorVisualizationType[] = [
  'function_2d',
  'equation_2d',
  'inequality_2d',
]

export interface RejectedVisualization {
  index: number
  reason: string
}

export interface NormalizeResult {
  visualizations: TutorVisualization[]
  rejected: RejectedVisualization[]
}

type Normalized = { ok: true; value: TutorVisualization } | { ok: false; reason: string }

function sanitizeText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const cleaned = stripThinkBlocks(value)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return undefined
  return cleaned.slice(0, maxLength)
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && Math.abs(value) <= MAX_MAGNITUDE ? value : null
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) && Math.abs(parsed) <= MAX_MAGNITUDE ? parsed : null
  }
  return null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function normalizeExpressions(
  raw: unknown,
  options: { allowFunctions: boolean },
): VisualizationExpression[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const expressions: VisualizationExpression[] = []

  for (const entry of raw) {
    if (expressions.length >= MAX_EXPRESSIONS) break
    const record = asRecord(entry)
    if (!record) continue
    const rawLatex = record.latex
    if (typeof rawLatex !== 'string') continue

    const latex = stripThinkBlocks(rawLatex).trim()
    if (!latex || seen.has(latex)) continue

    const label = sanitizeText(record.label, MAX_LABEL_LENGTH)

    // Nonlinear explicit function (Phase 2): only for `function_2d`, only `=`.
    if (options.allowFunctions && typeof record.expression === 'string') {
      const parsedFunction = parseExplicitFunction(record.expression)
      const isEquality = record.relation === undefined || record.relation === '='
      if (parsedFunction && isEquality) {
        seen.add(latex)
        const domain = normalizeFunctionDomain(record.domain)
        expressions.push({
          latex,
          relation: '=',
          expression: parsedFunction.source,
          ...(label ? { label } : {}),
          ...(domain ? { domain } : {}),
        })
        continue
      }
    }

    // Linear relation (Phase 1).
    const parsed = parseRelationLatex(latex)
    if (!parsed) continue

    seen.add(latex)
    expressions.push({
      latex,
      relation: parsed.relation,
      ...(label ? { label } : {}),
    })
  }

  return expressions
}

function normalizePoints(raw: unknown): VisualizationPoint[] {
  if (!Array.isArray(raw)) return []
  const points: VisualizationPoint[] = []

  for (const entry of raw) {
    if (points.length >= MAX_POINTS) break
    const record = asRecord(entry)
    if (!record) continue
    const x = readNumber(record.x)
    const y = readNumber(record.y)
    if (x === null || y === null) continue
    const label = sanitizeText(record.label, MAX_LABEL_LENGTH)
    points.push({ x, y, ...(label ? { label } : {}) })
  }

  return points
}

function normalizeOne(raw: unknown, index: number): Normalized {
  const draft = asRecord(raw) as VisualizationDraft | null
  if (!draft) return { ok: false, reason: 'not-an-object' }

  const type = draft.type
  if (typeof type !== 'string' || !ALL_TYPES.includes(type as TutorVisualizationType)) {
    return { ok: false, reason: 'unsupported-type' }
  }

  const caption = sanitizeText(draft.caption, MAX_CAPTION_LENGTH)
  const viewport = normalizeViewport(draft.viewport)
  const base = {
    id: `${type}-${index}`,
    schemaVersion: TUTOR_VISUALIZATION_SCHEMA_VERSION,
    placement: { scope: 'lesson' as const },
    ...(caption ? { caption } : {}),
    ...(viewport ? { viewport } : {}),
  }

  if (LINE_TYPES.includes(type as TutorVisualizationType)) {
    const expressions = normalizeExpressions(draft.expressions, {
      allowFunctions: type === 'function_2d',
    })
    if (expressions.length === 0) return { ok: false, reason: 'no-valid-expressions' }
    return {
      ok: true,
      value: {
        ...base,
        type: type as 'function_2d' | 'equation_2d' | 'inequality_2d',
        expressions,
      },
    }
  }

  const points = normalizePoints(draft.points)
  if (points.length === 0) return { ok: false, reason: 'no-valid-points' }
  return {
    ok: true,
    value: {
      ...base,
      type: type as 'points_2d' | 'table_2d',
      points,
      ...(draft.connectPoints === true ? { connect: true } : {}),
    },
  }
}

function extractList(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw
  const record = asRecord(raw)
  if (record && Array.isArray(record.visualizations)) return record.visualizations
  if (record && typeof record.type === 'string') return [record]
  return []
}

export function normalizeVisualizations(
  raw: unknown,
  options: { maxVisualizations?: number } = {},
): NormalizeResult {
  const max = options.maxVisualizations ?? MAX_VISUALIZATIONS
  const list = extractList(raw)
  const visualizations: TutorVisualization[] = []
  const rejected: RejectedVisualization[] = []

  for (let index = 0; index < list.length && visualizations.length < max; index++) {
    const result = normalizeOne(list[index], index)
    if (result.ok) visualizations.push(result.value)
    else rejected.push({ index, reason: result.reason })
  }

  return { visualizations, rejected }
}
