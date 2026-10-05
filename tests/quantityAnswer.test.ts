import { describe, expect, it } from 'vitest'
import {
  compareQuantity,
  isValidUnit,
  normalizeUnitText,
  splitQuantity,
} from '@/infrastructure/math/quantityAnswer'

describe('compareQuantity', () => {
  it('accepts the expected value in the expected unit', () => {
    expect(compareQuantity('9.8 m/s^2', '9.8', 'm/s^2')).toMatchObject({ outcome: 'correct', isCorrect: true })
  })

  it('converts any compatible unit before comparing', () => {
    expect(compareQuantity('980 cm/s²', '9.8', 'm/s^2').isCorrect).toBe(true)
    expect(compareQuantity('2.0 kJ/mol', '2000', 'J/mol').isCorrect).toBe(true)
    expect(compareQuantity('25 ℃', '298.15', 'K').isCorrect).toBe(true)
    expect(compareQuantity('1.2 μF', '1.2e-6', 'F').isCorrect).toBe(true)
    expect(compareQuantity('1 kg·m/s²', '1', 'N').isCorrect).toBe(true)
  })

  it('reads scientific notation and thousands separators', () => {
    expect(compareQuantity('3×10^8 m/s', '3e8', 'm/s').isCorrect).toBe(true)
    expect(compareQuantity('3.0e8 m/s', '3e8', 'm/s').isCorrect).toBe(true)
    expect(compareQuantity('1,000 m', '1', 'km').isCorrect).toBe(true)
  })

  it('applies a relative tolerance, also to very small quantities', () => {
    expect(compareQuantity('9.85 m/s^2', '9.8', 'm/s^2').isCorrect).toBe(true)
    expect(compareQuantity('10.5 m/s^2', '9.8', 'm/s^2')).toMatchObject({ outcome: 'wrong-value', isCorrect: false })
    // An absolute tolerance would wrongly accept this.
    expect(compareQuantity('1.5 uF', '1.2e-6', 'F').isCorrect).toBe(false)
  })

  it('says why an answer is wrong', () => {
    expect(compareQuantity('9.8', '9.8', 'm/s^2')).toMatchObject({ outcome: 'missing-unit', isCorrect: false })
    expect(compareQuantity('9.8 N', '9.8', 'm/s^2')).toMatchObject({ outcome: 'wrong-dimension', isCorrect: false })
  })

  it('leaves unreadable answers unverified instead of wrong', () => {
    expect(compareQuantity('9.8 blah', '9.8', 'm/s^2')).toMatchObject({ outcome: 'unreadable-unit', isCorrect: null })
    expect(compareQuantity('about ten', '9.8', 'm/s^2')).toMatchObject({ outcome: 'unreadable-number', isCorrect: null })
  })
})

describe('unit helpers', () => {
  it('normalises typed unit notation', () => {
    expect(normalizeUnitText('kg·m/s²')).toBe('kg m/s^2')
    expect(normalizeUnitText('5 Ω')).toBe('5 ohm')
    expect(normalizeUnitText('μF')).toBe('uF')
  })

  it('splits a value from its unit', () => {
    expect(splitQuantity('1.2 × 10^3 kPa')).toEqual({ value: 1200, unitText: 'kPa' })
    expect(splitQuantity('3 eV')).toEqual({ value: 3, unitText: 'eV' })
    expect(splitQuantity('m/s')).toBeNull()
  })

  it('validates units from the quiz generator', () => {
    expect(isValidUnit('m/s^2')).toBe(true)
    expect(isValidUnit('kJ/mol')).toBe(true)
    expect(isValidUnit('apples')).toBe(false)
    expect(isValidUnit('3 m')).toBe(false)
    expect(isValidUnit('')).toBe(false)
  })
})
