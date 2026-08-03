/*
 * Copyright (c) 2023-2026 Jared M. Scott. This work is licensed under the
 * Creative Commons Attribution-ShareAlike 4.0 International License. To view
 * a copy of this license, visit https://creativecommons.org/licenses/by-sa/4.0/
 */

interface ThrottleOptions {
  // When true, a call suppressed during the window schedules one trailing
  // invocation at the window's end, so the final call is never lost. The
  // rate stays at most one invocation per `limit` period.
  trailing?: boolean;
}

const throttle = <Args extends unknown[], This>(
  callback: (this: This, ...args: Args) => void,
  limit = 0,
  options: ThrottleOptions = {},
): ((this: This, ...args: Args) => void) => {
  let waiting = false;
  let pending = false;
  const invoke = (self: This, args: Args): void => {
    callback.apply(self, args);
    waiting = true;
    setTimeout(() => {
      waiting = false;
      if (pending) {
        pending = false;
        invoke(self, args);
      }
    }, limit);
  };
  return function (this: This, ...args: Args): void {
    if (waiting) {
      pending = options.trailing === true;
      return;
    }
    invoke(this, args);
  };
};

export type { ThrottleOptions };
export { throttle };
