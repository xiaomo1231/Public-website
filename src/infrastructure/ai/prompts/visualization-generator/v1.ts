/**
 * v1 visualization-generator prompt.
 *
 * A *second, small* AI call made after a lesson is written. It looks at the
 * finished lesson and returns structured 2D graph data — never SVG, HTML or
 * code. The renderer turns that data into a deterministic, theme-aware figure.
 *
 * This is separate from the lesson prompt on purpose (Phase 0 finding): the
 * lesson is prose, not JSON, and the graph data has a different shape and a
 * different failure mode. A failed call here costs only the figure.
 *
 * Phase 2 extended this prompt (without an incompatible schema change) to allow
 * explicit nonlinear functions of x: quadratic, sine/cosine, exponential,
 * logarithm, reciprocal and square root. Nonlinear `function_2d` expressions
 * carry an extra plain-syntax `expression` and an optional `domain`; the local
 * parser and AST whitelist decide whether they are actually drawn.
 */

import type { VisualizationDraftOutput } from '@/entities/tutorVisualization/types'
import { securityFooter, untrustedContentWrapper } from '../security'

export const VERSION = 'v1' as const
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
    'You decide whether a 2D graph would genuinely help a university STEM student understand a lesson, and if so you describe that graph as STRUCTURED DATA.',
    '',
    'Output strictly valid JSON — no prose, no markdown fences, no comments.',
    'You must NEVER output SVG, HTML, JavaScript, CSS, colours, or any executable content. Only the JSON shape below.',
    '',
    'A visualization is OPTIONAL. Only include one when a picture makes the mathematics clearer. If nothing benefits, return { "visualizations": [] }. Never invent a graph to fill space.',
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
    '  - "function_2d": one or more explicit functions of x (linear or nonlinear), e.g. "y = 2x + 1" or "y = x^2".',
    '  - "equation_2d": one or more LINEAR equations; use this for a SYSTEM, listing every equation in `expressions` so they share one coordinate plane.',
    '  - "inequality_2d": one or more LINEAR inequalities; the app draws the boundary and shades the region itself.',
    '  - "points_2d": explicitly given coordinate points. Set "connectPoints": true only when the lesson intends the points to be joined in order.',
    '  - "table_2d": an explicit x → y data table from the lesson. Set "connectPoints": true only when the lesson says to plot/join the table values.',
    '',
    'CRITICAL — do not fabricate mathematics:',
    '  - For a linear relation provide ONLY `latex`; for a nonlinear function provide `latex` AND `expression`.',
    '    NEVER supply sample points or a rendered curve: the app computes and samples the function itself.',
    '  - For points_2d and table_2d, provide ONLY values that the lesson actually states. Never round, interpolate, or invent missing rows.',
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
            type: 'function_2d | equation_2d | inequality_2d | points_2d | table_2d',
            caption: 'string (optional)',
            viewport: { xMin: -10, xMax: 10, yMin: -10, yMax: 10 },
            expressions: [
              { latex: 'y = 2x + 1', label: 'string (optional)' },
              {
                latex: 'y = x^2 - 4',
                expression: 'x^2 - 4',
                domain: { min: -5, max: 5 },
                label: 'string (optional)',
              },
            ],
            points: [{ x: 0, y: 1, label: 'string (optional)' }],
            connectPoints: false,
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
    'Below is the finished lesson. Decide whether a 2D graph helps, and describe any graph as structured JSON.',
    untrustedContentWrapper('LESSON', input.lessonContent),
    '',
    'Respond with the JSON object only.',
  ]
    .filter(Boolean)
    .join('\n')
}
