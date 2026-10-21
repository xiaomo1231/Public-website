import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Outlet, useMatches } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Header } from './Header'
import { cn } from '@/shared/lib/utils'
import { EASE_OUT, prefersReducedMotion } from '@/shared/lib/motion'
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
   * untouched. A short opacity-only fade (no travel), so frequent navigation
   * stays calm. Skipped under reduced motion and where WAAPI is missing.
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
    if (prefersReducedMotion()) return
    el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: EASE_OUT })
  }, [routeId])

  /*
   * Mobile drawer accessibility. While closed it is `inert` (not focusable,
   * not in the accessibility tree), not just `aria-hidden`. Opening moves
   * focus into it; Escape closes it; closing returns focus to whatever opened
   * it (the header menu button). `inert` is set through the DOM because
   * React 18 does not know the attribute.
   */
  const drawerRef = useRef<HTMLDivElement>(null)
  const drawerPanelRef = useRef<HTMLDivElement>(null)
  const drawerOpenerRef = useRef<HTMLElement | null>(null)
  useLayoutEffect(() => {
    const drawer = drawerRef.current
    if (!drawer) return
    if (mobileNavOpen) drawer.removeAttribute('inert')
    else drawer.setAttribute('inert', '')
  }, [mobileNavOpen])
  useEffect(() => {
    if (!mobileNavOpen) return
    const active = document.activeElement
    drawerOpenerRef.current = active instanceof HTMLElement ? active : null
    const drawer = drawerRef.current
    const panel = drawerPanelRef.current
    const first = panel?.querySelector<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )
    ;(first ?? panel)?.focus()
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setMobileNavOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      const opener = drawerOpenerRef.current
      drawerOpenerRef.current = null
      // Only restore focus when it would otherwise be lost (still inside the
      // now-inert drawer, or dropped to <body>) — not when it moved elsewhere.
      const now = document.activeElement
      const lost = !now || now === document.body || Boolean(drawer?.contains(now))
      if (opener && opener.isConnected && lost) opener.focus()
    }
  }, [mobileNavOpen])

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
        ref={drawerRef}
        className={cn(
          'fixed inset-0 z-40 lg:hidden',
          mobileNavOpen ? 'pointer-events-auto' : 'pointer-events-none',
        )}
        aria-hidden={!mobileNavOpen}
        data-testid="mobile-nav"
      >
        <div
          className={cn(
            'absolute inset-0 bg-black/50 backdrop-blur-[2px] transition-opacity duration-300',
            mobileNavOpen ? 'opacity-100' : 'opacity-0',
          )}
          onClick={() => setMobileNavOpen(false)}
        />
        <div
          ref={drawerPanelRef}
          tabIndex={-1}
          className={cn(
            'absolute inset-y-0 left-0 outline-none transition-transform duration-300 ease-out',
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
