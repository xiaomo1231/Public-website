import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Outlet, useMatches } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Header } from './Header'
import { TopNav } from './TopNav'
import { useThemeStore } from '@/features/theme/themeStore'
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
  const uiStyle = useThemeStore((s) => s.uiStyle)

  /*
   * Page transition. Plays when the matched route changes (a different page),
   * not when only its params do (next slide, next topic), and never remounts
   * the page — it is a Web Animation on the wrapper, so page state is
   * untouched. A short opacity-only fade (no travel), so frequent navigation
   * stays calm (shorter under reduced motion). Skipped where WAAPI is missing.
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
    // Reduced motion keeps the fade (no movement involved), just shorter.
    el.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: prefersReducedMotion() ? 120 : 150,
      easing: EASE_OUT,
    })
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
    // `uiStyle`: the drawer only exists in lab, so re-apply when it mounts.
  }, [mobileNavOpen, uiStyle])
  // The drawer belongs to lab; leaving lab closes it.
  useEffect(() => {
    if (uiStyle !== 'lab') setMobileNavOpen(false)
  }, [uiStyle])
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

  const lab = uiStyle === 'lab'

  /*
   * One stable tree for both interface styles. The side rail and the mobile
   * drawer are toggled around it, and Header / TopNav swap inside the same
   * column, so `<Outlet />` (and the fading `pageRef` wrapper) keep the same
   * element path: switching style never remounts the current page (a Settings
   * draft and focus survive).
   */
  return (
    <div
      className={cn(
        'relative flex h-full min-h-screen w-full text-foreground',
        // Lab: transparent over the millimetre grid (painted on body::before).
        !lab && 'bg-background',
      )}
    >
      <a
        href="#main-content"
        className="focus-ring sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-full focus:bg-primary-strong focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
      >
        {t('common.skipToContent')}
      </a>

      {/*
        Lab desktop sidebar. It collapses to zero width; the content is only
        mounted while expanded so nothing hidden stays keyboard-focusable. It
        snaps (no width transition), since the content cannot animate with it.
      */}
      {lab && (
        <div
          className={cn(
            'relative z-10 hidden shrink-0 overflow-hidden lg:block',
            navCollapsed ? 'w-0' : 'w-56',
          )}
          aria-hidden={navCollapsed}
        >
          {!navCollapsed && <Sidebar onCollapse={() => setNavCollapsed(true)} />}
        </div>
      )}

      {/* Lab mobile drawer */}
      {lab && (
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
              'absolute inset-0 bg-black/50 transition-opacity duration-200 ease-out',
              mobileNavOpen ? 'opacity-100' : 'opacity-0',
            )}
            onClick={() => setMobileNavOpen(false)}
          />
          <div
            ref={drawerPanelRef}
            tabIndex={-1}
            className={cn(
              'absolute inset-y-0 left-0 outline-none transition-transform duration-[280ms] ease-drawer',
              mobileNavOpen ? 'translate-x-0' : '-translate-x-full',
            )}
          >
            <Sidebar onNavigate={() => setMobileNavOpen(false)} />
          </div>
        </div>
      )}

      <div className={cn('relative flex min-w-0 flex-1 flex-col', lab && 'z-10')}>
        {lab ? (
          <Header
            onOpenMobileNav={() => setMobileNavOpen(true)}
            {...(navCollapsed ? { onExpandNav: () => setNavCollapsed(false) } : {})}
          />
        ) : (
          <TopNav />
        )}
        <div ref={pageRef} className="flex min-h-0 flex-1 flex-col">
          <Outlet />
        </div>
      </div>
    </div>
  )
}
