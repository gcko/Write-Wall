/*
 * Copyright (c) 2023-2026 Jared M. Scott. This work is licensed under the Creative
 * Commons Attribution 3.0 Un-ported License. To view a copy of this license,
 * visit http://creativecommons.org/licenses/by/3.0/ or send a letter to
 *         Creative Commons,
 *         444 Castro Street, Suite 900,
 *         Mountain View, California, 94041, USA.
 */

import { describe, expect, it, vi } from 'vitest';
import { throttle } from './utils.js';

describe('throttle', () => {
  it('calls the callback immediately on first invocation', () => {
    const callback = vi.fn();
    const throttled = throttle(callback, 100);

    throttled('first');

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith('first');
  });

  it('suppresses repeated calls until the delay passes', () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const delay = 75;
    const throttled = throttle(callback, delay);

    throttled();
    throttled();

    expect(callback).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(delay);
    throttled();

    expect(callback).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('preserves the calling context and arguments', () => {
    const context = {
      total: 0,
      add(amount: number) {
        this.total += amount;
      },
    };
    const callback = function (this: typeof context, amount: number) {
      this.add(amount);
    };
    const throttled = throttle(callback, 10);

    throttled.call(context, 3);

    expect(context.total).toBe(3);
  });
});
