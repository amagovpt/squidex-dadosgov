import { Request, Response, NextFunction } from 'express';
import { performance } from 'perf_hooks';

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',   // 2xx success
  yellow: '\x1b[33m',  // 3xx redirection
  red: '\x1b[31m',     // 4xx client error
  magenta: '\x1b[35m', // 5xx server error
  cyan: '\x1b[36m',    // info
  gray: '\x1b[90m'     // timestamps
};

// Basic logging middleware
export const basicLoggingMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const startTime = performance.now();
  const requestTimestamp = new Date().toISOString();
  const requestId = generateRequestId();

  console.log(
    `${colors.gray}[${requestTimestamp}]${colors.reset} ${colors.cyan}-->${colors.reset} ${req.method} ${req.url} | IP: ${getClientIP(req)}`
  );

  res.on('finish', () => {
    const duration = Math.round(performance.now() - startTime);
    const responseTimestamp = new Date().toISOString();
    const statusColor = getStatusColor(res.statusCode);
    
    console.log(
      `${colors.gray}[${responseTimestamp}]${colors.reset} ${colors.cyan}<--${colors.reset} STATUS: ${statusColor}${res.statusCode}${colors.reset} | METHOD: ${req.method} | URL: ${req.url} | DURATION: ${duration}ms | IP: ${getClientIP(req)}`
    );
  });

  res.setHeader('x-request-id', requestId);
  next();
};

// GraphQL specific logging
export const graphqlLoggingMiddleware = (req: Request, res: Response, next: NextFunction) => {
  if (!req.url.includes('/graphql')) {
    return next();
  }

  const startTime = performance.now();
  const operationName = getGraphQLOperationName(req) || 'anonymous';

  res.on('finish', () => {
    const duration = Math.round(performance.now() - startTime);
    const responseTimestamp = new Date().toISOString();
    const statusColor = getStatusColor(res.statusCode);
    
    console.log(
      `${colors.gray}[${responseTimestamp}]${colors.reset} ${colors.cyan}<--${colors.reset} STATUS: ${statusColor}${res.statusCode}${colors.reset} | OPERATION: ${operationName} | URL: ${req.url} | DURATION: ${duration}ms | IP: ${getClientIP(req)}`
    );
  });

  next();
};

// Main logging middleware with environment-based routing
export const loggingMiddleware = (req: Request, res: Response, next: NextFunction) => {
  // Skip health checks and static files
  const skipPaths = ['/api/healthcheck', '/metrics', '/favicon.ico'];
  
  // More robust path checking
  const shouldSkip = skipPaths.some(path => 
    req.url === path || 
    req.url.startsWith(path + '?') || 
    req.path === path
  );
  
  if (shouldSkip || process.env.NODE_ENV === 'test') {
    return next();
  }

  // Use GraphQL logger for GraphQL requests, basic logger for everything else
  if (req.url.includes('/graphql')) {
    return graphqlLoggingMiddleware(req, res, next);
  }
  
  return basicLoggingMiddleware(req, res, next);
};

// Helper functions
function getClientIP(req: Request): string {
  return (
    req.headers['x-forwarded-for'] as string ||
    req.headers['x-real-ip'] as string ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

function getGraphQLOperationName(req: Request): string | null {
  try {
    if (req.body?.operationName) {
      return req.body.operationName;
    }
    
    const query = req.body?.query || req.query?.query;
    if (!query) return null;
    
    const match = query.match(/(?:query|mutation|subscription)\s+(\w+)/);
    return match ? match[1] : 'anonymous';
  } catch {
    return null;
  }
}

function getStatusColor(statusCode: number): string {
  if (statusCode >= 200 && statusCode < 300) return colors.green;   // Success
  if (statusCode >= 300 && statusCode < 400) return colors.yellow;  // Redirection
  if (statusCode >= 400 && statusCode < 500) return colors.red;     // Client Error
  if (statusCode >= 500) return colors.magenta;                     // Server Error
  return colors.reset; // Default
}
