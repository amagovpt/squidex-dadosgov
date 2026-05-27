import { NextFunction, Request, Response } from 'express';
import { envParser } from '@lib/envParser';

interface HttpError extends Error {
  statusCode?: unknown;
}

export default function errorHandler(
  err: HttpError,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
) {
  // err.statusCode is untrusted (libraries may set non-integer / out-of-range
  // values); Express 5's res.status() throws on those, so normalize first.
  const raw = err.statusCode;
  const statusCode =
    typeof raw === 'number' && Number.isInteger(raw) && raw >= 400 && raw <= 599
      ? raw
      : 500;
  const isServerError = statusCode >= 500;

  console.error(
    `[ERROR] ${req.method} ${req.originalUrl} - ${statusCode}: ${err.message}`,
    isServerError ? err.stack : '',
  );

  // Never leak internal error details to clients on 5xx responses.
  const message =
    isServerError && envParser.NODE_ENV === 'production'
      ? 'Internal Server Error'
      : (err.message ?? 'Internal Server Error');

  res.status(statusCode).json({
    success: false,
    message,
  });
}
