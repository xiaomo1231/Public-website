import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import {
  BookX,
  Brain,
  ClipboardList,
  FolderOpen,
  History,
  Home,
  ListChecks,
  Sparkles,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/shared/lib/utils'
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
    icon: Sparkles,
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
  const navRef = useRef<HTMLElement>(null)
  const activeRef = useRef<HTMLAnchorElement>(null)

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
  }, [active, projectId])

  return (
    <nav
      ref={navRef}
      aria-label={t('projectNav.label')}
      className={cn(
        'flex items-center gap-1 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className,
      )}
    >
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
              'focus-ring inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full px-3 py-2 text-[13px] font-medium transition-colors',
              isActive
                ? 'bg-theme-primary-soft text-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {t(item.labelKey)}
          </Link>
        )
      })}
    </nav>
  )
}
