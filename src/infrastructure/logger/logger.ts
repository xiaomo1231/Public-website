import { AppError, isAppError } from '../errors/AppError'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogContext {
  [key: string]: unknown
}

interface LogPayload {
  level: LogLevel
  message: string
  timestamp: number
  context?: LogContext
  error?: { name: string; message: string; code?: string; stack?: string }
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

function currentLevel(): LogLevel {
  if (typeof import.meta !== 'undefined' && import.meta.env?.MODE === 'test') {
    return 'error'
  }
  if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
    return 'debug'
  }
  return 'info'
}

function serializeError(err: unknown): LogPayload['error'] {
  if (err instanceof Error) {
    const payload: LogPayload['error'] = {
      name: err.name,
      message: err.message,
    }
    if (err.stack) payload.stack = err.stack
    if (isAppError(err)) payload.code = err.code
    return payload
  }
  if (typeof err === 'string') return { name: 'StringError', message: err }
  try {
    return { name: 'UnknownError', message: JSON.stringify(err) }
  } catch {
    return { name: 'UnknownError', message: String(err) }
  }
}

const SENSITIVE_KEY = /apikey|api_key|password|secret|token|authorization|bearer/i

function redact(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value === null || value === undefined) return value
  if (typeof value !== 'object') return value
  if (seen.has(value as object)) return '[CIRCULAR]'
  seen.add(value as object)

  if (Array.isArray(value)) {
    return value.map((v) => redact(v, seen))
  }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY.test(k)) {
      out[k] = '[REDACTED]'
    } else {
      out[k] = redact(v, seen)
    }
  }
  return out
}

function emit(level: LogLevel, message: string, context?: LogContext, error?: unknown): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[currentLevel()]) return

  const payload: LogPayload = {
    level,
    message,
    timestamp: Date.now(),
  }
  if (context) payload.context = redact(context) as LogContext
  if (error !== undefined) payload.error = serializeError(error)

  const text = `[${level.toUpperCase()}] ${message}`
  switch (level) {
    case 'debug':
      console.debug(text, payload)
      break
    case 'info':
      console.info(text, payload)
      break
    case 'warn':
      console.warn(text, payload)
      break
    case 'error':
      console.error(text, payload)
      break
  }
}

export const logger = {
  debug(message: string, context?: LogContext) {
    emit('debug', message, context)
  },
  info(message: string, context?: LogContext) {
    emit('info', message, context)
  },
  warn(message: string, context?: LogContext) {
    emit('warn', message, context)
  },
  error(message: string, context?: LogContext, error?: unknown) {
    emit('error', message, context, error)
  },
  /** Wrap an async function with logging on failure. */
  async wrap<T>(label: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (err) {
      if (err instanceof AppError) {
        logger.error(`${label} failed: ${err.message}`, { code: err.code }, err)
      } else {
        logger.error(`${label} failed`, undefined, err)
      }
      throw err
    }
  },
}

export type Logger = typeof logger