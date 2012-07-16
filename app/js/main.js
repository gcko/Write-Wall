/* Copyright 2012 Jared M. Scott */
/**
 * This work is licensed under the Creative Commons Attribution 3.0 Unported License.
 *  To view a copy of this license, visit http://creativecommons.org/licenses/by/3.0/
 *  or send a letter to
 *      Creative Commons,
 *      444 Castro Street, Suite 900,
 *      Mountain View, California, 94041, USA.
 */
(function ($, chrome) {
    'use strict';
    var CHANGE_DELAY = 6000, // 6 second sync delay
        STORAGE_KEY = 'text',
        remoteStoredText = '',
        $textArea = $('#text'),
        storage = chrome.storage,
        storageObject = {};


    // create bookmark to store data (if doesn't exist)
    storage.sync.get(STORAGE_KEY, function(items) {
        if (items[STORAGE_KEY] != null) {
            remoteStoredText = items[STORAGE_KEY];
        } else {
            // create the stored text area
            var storageObject = {};
            storageObject[STORAGE_KEY] = remoteStoredText;
            storage.sync.set(storageObject, function(result) { /* empty */ });
        }
        $textArea.val(remoteStoredText); // set the value locally either way
    });

    // update the bookmark which in turns fires the onChange event below
    $textArea.on('keyup', function(evt, data) {
        storageObject[STORAGE_KEY] = $textArea.val();
        storage.sync.set(storageObject, function(result) { /* empty */ });
    });

    // don't overload the bookmark API
    storage.onChanged.addListener(
        _.debounce(function(changes, namespace) {
            remoteStoredText = changes[STORAGE_KEY].newValue;
            $textArea.val(remoteStoredText || '');
        }, CHANGE_DELAY));

})(jQuery, chrome);