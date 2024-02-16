/*
 * Copyright (c) 2023-2024 Jared M. Scott. This work is licensed under the Creative
 * Commons Attribution 3.0 Un-ported License. To view a copy of this license,
 * visit http://creativecommons.org/licenses/by/3.0/ or send a letter to
 *         Creative Commons,
 *         444 Castro Street, Suite 900,
 *         Mountain View, California, 94041, USA.
 */

const throttle = (callback: () => void, limit = 0): () => void => {
  let waiting = false;
  return function (...args): void {
    if (!waiting) {
      callback.apply(this, args);
      waiting = true;
      setTimeout(function () {
        waiting = false;
      }, limit);
    }
  }
};

export {
  throttle
}
