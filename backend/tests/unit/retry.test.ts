import { describe, it, expect } from 'vitest';
import { calculateRetryDelay } from '../../src/worker/executor';

describe('Retry Policy Calculator', () => {
  it('computes FIXED delay', () => {
    // Fixed delay should always return baseDelayMs regardless of attemptCount
    expect(calculateRetryDelay('FIXED', 1000, 1, null)).toBe(1000);
    expect(calculateRetryDelay('FIXED', 1000, 5, null)).toBe(1000);
  });

  it('computes LINEAR delay', () => {
    // Linear delay: baseDelayMs * attemptCount
    expect(calculateRetryDelay('LINEAR', 1000, 1, null)).toBe(1000);
    expect(calculateRetryDelay('LINEAR', 1000, 2, null)).toBe(2000);
    expect(calculateRetryDelay('LINEAR', 1000, 5, null)).toBe(5000);
  });

  it('computes EXPONENTIAL delay', () => {
    // Exponential delay: baseDelayMs * 2^(attemptCount - 1)
    expect(calculateRetryDelay('EXPONENTIAL', 1000, 1, null)).toBe(1000);
    expect(calculateRetryDelay('EXPONENTIAL', 1000, 2, null)).toBe(2000);
    expect(calculateRetryDelay('EXPONENTIAL', 1000, 3, null)).toBe(4000);
    expect(calculateRetryDelay('EXPONENTIAL', 1000, 4, null)).toBe(8000);
  });

  it('caps delay at maxDelayMs', () => {
    // 1000 * 2^(4) = 16000. Cap it at 10000.
    expect(calculateRetryDelay('EXPONENTIAL', 1000, 5, 10000)).toBe(10000);
    
    // Linear 5000 * 5 = 25000. Cap at 15000.
    expect(calculateRetryDelay('LINEAR', 5000, 5, 15000)).toBe(15000);
  });

  it('defaults to FIXED for unknown strategies', () => {
    expect(calculateRetryDelay('UNKNOWN', 1000, 5, null)).toBe(1000);
  });
});
