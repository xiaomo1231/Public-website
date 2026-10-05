import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import {
  BookX,
  Brain,
  ClipboardList,
  FolderOpen,
  GraduationCap,
  History,
  Home,
  ListChecks,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { useSlidingIndicator, type IndicatorRect } from '@/shared/lib/useSlidingIndicator'
import { useTranslation, type TranslationKey } from '@/i18n'

export type ProjectFlowSection =
  | 'home'
  | 'files'
  | 'homework'
  | 'tutor'
  | 'quiz'
  | 'mistakes'
  | 'mastery'
  | 'history'

interface FlowItem {
  key: ProjectFlowSection
  labelKey: TranslationKey
  icon: LucideIcon
  path: (projectId: string) => string
}

/**
 * The course-level modules, in the order a student moves through them.
 * `home` is the workspace (materials + analysis); the rest are the learning
 * and review surfaces. Keeping this list in one place means every course page
 * shows the same map, so "where am I / what's next" never depends on which
 * page the student landed on.
 */
const ITEMS: FlowItem[] = [
  { key: 'home', labelKey: 'projectNav.home', icon: Home, path: (id) => `/projects/${id}` },
  {
    key: 'files',
    labelKey: 'projectNav.files',
    icon: FolderOpen,
    path: (id) => `/projects/${id}/files`,
  },
  {
    key: 'homework',
    labelKey: 'projectNav.homework',
    icon: ClipboardList,
    path: (id) => `/projects/${id}/homework`,
  },
  {
    key: 'tutor',
    labelKey: 'projectNav.tutor',
    icon: GraduationCap,
    path: (id) => `/projects/${id}/tutor`,
  },
  {
    key: 'quiz',
    labelKey: 'projectNav.quiz',
    icon: ListChecks,
    path: (id) => `/projects/${id}/quiz`,
  },
  {
    key: 'mistakes',
    labelKey: 'projectNav.mistakes',
    icon: BookX,
    path: (id) => `/projects/${id}/mistakes`,
  },
  {
    key: 'mastery',
    labelKey: 'projectNav.mastery',
    icon: Brain,
    path: (id) => `/projects/${id}/mastery`,
  },
  {
    key: 'history',
    labelKey: 'projectNav.history',
    icon: History,
    path: (id) => `/projects/${id}/history`,
  },
]

/**
 * Every course page mounts its own nav, so the last highlight position is kept
 * here (per course, in memory only) and the next page's highlight glides from
 * it instead of appearing in place.
 */
const lastIndicator = new Map<string, IndicatorRect>()

export interface ProjectFlowNavProps {
  projectId: string
  active: ProjectFlowSection
  className?: string
}

export function ProjectFlowNav({
  projectId,
  active,
  className,
}: ProjectFlowNavProps): JSX.Element {
  const { t } = useTranslation()
  const activeRef = useRef<HTMLAnchorElement>(null)
  const indicator = useSlidingIndicator<HTMLElement>('[aria-current="page"]', {
    initialRect: lastIndicator.get(projectId) ?? null,
    onMeasure: (rect) => lastIndicator.set(projectId, rect),
  })
  const navRef = indicator.containerRef

  // On narrow screens the row scrolls; keep the current section in view so the
  // student can always see where they are.
  useEffect(() => {
    const nav = navRef.current
    const el = activeRef.current
    if (!nav || !el) return
    const navRect = nav.getBoundingClientRect()
    const elRect = el.getBoundingClientRect()
    const delta = elRect.left - navRect.left - (nav.clientWidth - elRect.width) / 2
    nav.scrollLeft = Math.max(0, nav.scrollLeft + delta)
  }, [active, projectId, navRef])

  return (
    <nav
      ref={navRef}
      aria-label={t('projectNav.label')}
      data-indicator={indicator.ready ? 'ready' : undefined}
      className={cn(
        'group/flow relative flex items-center gap-1 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className,
      )}
    >
      <span
        aria-hidden
        data-animate={indicator.animate}
        className={cn(
          'slide-indicator rounded-full bg-theme-primary-soft',
          !indicator.ready && 'hidden',
        )}
        style={indicator.style}
      />
      {ITEMS.map((item) => {
        const isActive = item.key === active
        const Icon = item.icon
        return (
          <Link
            key={item.key}
            ref={isActive ? activeRef : undefined}
            to={item.path(projectId)}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'focus-ring group relative inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full px-3 py-2 text-[13px] font-medium transition-colors duration-200',
              isActive
                ? 'bg-theme-primary-soft text-foreground group-data-[indicator=ready]/flow:bg-transparent'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <Icon
              className="h-3.5 w-3.5 shrink-0 transition-transform duration-300 motion-safe:group-hover:-translate-y-px motion-safe:group-hover:scale-110"
              aria-hidden
            />
            {t(item.labelKey)}
          </Link>
        )
      })}
    </nav>
  )
}
