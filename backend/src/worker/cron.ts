import { CronExpressionParser } from 'cron-parser';

/**
 * Computes the next run time for a given cron expression.
 * Throws an error if the expression is invalid.
 */
export function computeNextRunAt(cronExpression: string): Date {
  const cron = CronExpressionParser.parse(cronExpression);
  return cron.next().toDate();
}
