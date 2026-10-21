import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { buildWalkthroughContext, windowAround } from '@/services/walkthroughContext'

const RREF_BODY = [
  '## (a) 矩阵化简',
  '得到最终的 RREF：',
  '$$\\left[\\begin{array}{cccc|c}1&0&0&0&-2\\\\0&1&0&2&6\\\\0&0&1&0&0\\end{array}\\right].$$',
  '前三列是主元（pivot）列，分别对应 $x_1, x_2, x_3$；第四列不是主元列，因此 $x_4$ 是自由变量。',
].join('\n\n')

let db: AppDatabase

beforeEach(async () => {
  db = new AppDatabase()
  setDbForTesting(db)
  await db.open()
})

async function seed(): Promise<void> {
  await db.table('homeworkQuestions').put({
    id: 'q1',
    setId: 'set1',
    projectId: 'p1',
    prompt: 'Consider the system x1 + 2x2 + 3x3 + 4x4 = 10 … solve it with RREF.',
  })
  await db.table('homeworkWalkthroughs').put({
    id: 'set1:zh_terms',
    projectId: 'p1',
    setId: 'set1',
    language: 'zh_terms',
    sections: [
      {
        id: 'q:q1',
        kind: 'question',
        questionId: 'q1',
        title: 'q',
        conclusion: '无穷多解',
        body: RREF_BODY,
        status: 'ready',
      },
    ],
    createdAt: 1,
    updatedAt: 2,
  })
}

describe('walkthrough question context', () => {
  it('sends the question and the whole section with its LaTeX, not only the paragraph', async () => {
    await seed()
    const context = await buildWalkthroughContext(
      { setId: 'set1', sectionId: 'q:q1', quote: '第四列不是主元列', surrounding: '只有这一段' },
      db,
    )
    expect(context).toContain('Question:\nConsider the system')
    expect(context).toContain('0&1&0&2&6')
    expect(context).toContain('第四列不是主元列')
    expect(context).not.toBe('只有这一段')
  })

  it('falls back to the paragraph when the section is not stored', async () => {
    const context = await buildWalkthroughContext(
      { setId: 'missing', sectionId: 'q:x', quote: 'a', surrounding: '只有这一段' },
      db,
    )
    expect(context).toBe('只有这一段')
  })

  it('cuts a long section to a window around the passage', () => {
    const text = `${'a'.repeat(5000)}TARGET${'b'.repeat(5000)}`
    const cut = windowAround(text, 'TARGET', 1000)
    expect(cut).toContain('TARGET')
    expect(cut.length).toBeLessThanOrEqual(1002)
    expect(cut.startsWith('…')).toBe(true)
  })
})
