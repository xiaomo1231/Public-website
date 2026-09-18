import { describe, expect, it } from 'vitest'
import { AppError, AuthError, NotFoundError, StorageError, ValidationError, isAppError } from '@/infrastructure/errors/AppError'

describe('errors', () => {
  it('AppError captures message and code', () => {
    const e = new AppError('boom', 'BOOM')
    expect(e.message).toBe('boom')
    expect(e.code).toBe('BOOM')
    expect(e.name).toBe('AppError')
  })

  it('specialised errors default codes', () => {
    expect(new NotFoundError('Project', 'p1').code).toBe('NOT_FOUND')
    expect(new ValidationError('bad').code).toBe('VALIDATION_ERROR')
    expect(new StorageError('io').code).toBe('STORAGE_ERROR')
    expect(new AuthError('nope').code).toBe('AUTH_ERROR')
  })

  it('isAppError narrows', () => {
    const wrapped = new Error('plain')
    expect(isAppError(wrapped)).toBe(false)
    expect(isAppError(new ValidationError('x'))).toBe(true)
  })
})