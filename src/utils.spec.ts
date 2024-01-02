/*
 * Copyright (c) 2023 Jared M. Scott. This work is licensed under the Creative
 * Commons Attribution 3.0 Un-ported License. To view a copy of this license,
 * visit http://creativecommons.org/licenses/by/3.0/ or send a letter to
 *         Creative Commons,
 *         444 Castro Street, Suite 900,
 *         Mountain View, California, 94041, USA.
 */

import { throttle } from './utils.js';
import { jest, it, expect } from "@jest/globals";

it('should only be called once within 2 seconds', (done) => {
  // expect.assertions(1);
  let called = 0;
  const throttlePeriod = 50;
  const callback = () => new Promise((resolve) => {
    called += 1;
    resolve(called);
  });
  const throttledMethod = throttle(callback, throttlePeriod);
  // call it twice right after each other
  throttledMethod();
  throttledMethod();
  try {
    expect(called).toBe(1);
    jest.clearAllTimers();
    done();
  } catch (error) {
    jest.clearAllTimers();
    done(error as string | Error | undefined);
  }
});
