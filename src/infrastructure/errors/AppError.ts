/**
 * Domain-specific error classes.
 * All thrown errors should ultimately extend AppError so the error boundary
 * can categorise and present them consistently.
 */

export class AppError extends Error {
  readonly code: string
  readonly cause?: unknown

  constructor(message: string, code = 'APP_ERROR', cause?: unknown) {
    super(message)
    this.name = this.constructor.name
    this.code = code
    if (cause !== undefined) {
      this.cause = cause
    }
  }
}

export class NotFoundError extends AppError {
  constructor(entity: string, id?: string) {
    super(`${entity}${id ? ` (${id})` : ''} not found`, 'NOT_FOUND')
  }
}

export class ValidationError extends AppError {
  readonly details?: Record<string, string>
  constructor(message: string, details?: Record<string, string>) {
    super(message, 'VALIDATION_ERROR')
    if (details) this.details = details
  }
}

export class StorageError extends AppError {
  constructor(message: string, cause?: unknown) {
    super(message, 'STORAGE_ERROR', cause)
  }
}

export class AuthError extends AppError {
  constructor(message: string, code = 'AUTH_ERROR') {
    super(message, code)
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError
}