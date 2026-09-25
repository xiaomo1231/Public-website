import { readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Guards the visual-refresh infrastructure:
 *  - every colour theme defines the semantic tokens in both light and dark;
 *  - the decorative motion (aurora, brand sheen, progress reveal) is declared;
 *  - `prefers-reduced-motion: reduce` switches the decorative motion off.
 *
 * These are structural guarantees read from the real `globals.css`, so a future
 * edit that drops a token or forgets the reduced-motion override fails here.
 */

const css = readFileSync(resolvePath(process.cwd(), 'src/shared/styles/globals.css'), 'utf8')

type Tokens = Map<string, string>

function parseBlocks(source: string): Array<{ selector: string; tokens: Tokens }> {
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
const blockFor = (selector: string): Tokens => {
  const found = blocks.find((block) => block.selector === selector)
  if (!found) throw new Error(`missing CSS block: ${selector}`)
  return found.tokens
}

const THEMES = ['default', 'pinkAqua', 'warmOrange', 'academic'] as const
const MODES = ['light', 'dark'] as const

function effectiveTokens(mode: (typeof MODES)[number], theme: (typeof THEMES)[number]): Tokens {
  const merged = new Map(blockFor(':root'))
  if (mode === 'dark') for (const [k, v] of blockFor('.dark')) merged.set(k, v)
  if (theme !== 'default') {
    const selector =
      mode === 'dark' ? `.dark[data-color-theme='${theme}']` : `:root[data-color-theme='${theme}']`
    for (const [k, v] of blockFor(selector)) merged.set(k, v)
  }
  return merged
}

/** Tokens the UI relies on everywhere; each must resolve in every combination. */
const REQUIRED_TOKENS = [
  '--background',
  '--foreground',
  '--card',
  '--card-foreground',
  '--primary',
  '--primary-strong',
  '--primary-foreground',
  '--secondary',
  '--secondary-foreground',
  '--muted',
  '--muted-foreground',
  '--accent',
  '--accent-foreground',
  '--border',
  '--input',
  '--ring',
  '--theme-primary',
  '--theme-primary-soft',
  '--theme-accent',
  '--theme-accent-soft',
  '--theme-heading',
  '--theme-gradient-start',
  '--theme-gradient-middle',
  '--theme-gradient-end',
  '--theme-surface-tint',
  '--shadow-color',
  '--shadow-soft',
  '--shadow-lift',
] as const

describe('theme tokens', () => {
  for (const mode of MODES) {
    for (const theme of THEMES) {
      it(`${mode} + ${theme}: every shared token is defined`, () => {
        const tokens = effectiveTokens(mode, theme)
        for (const token of REQUIRED_TOKENS) {
          expect(tokens.has(token), `${token} missing in ${mode}/${theme}`).toBe(true)
        }
      })
    }
  }
})

describe('decorative motion', () => {
  it('declares the aurora, brand sheen and progress-reveal keyframes', () => {
    expect(css).toContain('@keyframes aurora-drift')
    expect(css).toContain('@keyframes brand-sheen')
    expect(css).toContain('@keyframes progress-reveal')
  })

  it('builds the decoration from theme tokens, never a literal colour', () => {
    // The aurora and brand mark must go through the theme variables.
    expect(css).toMatch(/\.aurora::before[\s\S]*hsl\(var\(--theme-primary\)/)
    expect(css).toMatch(/\.aurora::after[\s\S]*hsl\(var\(--theme-accent\)/)
    expect(css).toMatch(/\.brand-mark[\s\S]*hsl\(var\(--primary-strong\)/)
  })

  it('turns the decorative motion off under prefers-reduced-motion', () => {
    const media = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/.exec(css)
    expect(media, 'missing reduced-motion media block').not.toBeNull()
    const body = media![1]!
    for (const selector of ['.animate-rise', '.animate-fade', '.progress-reveal', '.brand-mark::after', '.study-note']) {
      expect(body, `${selector} not disabled`).toContain(selector)
    }
    expect(body).toContain('animation: none !important')
  })
})
