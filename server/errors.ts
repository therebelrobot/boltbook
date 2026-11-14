/** Domain errors the API maps to status codes. Messages are safe to show. */

export class RecordNotFoundError extends Error {}

export class RecordConflictError extends Error {}

export class RecordValidationError extends Error {}
