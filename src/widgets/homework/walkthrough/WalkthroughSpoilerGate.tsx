import { AlertTriangle, BookOpenText, PencilLine } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/Card'
import { useTranslation } from '@/i18n'

export interface WalkthroughSpoilerGateProps {
  /** 我知道了，打开讲解. */
  onOpen: () => void
  /** 先去做题: switch to the practice view; without it only "open" is offered. */
  onPractice?: () => void
}

/**
 * The "the walkthrough contains every solution" notice in practice mode. 先去做题
 * is the suggested choice, so it is the primary button.
 */
export function WalkthroughSpoilerGate({
  onOpen,
  onPractice,
}: WalkthroughSpoilerGateProps): JSX.Element {
  const { t } = useTranslation()
  return (
    <Card className="border-amber-500/40 bg-amber-500/5" data-walkthrough-spoiler>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden />
          {t('homework.walkthrough.spoilerTitle')}
        </CardTitle>
        <CardDescription>{t('homework.walkthrough.spoilerBody')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {onPractice && (
          <Button onClick={onPractice}>
            <PencilLine className="h-4 w-4" aria-hidden />
            {t('homework.walkthrough.spoilerPractice')}
          </Button>
        )}
        <Button variant={onPractice ? 'outline' : 'default'} onClick={onOpen}>
          <BookOpenText className="h-4 w-4" aria-hidden />
          {t('homework.walkthrough.spoilerOpen')}
        </Button>
      </CardContent>
    </Card>
  )
}
