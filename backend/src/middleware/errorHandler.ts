import type { NextFunction, Request, Response } from 'express';

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'HttpError';
  }
}

export const notFound = (_req: Request, res: Response): void => {
  res.status(404).json({ error: 'Resource not found' });
};

export const errorHandler = (
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  const status = err instanceof HttpError ? err.status : 500;
  const message =
    err instanceof Error ? err.message : 'Unexpected server error';

  if (status >= 500) {
    console.error('[error]', err);
  }

  res.status(status).json({ error: message });
};
