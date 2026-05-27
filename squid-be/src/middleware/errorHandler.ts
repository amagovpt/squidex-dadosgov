import { NextFunction, Request, Response } from 'express';

interface HttpError extends Error {
  statusCode?: number;
}

export default function errorHandler(
  err: HttpError,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
) {
  const statusCode = err.statusCode ?? 500;
  const isServerError = statusCode >= 500;

  console.error(
    `[ERROR] ${req.method} ${req.originalUrl} - ${statusCode}: ${err.message}`,
    isServerError ? err.stack : '',
  );

  // Never leak internal error details to clients on 5xx responses.
  const message =
    isServerError && process.env.NODE_ENV === 'production'
      ? 'Internal Server Error'
      : (err.message ?? 'Internal Server Error');

  res.status(statusCode).json({
    success: false,
    message,
  });
}
