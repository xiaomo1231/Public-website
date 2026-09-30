import { Link } from 'react-router-dom'
import { BookOpen, Presentation } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { useTranslation } from '@/i18n'

export type StudyMode = 'knowledge' | 'slides'

export interface StudyModeTabsProps {
  projectId: string
  active: StudyMode
  className?: string
}

/**
 * The two ways to learn a course. It is a pair of links, not local state, so
 * the chosen mode survives a refresh and can be bookmarked. It only appears
 * when the project actually has a presentation to study.
 */
export function StudyModeTabs({ projectId, active, className }: StudyModeTabsProps): JSX.Element {
  const { t } = useTranslation()
  const items: Array<{ key: StudyMode; labelKey: 'studyMode.knowledge' | 'studyMode.slides'; to: string; Icon: typeof BookOpen }> = [
    {
      key: 'knowledge',
      labelKey: 'studyMode.knowledge',
      to: `/projects/${projectId}/tutor`,
      Icon: BookOpen,
    },
    {
      key: 'slides',
      labelKey: 'studyMode.slides',
      to: `/projects/${projectId}/slides`,
      Icon: Presentation,
    },
  ]

  return (
    <nav
      aria-label={t('studyMode.label')}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border border-border/70 bg-muted/30 p-1',
        className,
      )}
    >
      {items.map(({ key, labelKey, to, Icon }) => {
        const isActive = key === active
        return (
          <Link
            key={key}
            to={to}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'focus-ring inline-flex min-h-8 items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors',
              isActive
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {t(labelKey)}
          </Link>
        )
      })}
    </nav>
  )
}
