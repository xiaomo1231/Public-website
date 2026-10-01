import { describe, expect, it } from 'vitest'
import { formatHomeworkReviewText } from '@/entities/homework/reviewFormatting'
import { parseMarkdownBlocks } from '@/shared/lib/markdownText'

describe('homework review formatting', () => {
  it('turns literal escaped list breaks in cached AI text into readable blocks', () => {
    const raw = '正确性核对\\n- $P(0)=5$\\n- $P(1)=8$\\n\\n三个点均符合。'
    const formatted = formatHomeworkReviewText(raw)
    expect(formatted).toBe('正确性核对\n- $P(0)=5$\n- $P(1)=8$\n\n三个点均符合。')
    expect(parseMarkdownBlocks(formatted).map((block) => block.kind)).toEqual(['paragraph', 'list', 'paragraph'])
  })

  it('preserves LaTeX commands beginning with backslash-n', () => {
    const raw = '$x\\neq 0$，$\\nabla f$\\n- 代入检验'
    expect(formatHomeworkReviewText(raw)).toBe('$x\\neq 0$，$\\nabla f$\n- 代入检验')
  })
})
