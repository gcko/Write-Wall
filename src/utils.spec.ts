/*
 * Copyright (c) 2023-2026 Jared M. Scott. This work is licensed under the Creative
 * Commons Attribution 3.0 Un-ported License. To view a copy of this license,
 * visit http://creativecommons.org/licenses/by/3.0/ or send a letter to
 *         Creative Commons,
 *         444 Castro Street, Suite 900,
 *         Mountain View, California, 94041, USA.
 */

import { expect, it } from 'vitest';
import { throttle } from './utils.js';

it('should only be called once within 2 seconds', () => {
  let called = 0;
  const throttlePeriod = 50;
  const callback = () => {
    called += 1;
  };
  const throttledMethod = throttle(callback, throttlePeriod);
  // call it twice right after each other
  throttledMethod();
  throttledMethod();
  expect(called).toBe(1);
});
