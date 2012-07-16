/* Copyright 2012 Jared M. Scott */
/**
 * This work is licensed under the Creative Commons Attribution 3.0 Unported License.
 *  To view a copy of this license, visit http://creativecommons.org/licenses/by/3.0/
 *  or send a letter to
 *      Creative Commons,
 *      444 Castro Street, Suite 900,
 *      Mountain View, California, 94041, USA.
 */
(function(chrome){
    chrome.browserAction.onClicked.addListener(function(tab) {
        chrome.tabs.create({url:chrome.extension.getURL("html/index.html")});
    });

    // correctly set chrome.storage settings
    chrome.storage.sync.QUOTA_BYES_PER_ITEM = 102400; // 100 KB
    chrome.storage.sync.MAX_SUSTAINED_WRITE_OPERATIONS_PER_MINUTE = 60; // 1 per second
    chrome.storage.sync.MAX_WRITE_OPERATIONS_PER_HOUR = 3600; // 1 per second for an hour

})(chrome)

