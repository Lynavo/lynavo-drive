import { AppError } from '../app-error';

describe('AppError', () => {
  it('carries a code and optional params', () => {
    const err = new AppError('errors.authInvalidPhone', { phone: '1234' });
    expect(err.code).toBe('errors.authInvalidPhone');
    expect(err.params).toEqual({ phone: '1234' });
    expect(err.name).toBe('AppError');
  });

  it('is an instance of Error for catch interop', () => {
    const err = new AppError('errors.unknown');
    expect(err instanceof Error).toBe(true);
    expect(err instanceof AppError).toBe(true);
  });

  it('defaults params to undefined when omitted', () => {
    const err = new AppError('errors.unknown');
    expect(err.params).toBeUndefined();
  });

  it('uses code as message so stack traces stay informative', () => {
    const err = new AppError('errors.networkUnavailable');
    expect(err.message).toBe('errors.networkUnavailable');
  });
});
