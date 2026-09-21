import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
          /** Text-safe variant used by filled, text-bearing surfaces. */
          strong: 'hsl(var(--primary-strong))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        /*
         * Color-theme tokens. The palette is selected by
         * `data-color-theme` on <html> (see features/theme). Components use
         * these instead of a literal colour, so adding a theme needs no
         * component changes.
         */
        theme: {
          primary: 'hsl(var(--theme-primary))',
          'primary-soft': 'hsl(var(--theme-primary-soft))',
          accent: 'hsl(var(--theme-accent))',
          'accent-soft': 'hsl(var(--theme-accent-soft))',
          heading: 'hsl(var(--theme-heading))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        // Text fonts first, then dedicated symbol / maths fallbacks so that
        // √ ∞ ∑ ∫ ∂ ≤ ≥ ≠ ≈ → ∈ ∪ ∩ and Greek letters resolve to a font that
        // actually has them instead of relying on the browser's heuristics.
        // Order matters: a glyph is taken from the first family that has it.
        sans: [
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'PingFang SC',
          'Hiragino Sans GB',
          'Microsoft YaHei',
          'Noto Sans SC',
          'Noto Sans CJK SC',
          'Segoe UI Symbol',
          'Noto Sans Symbols 2',
          'Noto Sans Math',
          'Cambria Math',
          'Apple Symbols',
          'Segoe UI Emoji',
          'Apple Color Emoji',
          'Noto Color Emoji',
          'sans-serif',
        ],
        mono: [
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Monaco',
          'Consolas',
          'Noto Sans Mono',
          'Segoe UI Symbol',
          'Noto Sans Symbols 2',
          'Noto Sans Math',
          'Cambria Math',
          'Apple Symbols',
          'monospace',
        ],
      },
    },
  },
  plugins: [],
} satisfies Config