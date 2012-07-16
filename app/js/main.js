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
        remoteStoredText = '',
        $textArea = $('#text'),
        storage = chrome.storage;

    // create bookmark to store data (if doesn't exist)
    storage.sync.get('text', function(items) {
        if (items.text != null) {
            remoteStoredText = items.text;
        } else {
            // create the stored text area
            storage.set({
                text: remoteStoredText // default to empty string
            }, function(result) {
                // do something?
            });
        }
        $textArea.val(remoteStoredText); // set the value either way
    });

    // update the bookmark which in turns fires the onChange event below
    $textArea.on('keyup', function(evt, data) {
        storage.sync.set({text: $textArea.val()}, function(result) { /* empty */ });
    });

    // don't overload the bookmark API
    storage.onChanged.addListener(
        _.debounce(function(changes, namespace) {
            remoteStoredText = changes.text;
            $textArea.val(remoteStoredText || '');
        }, CHANGE_DELAY));

})(jQuery, chrome);
