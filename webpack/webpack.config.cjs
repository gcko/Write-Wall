/*
 * Copyright (c) 2023 Jared M. Scott. This work is licensed under the Creative
 * Commons Attribution 3.0 Un-ported License. To view a copy of this license,
 * visit http://creativecommons.org/licenses/by/3.0/ or send a letter to
 *         Creative Commons,
 *         444 Castro Street, Suite 900,
 *         Mountain View, California, 94041, USA.
 */

const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');
module.exports = {
  mode: 'production',
  devtool: 'inline-source-map',
  entry: {
    main: path.resolve(__dirname, '..', 'src', 'main.ts'),
    service_worker: path.resolve(__dirname, '..', 'src', 'service_worker.ts')
  },
  output: {
    path: path.join(__dirname, '../dist'),
    filename: '[name].bundle.js',
    clean: true
  },
  resolve: {
    extensionAlias: {
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
    },
    extensions: ['.tsx', '.ts', '.js'],
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: [{
          loader: 'ts-loader',
          options: {
            configFile: path.resolve(__dirname, '..', 'tsconfig.build.json')
          }
        }],
        exclude: /node_modules/
      }
    ]
  },
  plugins: [
    new CopyPlugin({
      patterns: [
        {from: '.', to: '.', context: 'public'},
        {
          from: path.resolve(__dirname, '..', 'src', 'css'),
          to: path.resolve(__dirname, '..', 'dist', 'css'),
          context: 'public',
        },
        {
          from: path.resolve(__dirname, '..', 'src', 'html'),
          to: path.resolve(__dirname, '..', 'dist', 'html'),
          context: 'public',
        },
        {
          from: path.resolve(__dirname, '..', 'src', 'images'),
          to: path.resolve(__dirname, '..', 'dist', 'images'),
          context: 'public',
        }
      ]
    })
  ]
}
