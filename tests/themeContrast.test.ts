import { readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * WCAG contrast audit computed from the real `globals.css` token values.
 *
 * This resolves the CSS custom properties exactly as the browser would
 * (`var()` aliases included) for every Light/Dark × Color Theme combination and
 * checks the text/background pairs that actually carry content.
 */

/** Vitest runs with the project root as cwd. */
function readSource(relative: string): string {
  return readFileSync(resolvePath(process.cwd(), relative), 'utf8')
}

const css = readSource('src/shared/styles/globals.css')

type Tokens = Map<string, string>

function parseBlocks(source: string): Array<{ selector: string; tokens: Tokens }> {
  // Comments must go first: they contain `--token` names and would otherwise be
  // absorbed into the following declaration / selector.
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, '')
  const blocks: Array<{ selector: string; tokens: Tokens }> = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  let match: RegExpExecArray | null
  while ((match = re.exec(clean)) !== null) {
    const selector = match[1]!.trim().replace(/\s+/g, ' ')
    const tokens: Tokens = new Map()
    for (const declaration of match[2]!.split(';')) {
      const index = declaration.indexOf(':')
      if (index === -1) continue
      const key = declaration.slice(0, index).trim()
      if (!key.startsWith('--')) continue
      tokens.set(key, declaration.slice(index + 1).trim())
    }
    if (tokens.size > 0) blocks.push({ selector, tokens })
  }
  return blocks
}

const blocks = parseBlocks(css)

function blockFor(selector: string): Tokens {
  const found = blocks.find((block) => block.selector === selector)
  if (!found) throw new Error(`missing CSS block: ${selector}`)
  return found.tokens
}

function resolve(tokens: Tokens, name: string): string {
  const value = tokens.get(name)
  if (value === undefined) throw new Error(`missing token: ${name}`)
  const alias = /^var\(\s*(--[\w-]+)\s*\)$/.exec(value)
  return alias ? resolve(tokens, alias[1]!) : value
}

const THEMES = ['default', 'pinkAqua', 'warmOrange', 'academic'] as const
const MODES = ['light', 'dark'] as const

type Theme = (typeof THEMES)[number]
type Mode = (typeof MODES)[number]

/** Effective tokens after the cascade: :root → .dark → theme block. */
function effectiveTokens(mode: Mode, theme: Theme): Tokens {
  const merged = new Map(blockFor(':root'))
  if (mode === 'dark') {
    for (const [key, value] of blockFor('.dark')) merged.set(key, value)
  }
  if (theme !== 'default') {
    const selector =
      mode === 'dark' ? `.dark[data-color-theme='${theme}']` : `:root[data-color-theme='${theme}']`
    for (const [key, value] of blockFor(selector)) merged.set(key, value)
  }
  return merged
}

type Rgb = [number, number, number]

function hslTripletToRgb(triplet: string): Rgb {
  const match = /^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/.exec(triplet)
  if (!match) throw new Error(`not an HSL triplet: ${triplet}`)
  const h = Number(match[1])
  const s = Number(match[2]) / 100
  const l = Number(match[3]) / 100

  const c = (1 - Math.abs(2 * l - 1)) * s
  const hp = h / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  let rgb: Rgb
  if (hp < 1) rgb = [c, x, 0]
  else if (hp < 2) rgb = [x, c, 0]
  else if (hp < 3) rgb = [0, c, x]
  else if (hp < 4) rgb = [0, x, c]
  else if (hp < 5) rgb = [x, 0, c]
  else rgb = [c, 0, x]

  const m = l - c / 2
  return rgb.map((v) => Math.round(Math.min(1, Math.max(0, v + m)) * 255)) as Rgb
}

