import { describe, expect, it } from 'vitest'
import { suggestLinearAlgebraMethod } from '@/entities/homework/linearAlgebraGuide'

describe('linear algebra study guide suggestions', () => {
  it('recognizes supported task language without claiming to judge the answer', () => {
    expect(suggestLinearAlgebraMethod('Is v in Span(v1, v2)?')).toBe('span')
    expect(suggestLinearAlgebraMethod('Are these vectors linearly independent?')).toBe(
      'independence',
    )
    expect(suggestLinearAlgebraMethod('Is this set a vector subspace?')).toBe('subspace')
    expect(suggestLinearAlgebraMethod('Write the system in vector form.')).toBe('vectorForm')
    expect(suggestLinearAlgebraMethod('Solve this linear system.')).toBe('linearSystem')
    expect(suggestLinearAlgebraMethod('Write inflow and outflow at every node.')).toBe('flow')
  })

  it('keeps unrelated homework on its existing walkthrough', () => {
    expect(suggestLinearAlgebraMethod('Find the limit as x approaches 3.')).toBeNull()
    expect(suggestLinearAlgebraMethod('Balance this chemical reaction.')).toBeNull()
  })
})
