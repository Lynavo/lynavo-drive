export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly params?: Record<string, unknown>,
  ) {
    super(code);
    this.name = 'AppError';
    Object.setPrototypeOf(this, AppError.prototype);
  }
}
