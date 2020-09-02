/* Copyright 2012-2020 Jared M. Scott */
'use strict';
/**
 * This work is licensed under the Creative Commons Attribution 3.0 Un-ported License.
 *  To view a copy of this license, visit http://creativecommons.org/licenses/by/3.0/
 *  or send a letter to
 *      Creative Commons,
 *      444 Castro Street, Suite 900,
 *      Mountain View, California, 94041, USA.
 */
(function (chrome) {
  chrome.browserAction.onClicked.addListener(function (tab) {
    chrome.tabs.create({url: chrome.extension.getURL("html/index.html")});
  });

})(chrome);

