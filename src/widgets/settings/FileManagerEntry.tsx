import { Link } from 'react-router-dom'
import { FolderOpen } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/Card'
import { buttonVariants } from '@/shared/ui/buttonVariants'
import { cn } from '@/shared/lib/utils'
import { useTranslation } from '@/i18n'
import type { SectionShellProps } from './settingsSection'

/** 设置 → 文件管理: the entry to every course's files on one page (2p). */
export function FileManagerEntry({
  className,
  headerClassName,
  titleClassName,
  bodyClassName,
}: SectionShellProps): JSX.Element {
  const { t } = useTranslation()
  return (
    <Card className={className} id="settings-files">
      <CardHeader className={headerClassName}>
        <CardTitle className={cn('flex items-center gap-2 text-base', titleClassName)}>
          <FolderOpen className="h-4 w-4 lecture:hidden" aria-hidden />
          {t('fileManager.title')}
        </CardTitle>
        <CardDescription>{t('fileManager.entryHint')}</CardDescription>
      </CardHeader>
      <CardContent className={bodyClassName}>
        <Link to="/settings/files" className={cn(buttonVariants({ variant: 'outline' }), 'h-11')}>
          <FolderOpen className="h-4 w-4" aria-hidden />
          {t('fileManager.open')}
        </Link>
      </CardContent>
    </Card>
  )
}
