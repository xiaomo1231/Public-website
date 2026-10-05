import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Outlet, useMatches } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Header } from './Header'
import { cn } from '@/shared/lib/utils'
import { useTranslation } from '@/i18n'

export function AppShell(): JSX.Element {
  const { t } = useTranslation()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  /**
   * Desktop sidebar collapsed. Held in AppShell state, which survives
   * client-side route changes, so the choice is kept while the student moves
   * between pages (no persistence, no database table).
   */
  const [navCollapsed, setNavCollapsed] = useState(false)

  /*
   * Page transition. Plays when the matched route changes (a different page),
   * not when only its params do (next slide, next topic), and never remounts
   * the page — it is a Web Animation on the wrapper, so page state is
   * untouched. Skipped under reduced motion and where WAAPI is missing.
   */
  const matches = useMatches()
  const routeId = matches[matches.length - 1]?.id
  const pageRef = useRef<HTMLDivElement>(null)
  const previousRouteId = useRef(routeId)
  useLayoutEffect(() => {
    if (previousRouteId.current === routeId) return
    previousRouteId.current = routeId
    const el = pageRef.current
    if (!el || typeof el.animate !== 'function') return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    el.animate(
      [
        { opacity: 0, transform: 'translateY(10px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ],
      { duration: 320, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    )
  }, [routeId])

  // Close mobile nav when resizing back to desktop
  useEffect(() => {
    function onResize() {
      if (window.innerWidth >= 1024) setMobileNavOpen(false)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return (
    <div
      className={cn(
        'app-shell-wash relative flex h-full min-h-screen w-full bg-background text-foreground lg:p-4',
        navCollapsed ? 'lg:gap-0' : 'lg:gap-2',
      )}
    >
      <a
        href="#main-content"
        className="focus-ring sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-full focus:bg-primary-strong focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
      >
        {t('common.skipToContent')}
      </a>

      {/*
        Desktop sidebar. It collapses to zero width; the content is only
        mounted while expanded so nothing hidden stays keyboard-focusable. The
        width transition is short and disabled under reduced-motion.
      */}
      <div
        className={cn(
          'relative z-10 hidden shrink-0 overflow-hidden transition-[width] duration-200 ease-out motion-reduce:transition-none lg:block',
          navCollapsed ? 'w-0' : 'w-60',
        )}
        aria-hidden={navCollapsed}
      >
        {!navCollapsed && <Sidebar onCollapse={() => setNavCollapsed(true)} />}
      </div>

      {/* Mobile drawer */}
      <div
        className={cn(
          'fixed inset-0 z-40 lg:hidden',
          mobileNavOpen ? 'pointer-events-auto' : 'pointer-events-none',
        )}
        aria-hidden={!mobileNavOpen}
      >
        <div
          className={cn(
            'absolute inset-0 bg-black/50 backdrop-blur-[2px] transition-opacity duration-300',
            mobileNavOpen ? 'opacity-100' : 'opacity-0',
          )}
          onClick={() => setMobileNavOpen(false)}
        />
        <div
          className={cn(
            'absolute inset-y-0 left-0 transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
            mobileNavOpen ? 'translate-x-0' : '-translate-x-full',
          )}
        >
          <Sidebar onNavigate={() => setMobileNavOpen(false)} />
        </div>
      </div>

      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <Header
          onOpenMobileNav={() => setMobileNavOpen(true)}
          {...(navCollapsed ? { onExpandNav: () => setNavCollapsed(false) } : {})}
        />
        <div ref={pageRef} className="flex min-h-0 flex-1 flex-col">
          <Outlet />
        </div>
      </div>
    </div>
  )
}
