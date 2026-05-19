import { GraphQLError } from 'graphql';

export default class AppError extends Error {
  statusCode: number;
  isOperational: boolean;
  status: boolean;

  // Helper to determine error codes based on status
  private getErrorCode(): string {
    switch (this.statusCode) {
      case 400:
        return 'BAD_REQUEST';
      case 401:
        return 'UNAUTHORIZED';
      case 403:
        return 'FORBIDDEN';
      case 404:
        return 'NOT_FOUND';
      case 409:
        return 'CONFLICT';
      case 422:
        return 'VALIDATION_ERROR';
      case 500:
        return 'INTERNAL_ERROR';
      default:
        return 'UNKNOWN_ERROR';
    }
  }

  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }

  toGraphQLError(): GraphQLError {
    return new GraphQLError(this.message, {
      extensions: {
        code: this.getErrorCode(),
        statusCode: this.statusCode,
        isOperational: this.isOperational,
        http: {
          status: this.statusCode,
        },
      },
    });
  }
}
