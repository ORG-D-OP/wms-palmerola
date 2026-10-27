export class AppError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = new.target.name
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Los datos enviados no son validos.') {
    super(message, 400)
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'No autenticado.') {
    super(message, 401)
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Sin permiso.') {
    super(message, 403)
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'No encontrado.') {
    super(message, 404)
  }
}

export class ConflictError extends AppError {
  constructor(message = 'La operacion choca con el estado actual.') {
    super(message, 409)
  }
}

/** Valido pero imposible: sin stock, sin posicion libre, sin saldo. */
export class UnprocessableError extends AppError {
  constructor(message = 'La operacion no se puede completar.') {
    super(message, 422)
  }
}

export type ErrorResponse = { error: string; ref?: string }

/**
 * Traduce cualquier excepcion a una respuesta segura. Los errores no previstos
 * nunca viajan al navegador: se registran con un identificador de correlacion.
 */
export function toErrorResponse(error: unknown): { body: ErrorResponse; status: number } {
  if (error instanceof AppError) {
    return { body: { error: error.message }, status: error.status }
  }

  const ref = crypto.randomUUID()
  console.error(JSON.stringify({ level: 'error', ref, error: String(error) }))
  return { body: { error: 'No se pudo completar la operación.', ref }, status: 500 }
}
