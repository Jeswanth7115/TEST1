import { Request, Response, NextFunction } from 'express';

/**
 * Wraps an async route handler so that any unhandled promise rejections
 * are automatically forwarded to the Express error handler middleware via next().
 */
export const catchAsync = (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
