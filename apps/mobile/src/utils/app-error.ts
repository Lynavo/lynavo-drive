export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly params?: Record<string, unknown>,
  ) {
    super(code);
    this.name = 'AppError';
    // Restore prototype chain so `instanceof AppError` works on Hermes/JSC.
    Object.setPrototypeOf(this, AppError.prototype);
  }
}
