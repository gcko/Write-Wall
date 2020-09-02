/* Copyright 2012-2020 Jared M. Scott */
/**
 * This work is licensed under the Creative Commons Attribution 3.0 Un-ported License.
 *  To view a copy of this license, visit http://creativecommons.org/licenses/by/3.0/
 *  or send a letter to
 *      Creative Commons,
 *      444 Castro Street, Suite 900,
 *      Mountain View, California, 94041, USA.
 */

/* global chrome:readonly, _:readonly */
((chrome) => {
  let CHANGE_DELAY =
      (chrome.storage.sync.MAX_WRITE_OPERATIONS_PER_HOUR / 3600) * 4000, // 2 second sync delay
    LEGACY_STORAGE_KEY = 'text',
    STORAGE_KEY = 'v2',
    remoteStoredText = '',
    textAreaEl = document.getElementById('text'),
    storage = chrome.storage,
    storageObject = {};

  const updateUsage = () => {
    storage.sync.getBytesInUse(
      null,
      (inUse) => (document.getElementById('num-chars').innerText = `${inUse}`)
    );
  };

  // Set the number of bytes in use
  updateUsage();

  // get or create key to store data
  storage.sync.get([LEGACY_STORAGE_KEY, STORAGE_KEY], (items) => {
    if (items[LEGACY_STORAGE_KEY] != null) {
      // Migrate stored data from the previous version to the new version
      remoteStoredText = items[LEGACY_STORAGE_KEY];
      storageObject[STORAGE_KEY] = remoteStoredText;
      storage.sync.set(storageObject);
      // Remove the legacy key
      storage.sync.remove(LEGACY_STORAGE_KEY);
    } else if (items[STORAGE_KEY] != null) {
      remoteStoredText = items[STORAGE_KEY];
    }
    // Value defaults to an empty string if there is no stored value
    textAreaEl.value = remoteStoredText;
  });

  const throttledStorageUpdate = _.throttle(() => {
    storageObject[STORAGE_KEY] = textAreaEl.value;
    storage.sync.set(storageObject);
  }, CHANGE_DELAY);

  const throttledUsageUpdate = _.throttle(updateUsage, 1000);

  // update storage which in turns fires the onChange event below
  textAreaEl.addEventListener('keyup', throttledStorageUpdate);
  textAreaEl.addEventListener('keyup', throttledUsageUpdate);
})(chrome);
