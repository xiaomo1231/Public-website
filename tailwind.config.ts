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
      /*
       * One monotonic radius scale (see `--radius-*` in globals.css). Pick by
       * the role of the surface, not by eye:
       *   md   8px  items inside a container (menu items, tab triggers, chips)
       *   lg  12px  controls and small containers (inputs, selects, menus,
       *             tab lists, icon tiles)
       *   xl  16px  nav links, toasts, inner panels
       *   2xl 20px  content panels (Card, lists, notices)
       *   3xl 24px  feature surfaces and overlays (dialogs, sidebar, resume card)
       *   full      buttons, badges-as-pills, avatars, progress tracks
       * A nested surface uses (outer radius − its inset), e.g. a 12px tab list
       * with 4px padding holds 8px triggers.
       */
      borderRadius: {
        sm: 'var(--radius-sm)',
        DEFAULT: 'var(--radius-xs)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
        '2xl': 'var(--radius-2xl)',
        '3xl': 'var(--radius-3xl)',
      },
      /*
       * Elevation reads from CSS variables so each light/dark (and colour
       * theme) can tune its own shadow. Components use `shadow-soft` /
       * `shadow-lift`, never a literal shadow.
       */
      boxShadow: {
        soft: 'var(--shadow-soft)',
        lift: 'var(--shadow-lift)',
      },
      keyframes: {
        rise: {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        fade: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'fade-out': {
          from: { opacity: '1' },
          to: { opacity: '0' },
        },
        /*
         * The keyframes below animate the individual `translate` / `scale`
         * properties rather than `transform`, so they compose with a
         * component's own positioning transform (e.g. the centred dialog's
         * translate(-50%, -50%), or a toast's swipe offset) instead of
         * replacing it.
         */
        'tab-in': {
          from: { opacity: '0', translate: '0 6px' },
          to: { opacity: '1', translate: '0 0' },
        },
        'dialog-in': {
          from: { opacity: '0', scale: '0.96', translate: '0 10px' },
          to: { opacity: '1', scale: '1', translate: '0 0' },
        },
        'dialog-out': {
          from: { opacity: '1', scale: '1' },
          to: { opacity: '0', scale: '0.97' },
        },
        'pop-in': {
          from: { opacity: '0', scale: '0.95' },
          to: { opacity: '1', scale: '1' },
        },
        'pop-out': {
          from: { opacity: '1', scale: '1' },
          to: { opacity: '0', scale: '0.96' },
        },
        'toast-in': {
          from: { opacity: '0', translate: 'calc(100% + 1rem) 0' },
          to: { opacity: '1', translate: '0 0' },
        },
        'toast-out': {
          from: { opacity: '1', translate: '0 0' },
          to: { opacity: '0', translate: '30% 0' },
        },
        float: {
          '0%, 100%': { translate: '0 0' },
          '50%': { translate: '0 -5px' },
        },
      },
      animation: {
        // Short, one-shot entrances used sparingly (sections, tab panels).
        rise: 'rise 0.45s cubic-bezier(0.22, 1, 0.36, 1) both',
        fade: 'fade 0.22s ease-out both',
        'fade-out': 'fade-out 0.18s ease-in both',
        // `backwards`, not `both`: once finished it lets go, so hover
        // transforms on the element keep working.
        'tab-in': 'tab-in 0.32s cubic-bezier(0.22, 1, 0.36, 1) backwards',
        'dialog-in': 'dialog-in 0.28s cubic-bezier(0.22, 1, 0.36, 1) both',
        'dialog-out': 'dialog-out 0.16s ease-in both',
        'pop-in': 'pop-in 0.18s cubic-bezier(0.22, 1, 0.36, 1) both',
        'pop-out': 'pop-out 0.12s ease-in both',
        'toast-in': 'toast-in 0.42s cubic-bezier(0.22, 1, 0.36, 1) both',
        'toast-out': 'toast-out 0.2s ease-in both',
        float: 'float 4.5s ease-in-out infinite',
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