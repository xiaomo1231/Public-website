import { useEffect, useState } from 'react'
import { BookOpen, Loader2, RotateCcw } from 'lucide-react'
import type { HomeworkQuestion } from '@/entities/homework/types'
import type { HomeworkReviewGuide } from '@/entities/homework/reviewGuide'
import { formatHomeworkReviewText } from '@/entities/homework/reviewFormatting'
import type { HomeworkService } from '@/services/homeworkService'
import { Button } from '@/shared/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/Card'
import { RichText } from '@/shared/ui/RichText'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { useTranslation } from '@/i18n'

interface HomeworkReviewPanelProps {
  question: HomeworkQuestion
  service: HomeworkService
}

/** The review is teaching content; source scans are only a secondary check. */
export function HomeworkReviewPanel({ question, service }: HomeworkReviewPanelProps): JSX.Element {
  const { t, language } = useTranslation()
  const reviewLanguage = language === 'zh-CN' ? 'zh' : 'en'
  const [guide, setGuide] = useState<HomeworkReviewGuide | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setGuide(null)
    setError(null)
    setLoading(true)
    void service.getOrGenerateReviewGuide(question.id, reviewLanguage)
      .then((result) => { if (active) setGuide(result) })
      .catch((err) => { if (active) setError(friendlyAIError(err)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [question.id, reviewLanguage, service])

  async function regenerate(): Promise<void> {
    setLoading(true)
    setError(null)
    try {
      setGuide(await service.getOrGenerateReviewGuide(question.id, reviewLanguage, true))
    } catch (err) {
      setError(friendlyAIError(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card>
      <CardHeader className="space-y-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <BookOpen className="h-4 w-4" aria-hidden />
          {t('homework.review.title')}
        </CardTitle>
        <p className="text-xs text-muted-foreground">{t('homework.review.aiNote')}</p>
      </CardHeader>
      <CardContent className="space-y-5">
        {loading && !guide && (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            {t('homework.review.preparing')}
          </p>
        )}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {guide && (
          <div className="space-y-6">
            <section className="space-y-2">
              <h4 className="text-sm font-semibold">{t('homework.review.meaning')}</h4>
              <RichText text={formatHomeworkReviewText(guide.questionMeaning)} format="markdown" className="min-w-0 max-w-[75ch] overflow-x-auto" paragraphClassName="text-sm leading-relaxed" />
            </section>
            <section className="space-y-2">
              <h4 className="text-sm font-semibold">{t('homework.review.knowledge')}</h4>
              <ul className="list-outside list-disc space-y-2 pl-5 text-sm leading-relaxed">
                {guide.knowledgePoints.map((point, index) => (
                  <li key={index}><RichText text={formatHomeworkReviewText(point)} format="markdown" className="min-w-0 max-w-[75ch] overflow-x-auto" paragraphClassName="text-sm leading-relaxed" /></li>
                ))}
              </ul>
            </section>
            <section className="space-y-2">
              <h4 className="text-sm font-semibold">{t('homework.review.method')}</h4>
              <RichText text={formatHomeworkReviewText(guide.method)} format="markdown" className="min-w-0 max-w-[75ch] overflow-x-auto" paragraphClassName="text-sm leading-relaxed" />
            </section>
            <section className="space-y-2">
              <h4 className="text-sm font-semibold">{t('homework.review.steps')}</h4>
              <ol className="list-outside list-decimal space-y-3 pl-5 text-sm leading-relaxed">
                {guide.steps.map((step, index) => (
                  <li key={index}><RichText text={formatHomeworkReviewText(step)} format="markdown" className="min-w-0 max-w-[75ch] overflow-x-auto" paragraphClassName="text-sm leading-relaxed" /></li>
                ))}
              </ol>
            </section>
            <section className="space-y-2">
              <h4 className="text-sm font-semibold">{t('homework.review.explanation')}</h4>
              <RichText text={formatHomeworkReviewText(guide.explanation)} format="markdown" className="min-w-0 max-w-[75ch] overflow-x-auto" paragraphClassName="text-sm leading-relaxed" />
            </section>
            <section className="space-y-2">
              <h4 className="text-sm font-semibold">{t('homework.review.interpretation')}</h4>
              <RichText text={formatHomeworkReviewText(guide.interpretation)} format="markdown" className="min-w-0 max-w-[75ch] overflow-x-auto" paragraphClassName="text-sm leading-relaxed" />
            </section>
            <section className="space-y-2">
              <h4 className="text-sm font-semibold">{t('homework.review.check')}</h4>
              <RichText text={formatHomeworkReviewText(guide.check)} format="markdown" className="min-w-0 max-w-[75ch] overflow-x-auto" paragraphClassName="text-sm leading-relaxed" />
            </section>
          </div>
        )}
        <Button type="button" size="sm" variant="outline" onClick={() => void regenerate()} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RotateCcw className="h-4 w-4" aria-hidden />}
          {guide ? t('homework.review.regenerate') : t('homework.review.retry')}
        </Button>
      </CardContent>
    </Card>
  )
}
