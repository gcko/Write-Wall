/*
 * Copyright (c) 2023-2024 Jared M. Scott. This work is licensed under the Creative
 * Commons Attribution 3.0 Un-ported License. To view a copy of this license,
 * visit http://creativecommons.org/licenses/by/3.0/ or send a letter to
 *         Creative Commons,
 *         444 Castro Street, Suite 900,
 *         Mountain View, California, 94041, USA.
 */
const AdmZip = require('adm-zip');
const path = require('path');
const fs = require('fs');

async function main() {
  // clear existing 'app.zip' file
  console.log('Removing existing app.zip file');
  function clean() {
    return new Promise((resolve, reject) => {
      fs.rm(path.resolve(__dirname, 'app.zip'), {
        force: true
      }, (err) => {
        if (err) {
          return reject(err);
        }
        resolve();
      });
    });
  }


  async function createZipArchive() {
    const outputFileName = 'app.zip';
    const zip = new AdmZip();
    zip.addLocalFolder('./dist', undefined, undefined, undefined);
    zip.writeZip(outputFileName, (error) => {
      if (error) {
        console.error('zip creation failed, ', error);
        throw error;
      } else {
        console.log('zip created successfully at ', outputFileName);
      }
    });
  }

  return clean().then(() => createZipArchive());
}

main().then(() => {
  console.log('Build finished successfully');
}).catch((e) => {
  console.error('Build failed, ', e);
  process.exitCode = 1;
});
