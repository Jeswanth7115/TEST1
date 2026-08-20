import pino from 'pino';
import pinoHttp from 'pino-http';

// Create a simple pino logger instance.
// In development, we use pino-pretty for human-readable output.
export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV !== 'production'
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
        },
      }
    : undefined,
});

// Create the express middleware for request logging
export const requestLogger = pinoHttp({
  logger,
  autoLogging: {
    ignore: (req) => {
      // Don't clutter logs with health checks
      if (req.url === '/health') return true;
      return false;
    }
  },
  customProps: (req, res) => {
    return {
      method: req.method,
      path: req.url,
      status: res.statusCode,
    };
  }
});
