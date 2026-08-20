import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';

export function errorHandler(err: any, req: Request, res: Response, next: NextFunction) {
  // If it's a Zod validation error, return a consistent 400 response
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request data',
        details: err.errors
      }
    });
  }

  // Handle generic errors with a consistent structure
  // If the error object has a status or statusCode property, use it; otherwise 500
  const status = err.status || err.statusCode || 500;
  
  // Only leak error messages if they are client errors (4xx) or explicitly safe
  // In a real app, 500 errors should just say "Internal Server Error"
  const message = status < 500 ? err.message : 'Internal Server Error';

  return res.status(status).json({
    error: {
      code: err.code || (status < 500 ? 'CLIENT_ERROR' : 'INTERNAL_SERVER_ERROR'),
      message: message
    }
  });
}
