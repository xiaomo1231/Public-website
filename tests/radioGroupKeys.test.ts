import { describe, expect, it } from 'vitest'
import { radioStep } from '@/shared/lib/radioGroupKeys'

describe('radio group arrow keys', () => {
  it('moves and wraps with the arrow keys, jumps with Home / End', () => {
    expect(radioStep('ArrowRight', 0, 2)).toBe(1)
    expect(radioStep('ArrowDown', 1, 2)).toBe(0)
    expect(radioStep('ArrowLeft', 0, 3)).toBe(2)
    expect(radioStep('ArrowUp', 2, 3)).toBe(1)
    expect(radioStep('Home', 2, 3)).toBe(0)
    expect(radioStep('End', 0, 3)).toBe(2)
  })

  it('ignores other keys and empty groups', () => {
    expect(radioStep('Enter', 0, 2)).toBeNull()
    expect(radioStep('ArrowRight', 0, 0)).toBeNull()
  })
})
