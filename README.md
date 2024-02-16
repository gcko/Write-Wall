Write-Wall
==========

A Chrome extension very similar to "Write Space", Write Wall goes a step further and syncs text with the logged-in Google Account
Write Wall was created to simply be able to share text content across multiple computers running under the same Chrome account. It's a simple concept with a simple solution: create an extension that allows users to paste whatever content and access it from any computer running Chrome.

I hope you find it as useful as I have and please feel free to fork this project on Github and/or provide suggestions for improving Write Wall.

## Version history

### 2.1.5 | Feb 16, 2024
- Bump packages to latest
- Update copyright to include 2024
- Remove unused package

### 2.1.2 | May 11, 2023
- Update licensing language to CC BY SA 4.0
- Bump packages to latest

### 2.1.1 | May 11, 2023
- Cleanup the usage of magic constants
- Streamline the throttling behavior

### 2.1.0 | May 10, 2023
- Migrate to Typescript
- Enable Webpack and building via Webpack
- Remove Dependency on lodash

### 2.0.5 | May 5, 2023
- Upgrade the manifest.json file to manifest v3
- Standardize the copyright notices
- Update to node v20 and switch to using npm from yarn

### 2.0.4 | Jul 4, 2022
Remove "Tabs" permission on package

### 2.0.3 | Sep 4, 2020
Remove "Dev" naming convention on package

### 2.0.2 | Sep 3, 2020
Update the Content Security Policy for the inline script to initialize Google Analytics.

### 2.0.1 | Sep 2, 2020
This version moves the size indicator to the top of the viewing area for ease of use.

### 2.0 | Sep 2, 2020
This version updates many of the internal inconsistencies with prior versions. Your data will no longer be wiped out while using the extension. In addition, writing within the tool will no longer have issues with intermittently removing the last few characters inputted. Please let me know how it works!
