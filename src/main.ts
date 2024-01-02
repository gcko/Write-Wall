/*
 * Copyright (c) 2023 Jared M. Scott. This work is licensed under the Creative
 * Commons Attribution 3.0 Un-ported License. To view a copy of this license,
 * visit http://creativecommons.org/licenses/by/3.0/ or send a letter to
 *         Creative Commons,
 *         444 Castro Street, Suite 900,
 *         Mountain View, California, 94041, USA.
 */

import { throttle } from './utils.js';

const HOUR_IN_SECONDS = 60 * 60;
const FOUR_SECONDS_IN_MIL = 4000;

/* global chrome:readonly, _:readonly */
((chrome) => {
  let CHANGE_DELAY =
      (chrome.storage.sync.MAX_WRITE_OPERATIONS_PER_HOUR / HOUR_IN_SECONDS) * FOUR_SECONDS_IN_MIL, // 4 second sync delay
    LEGACY_STORAGE_KEY = 'text',
    STORAGE_KEY = 'v2',
    remoteStoredText = '',
    textAreaEl = document.getElementById('text') as HTMLTextAreaElement,
    storage = chrome.storage,
    storageObject: Record<string, string> = {};

  const updateUsage = () => {
    const numCharEl = document.getElementById('num-chars')
    if (numCharEl) {
      storage.sync.getBytesInUse(
        null,
        (inUse) => (numCharEl.innerText = `${inUse}`)
      );
    }
  };

  // Set the number of bytes in use
  updateUsage();

  // get or create key to store data
  storage.sync.get([LEGACY_STORAGE_KEY, STORAGE_KEY], (items) => {
    if (items[LEGACY_STORAGE_KEY] != null) {
      // Migrate stored data from the previous version to the new version
      remoteStoredText = items[LEGACY_STORAGE_KEY];
      storageObject[STORAGE_KEY] = remoteStoredText;
      storage.sync.set(storageObject).catch((e) => console.warn(e));
      // Remove the legacy key
      storage.sync.remove(LEGACY_STORAGE_KEY).catch((e) => console.warn(e));
    } else if (items[STORAGE_KEY] != null) {
      remoteStoredText = items[STORAGE_KEY];
    }
    // Value defaults to an empty string if there is no stored value
    textAreaEl.value = remoteStoredText;
  });

  const throttledStorageUpdate = throttle(() => {
    storageObject[STORAGE_KEY] = textAreaEl.value;
    storage.sync.set(storageObject).then(updateUsage).catch((e) => console.warn(e));
  }, CHANGE_DELAY);


  // update storage which in turn updates usage
  textAreaEl.addEventListener('keyup', throttledStorageUpdate);
})(chrome);
