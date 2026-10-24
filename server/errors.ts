export type ErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'AUTH_NOT_CONFIGURED'
  | 'INVALID_INPUT'
  | 'LIMIT_REACHED'
  | 'CONFLICT'
  | 'RATE_LIMITED'

/** Fallo esperado del dominio: la capa de transporte lo traduce a `extensions.code` (GraphQL) o a `{ error }` (HTTP). */
export class DomainError extends Error {
  readonly code: ErrorCode
  constructor(code: ErrorCode, message: string) {
    super(message)
    this.name = 'DomainError'
    this.code = code
  }
}
