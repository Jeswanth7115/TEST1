import { CronExpressionParser } from 'cron-parser';

/**
 * Computes the next run time for a given cron expression.
 * Throws an error if the expression is invalid.
 */
export function computeNextRunAt(cronExpression: string, timezone = 'UTC'): Date {
  const cron = CronExpressionParser.parse(cronExpression, { tz: timezone });
  return cron.next().toDate();
}
