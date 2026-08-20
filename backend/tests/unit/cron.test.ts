import { describe, it, expect } from 'vitest';
import { computeNextRunAt } from '../../src/worker/cron';

describe('Cron Expression Parser', () => {
  it('computes next run time for valid expressions', () => {
    // We just verify it returns a valid Date that is in the future
    const nextRun = computeNextRunAt('* * * * *');
    expect(nextRun).toBeInstanceOf(Date);
    expect(nextRun.getTime()).toBeGreaterThan(Date.now());
  });

  it('throws an error for invalid expressions', () => {
    expect(() => {
      computeNextRunAt('invalid-cron-string');
    }).toThrow();
  });
});
