import {
  useCallback,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import { Sidebar } from './Sidebar'
import { cn } from '@/shared/lib/utils'

function safeMatches(element: HTMLElement, selector: string): boolean {
  try {
    return element.matches(selector)
  } catch {
    // Engines without :focus-visible (older jsdom): treat focus as keyboard focus.
    return true
  }
}

/**
 * Lab style on a 专注子页面: the numbered side rail shrinks to a thin strip of
 * icons so the learning area gets the width. It expands over the page (no
 * reflow) while a mouse hovers it, while keyboard focus is inside it, or after
 * a tap on its toggle; Escape collapses it again.
 */
export function SidebarRail(): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const collapse = useCallback(() => setExpanded(false), [])

  return (
    <div
      className="relative z-20 hidden w-14 shrink-0 lg:block"
      data-sidebar-rail
      data-expanded={expanded ? 'true' : 'false'}
      onPointerEnter={(event: PointerEvent) => {
        if (event.pointerType === 'mouse') setExpanded(true)
      }}
      onPointerLeave={(event: PointerEvent) => {
        if (event.pointerType === 'mouse') setExpanded(false)
      }}
      onFocus={(event: FocusEvent<HTMLDivElement>) => {
        // Keyboard focus only: a tap focuses the toggle too, and its click decides.
        const target = event.target as HTMLElement
        if (typeof target.matches !== 'function' || safeMatches(target, ':focus-visible')) {
          setExpanded(true)
        }
      }}
      onBlur={(event: FocusEvent<HTMLDivElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setExpanded(false)
      }}
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Escape' && expanded) {
          setExpanded(false)
          const active = document.activeElement
          if (active instanceof HTMLElement && event.currentTarget.contains(active)) active.blur()
        }
      }}
    >
      <div
        className={cn(
          'absolute inset-y-0 left-0 overflow-hidden',
          expanded ? 'w-56 shadow-lg' : 'w-14',
        )}
      >
        <Sidebar
          variant={expanded ? 'full' : 'rail'}
          railExpanded={expanded}
          onToggleRail={() => setExpanded((value) => !value)}
          onNavigate={collapse}
        />
      </div>
    </div>
  )
}
