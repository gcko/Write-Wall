/*
 * Copyright (c) 2023-2026 Jared M. Scott. This work is licensed under the Creative
 * Commons Attribution 3.0 Un-ported License. To view a copy of this license,
 * visit http://creativecommons.org/licenses/by/3.0/ or send a letter to
 *         Creative Commons,
 *         444 Castro Street, Suite 900,
 *         Mountain View, California, 94041, USA.
 */

(function (chrome) {
  chrome.action.onClicked.addListener(() => {
    const url = chrome.runtime.getURL('html/index.html');
    chrome.tabs
      .query({ url })
      .then((tabs) => {
        const tab = tabs[0];
        if (tab?.id != null) {
          chrome.tabs.update(tab.id, { active: true }).catch((e: unknown) => {
            console.error(e);
          });
          if (tab.windowId != null) {
            chrome.windows.update(tab.windowId, { focused: true }).catch((e: unknown) => {
              console.error(e);
            });
          }
          return;
        }

        chrome.tabs.create({ url }).catch((e: unknown) => {
          console.error(e);
        });
      })
      .catch((e: unknown) => {
        console.error(e);
      });
  });
})(chrome);

export {};