function relativeLuminance([r, g, b]: Rgb): number {
  const channel = (value: number): number => {
    const s = value / 255
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function contrast(fg: Rgb, bg: Rgb): number {
  const a = relativeLuminance(fg)
  const b = relativeLuminance(bg)
  const [hi, lo] = a >= b ? [a, b] : [b, a]
  return (hi + 0.05) / (lo + 0.05)
}

function ratio(mode: Mode, theme: Theme, fgToken: string, bgToken: string): number {
  const tokens = effectiveTokens(mode, theme)
  return contrast(hslTripletToRgb(resolve(tokens, fgToken)), hslTripletToRgb(resolve(tokens, bgToken)))
}

/** Pairs that carry normal-size text and must meet WCAG AA (4.5:1). */
const TEXT_PAIRS = [
  ['--foreground', '--background'],
  ['--card-foreground', '--card'],
  ['--muted-foreground', '--background'],
  ['--accent-foreground', '--accent'],
  ['--secondary-foreground', '--secondary'],
  ['--destructive-foreground', '--destructive'],
] as const

describe('WCAG contrast', () => {
  it('prints the measured matrix (diagnostic)', () => {
    const rows: string[] = []
    for (const mode of MODES) {
      for (const theme of THEMES) {
        const button = ratio(mode, theme, '--primary-foreground', '--primary-strong')
        const body = ratio(mode, theme, '--foreground', '--background')
        const muted = ratio(mode, theme, '--muted-foreground', '--background')
        rows.push(
          `${mode.padEnd(5)} ${theme.padEnd(11)} button=${button.toFixed(2)} body=${body.toFixed(2)} muted=${muted.toFixed(2)}`,
        )
      }
    }
    console.log(`\n${rows.join('\n')}\n`)
    expect(rows).toHaveLength(MODES.length * THEMES.length)
  })

  for (const mode of MODES) {
    for (const theme of THEMES) {
      it(`${mode} + ${theme}: normal text meets AA (4.5:1)`, () => {
        for (const [fg, bg] of TEXT_PAIRS) {
          const value = ratio(mode, theme, fg, bg)
          expect(value, `${fg} on ${bg} = ${value.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
        }
      })

      it(`${mode} + ${theme}: filled primary surfaces meet AA-large (3:1)`, () => {
        const value = ratio(mode, theme, '--primary-foreground', '--primary-strong')
        expect(value, `${mode}+${theme} = ${value.toFixed(2)}:1`).toBeGreaterThanOrEqual(3)
      })
    }
  }

  it('records the light-mode primary-button ratios after the accessibility fix', () => {
    // Pink Aqua now uses #1E8F9C instead of #2A9BB8.
    expect(ratio('light', 'pinkAqua', '--primary-foreground', '--primary-strong')).toBeCloseTo(3.84, 1)
    // Warm Orange now uses #8C3332 instead of #D15C2C.
    expect(
      ratio('light', 'warmOrange', '--primary-foreground', '--primary-strong'),
    ).toBeGreaterThanOrEqual(7.5)
    // Academic's #2C7F4D already passed AA, so primary-strong aliases primary.
    expect(ratio('light', 'academic', '--primary-foreground', '--primary-strong')).toBeGreaterThanOrEqual(4.5)
    // Default is the original near-black.
    expect(ratio('light', 'default', '--primary-foreground', '--primary-strong')).toBeGreaterThanOrEqual(4.5)
  })

  it('resolves --primary-strong to the text-safe colour per theme', () => {
    expect(resolve(effectiveTokens('light', 'pinkAqua'), '--primary-strong')).toBe('186.2 67.7% 36.5%')
    expect(resolve(effectiveTokens('light', 'warmOrange'), '--primary-strong')).toBe('0.7 47.4% 37.3%')
    // The original primaries are kept, not deleted.
    expect(resolve(effectiveTokens('light', 'pinkAqua'), '--primary')).toBe('192 63% 44%')
    expect(resolve(effectiveTokens('light', 'warmOrange'), '--primary')).toBe('18 65% 50%')
  })

  it('keeps the semantic colours independent of the theme', () => {
    // Semantic states live in the Tailwind palette, never in theme tokens.
    expect(css).not.toMatch(/--(success|warning|info)\s*:/)
    for (const mode of MODES) {
      for (const theme of THEMES) {
        const tokens = effectiveTokens(mode, theme)
        expect(resolve(tokens, '--destructive')).not.toBe(resolve(tokens, '--primary-strong'))
        expect(resolve(tokens, '--destructive')).not.toBe(resolve(tokens, '--primary'))
      }
    }
  })

  it('uses the text-safe primary only for filled, text-bearing surfaces', () => {
    expect(readSource('src/shared/ui/buttonVariants.ts')).toContain(
      'bg-primary-strong text-primary-foreground',
    )
    expect(readSource('src/shared/ui/Badge.tsx')).toContain('bg-primary-strong text-primary-foreground')
    expect(readSource('src/shared/ui/Tooltip.tsx')).toContain('bg-primary-strong')
    // Decorative uses keep the original primary.
    expect(readSource('src/shared/ui/Progress.tsx')).toContain('bg-primary ')
    expect(readSource('src/shared/ui/Slider.tsx')).toContain('bg-primary')
    expect(readSource('src/shared/ui/buttonVariants.ts')).toContain("link: 'text-primary ")
  })

  it('never uses the invalid palette entry as a CSS colour', () => {
    expect(css).not.toContain('4C1A2')
  })
})
