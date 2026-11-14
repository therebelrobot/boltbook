/** Domain errors the API maps to status codes. Messages are safe to show. */

export class RecordNotFoundError extends Error {}

export class RecordConflictError extends Error {}

export class RecordValidationError extends Error {}

export type AuthErrorCode =
  | 'already_claimed'
  | 'not_claimed'
  | 'wrong_setup_token'
  | 'wrong_credentials'
  | 'totp_required'
  | 'weak_passphrase'
  | 'totp_not_pending'
  | 'totp_invalid'
  | 'not_signed_in'

export class AuthError extends Error {
  constructor(
    public readonly code: AuthErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'AuthError'
  }
}
