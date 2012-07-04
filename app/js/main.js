(function ($, chrome) {
    'use strict';
    var CHANGE_DELAY,
        remoteStoredText,
        bookmark,
        bookmarkId,
        bookmarkUrlString = 'http://simpleTextSyncData?data=',
        $textArea = $('#text'),
        queryStringIdx,
        remoteStoredText,
        onChanged,
        onChangedBounced,
        url;

    // create bookmark to store data (if doesn't exist)
    chrome.bookmarks.search('simpleTextSyncData', function(results) {
        if (results.length === 0) {
            chrome.bookmarks.create({
                title: 'simpleTextSyncData',
                url: bookmarkUrlString
            }, function(bookmark){
                bookmarkId = bookmark.id;
            });
        } else {
            bookmark = results[0];
            bookmarkId = bookmark.id;
            queryStringIdx = bookmark.url.indexOf('=') + 1; //first index of '='
            remoteStoredText = bookmark.url.slice(queryStringIdx, bookmark.url.length);
        }
        if (remoteStoredText != null) {
            $textArea.val(decodeURIComponent(remoteStoredText));
        }
    });

    // update the bookmark which in turns fires the onChange event below
    $textArea.on('keyup', function(evt, data) {
        chrome.bookmarks.update(bookmarkId, {
            url: bookmarkUrlString + encodeURIComponent($textArea.val())
        }, function(result) { /* empty */ });
    });

    onChanged = function(id, bookmark) {
        url = bookmark.url;
        remoteStoredText = decodeURIComponent(url.slice(url.indexOf('=') + 1, url.length));
        if (id === bookmarkId && remoteStoredText !== $textArea.val()) {
            $textArea.val(remoteStoredText);
        }
    };
    // don't overload the bookmark API
    onChangedBounced = _.debounce(onChanged, CHANGE_DELAY);

    chrome.bookmarks.onChanged.addListener(onChangedBounced);

})(jQuery, chrome)
