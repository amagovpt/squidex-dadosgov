import { NextFunction, Request, Response } from "express";


export default function ErrorHandler(
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) {
  const statusCode = err.statusCode ?? 500;
  const message = err.message ?? "Internal Server Error";

  console.error(
    `[ERROR] ${req.method} ${req.originalUrl} - ${statusCode}: ${message}`
  );

  res.status(statusCode).json({
    success: false,
    message,
  });
}
