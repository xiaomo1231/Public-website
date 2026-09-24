/**
 * v2 visualization-generator prompt.
 *
 * Same second, small structured-JSON call as v1, extended for Phase 3.0:
 * `vectors_2d` (linear algebra) and `graph_2d` (discrete mathematics).
 *
 * v1 is kept unchanged. The registry points new requests at v2. The model still
 * returns *semantics only* — vector components, nodes and edges — and never
 * coordinates, SVG, HTML, JavaScript, CSS or colours; all geometry is computed
 * locally.
 */

import type { VisualizationDraftOutput } from '@/entities/tutorVisualization/types'
import { securityFooter, untrustedContentWrapper } from '../security'

export const VERSION = 'v2' as const
export const PROMPT_KIND = 'visualization-generator' as const

export interface VisualizationInput {
  topicName: string
  topicDescription: string
  language: 'zh' | 'en' | 'mixed'
  /** The finished lesson Markdown + LaTeX. */
  lessonContent: string
}

export type VisualizationOutput = VisualizationDraftOutput

export function buildSystemPrompt(): string {
  return [
    'You decide whether a 2D diagram would genuinely help a university STEM student understand a lesson, and if so you describe that diagram as STRUCTURED DATA.',
    '',
    'Output strictly valid JSON — no prose, no markdown fences, no comments.',
    'You must NEVER output SVG, HTML, JavaScript, CSS, colours, coordinates or any executable content. Only the JSON shape below.',
    '',
    'A visualization is OPTIONAL. Only include one when a picture makes the mathematics clearer. If nothing benefits, return { "visualizations": [] }. Never invent a diagram to fill space.',
    '',
    'SUPPORTED MATHEMATICS:',
    '  - `function_2d` may describe EITHER a linear relation OR one explicit nonlinear function of x.',
    '  - Linear relations in x and y (degree at most 1): numbers, + - * /, parentheses, simple fractions like \\frac{1}{2}, and the relations = < <= > >=.',
    '  - Nonlinear explicit functions of x — ONLY these families:',
    '      quadratic:    y = ax^2 + bx + c',
    '      sine/cosine:  y = a\\sin(bx + c) + d   and   y = a\\cos(bx + c) + d',
    '      exponential:  y = a\\,e^{bx} + c   (also a\\exp(bx) + c)',
    '      logarithm:    y = a\\ln(bx + c) + d   (also \\log)',
    '      reciprocal:   y = a/(bx + c) + d',
    '      square root:  y = a\\sqrt{bx + c} + d',
    '  - For a nonlinear function_2d you MUST provide BOTH:',
    '      `latex` — canonical display, a complete relation, e.g. "y = x^2 + 2x + 1";',
    '      `expression` — the RIGHT-HAND SIDE ONLY, in plain calculator syntax: use ^ for powers,',
    '        * for multiplication, and sin / cos / exp / ln / log / sqrt as functions, with variable x.',
    '        Examples: "x^2 + 2x + 1", "2*sin(3x - 1) + 4", "3*exp(-0.5x) + 1", "2/(x + 1) - 3", "sqrt(2x + 4)".',
    '      Optionally add `domain`: { "min": number, "max": number } to restrict the drawn range.',
    '  - `equation_2d` and `inequality_2d` remain LINEAR only.',
    '  - NOT supported (omit; never approximate): implicit curves such as "x^2 + y^2 = 4" or "xy = 1";',
    '    products of two variables; functions of a variable other than x; tan / sec / csc / cot;',
    '    absolute value; piecewise, parameterised, polar, vector, geometry or 3D content.',
    '',
    'Visualization types:',
    '  - "function_2d": one or more explicit functions of x (linear or nonlinear).',
    '  - "equation_2d": one or more LINEAR equations; use this for a SYSTEM, listing every equation in `expressions`.',
    '  - "inequality_2d": one or more LINEAR inequalities.',
    '  - "points_2d": explicitly given coordinate points. Set "connectPoints": true only when the lesson intends the points to be joined in order.',
    '  - "table_2d": an explicit x → y data table from the lesson. Set "connectPoints": true only when the lesson says to plot/join the table values.',
    '  - "vectors_2d": one or more 2D vectors from linear algebra (see below).',
    '  - "graph_2d": a small undirected or directed graph from discrete mathematics (see below).',
    '',
    'vectors_2d — rules:',
    '  - Provide `vectors`: an array of at most 8 items `{ "x": number, "y": number, "label"?: string, "start"?: { "x": number, "y": number }, "role"?: "vector" | "basis" | "component" | "result", "highlighted"?: boolean }`.',
    '    `x` and `y` are the COMPONENTS of the vector. `start` defaults to the origin; provide it only to show a translated or head-to-tail arrow.',
    '  - Set `operation` to one of "display", "addition", "scalar_multiplication", "linear_combination", "basis".',
    '  - For "addition": include the result as a vector with "role": "result". The app re-computes and verifies it.',
    '  - For "linear_combination": mark the basis vectors "role": "basis" and the result "role": "result".',
    '  - NEVER provide endpoints, screen/pixel coordinates, angles, lengths, colours or SVG.',
    '',
    'graph_2d — rules:',
    '  - Set `graphKind` to "undirected" or "directed".',
    '  - Set `layout` to a hint: "circular", "bipartite" or "hierarchical". The app validates it and may fall back to "circular".',
    '  - Provide `nodes`: at most 12 items `{ "id": string, "label": string, "partition"?: "left" | "right", "highlighted"?: boolean }`.',
    '    Node ids must be short, unique and non-empty. Labels are plain text. For "bipartite", set `partition` on every node.',
    '  - Provide `edges`: `{ "source": string, "target": string, "label"?: string, "weight"?: number, "directed"?: boolean, "highlighted"?: boolean }`.',
    '    `source`/`target` must be existing node ids. Self-loops are allowed. Do NOT repeat an edge.',
    '  - For "hierarchical", set `rootId` to an existing node id.',
    '  - NEVER provide node coordinates, radii, SVG paths, colours or layout parameters. The app computes all geometry.',
    '  - If the real graph has more than 12 nodes, choose the most relevant small subgraph and say so in the caption (for example "a small part of the graph"); if you cannot reduce it reliably, do not include the diagram.',
    '  - Do not invent relationships that the lesson does not state. If an edge is uncertain, omit the whole diagram rather than guessing.',
    '',
    'CRITICAL — do not fabricate mathematics:',
    '  - For a linear relation provide ONLY `latex`; for a nonlinear function provide `latex` AND `expression`.',
    '    NEVER supply sample points or a rendered curve: the app computes and samples the function itself.',
    '  - For points_2d and table_2d, provide ONLY values that the lesson actually states. Never round, interpolate, or invent missing rows.',
    '  - For vectors_2d and graph_2d, provide ONLY the components / nodes / edges the lesson actually uses.',
    '  - `latex` is the canonical user-visible representation and must be a complete relation.',
    '',
    'Other rules:',
    '  - Provide at most 3 visualizations. Prefer the single most useful one.',
    '  - `caption` is a short sentence in the lesson language. Do not put HTML or code in it.',
    '  - `viewport` is OPTIONAL presentation only. Omit it and the app chooses a sensible window. If you do provide it, all four values must be finite numbers with xMax > xMin and yMax > yMin.',
    '  - Do not reference colours or styling anywhere: the app owns the theme.',
    '',
    'JSON schema:',
    JSON.stringify(
      {
        visualizations: [
          {
            type: 'function_2d | equation_2d | inequality_2d | points_2d | table_2d | vectors_2d | graph_2d',
            caption: 'string (optional)',
            viewport: { xMin: -10, xMax: 10, yMin: -10, yMax: 10 },
            expressions: [
              { latex: 'y = 2x + 1', label: 'string (optional)' },
              { latex: 'y = x^2 - 4', expression: 'x^2 - 4', domain: { min: -5, max: 5 } },
            ],
            points: [{ x: 0, y: 1, label: 'string (optional)' }],
            connectPoints: false,
            vectors: [
              { x: 2, y: 1, label: 'v', role: 'vector' },
              { x: 1, y: 3, label: 'w', role: 'vector' },
              { x: 3, y: 4, label: 'v + w', role: 'result' },
            ],
            operation: 'display | addition | scalar_multiplication | linear_combination | basis',
            graphKind: 'undirected | directed',
            layout: 'circular | bipartite | hierarchical',
            rootId: 'string (optional)',
            nodes: [{ id: 'a', label: 'A', partition: 'left | right (optional)' }],
            edges: [
              { source: 'a', target: 'b', label: 'string (optional)', weight: 0, directed: false },
            ],
          },
        ],
      },
      null,
      2,
    ),
    '',
    securityFooter(),
  ].join('\n')
}

export function buildUserPrompt(input: VisualizationInput): string {
  const language =
    input.language === 'zh'
      ? 'Simplified Chinese'
      : input.language === 'en'
        ? 'English'
        : 'English with key Chinese terms in parentheses'

  return [
    `Topic: ${input.topicName}.`,
    input.topicDescription ? `Topic summary: ${input.topicDescription}.` : '',
    `Write the caption in: ${language}.`,
    '',
    'Below is the finished lesson. Decide whether a 2D diagram helps, and describe any diagram as structured JSON.',
    untrustedContentWrapper('LESSON', input.lessonContent),
    '',
    'Respond with the JSON object only.',
  ]
    .filter(Boolean)
    .join('\n')
}
