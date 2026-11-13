const webpack = require('webpack');
const path = require('path');

module.exports = {
  webpack: function(config, env) {
    // --- THE NUCLEAR FIX ---
    config.resolve.exportsFields = []; 
    // -----------------------

    // 1. Standard Polyfills
    config.resolve.fallback = {
      ...config.resolve.fallback,
      "crypto": require.resolve("crypto-browserify"),
      "stream": require.resolve("stream-browserify"),
      "assert": require.resolve("assert"),
      "http": require.resolve("stream-http"),
      "https": require.resolve("https-browserify"),
      "os": require.resolve("os-browserify"),
      "url": require.resolve("url"),
      "vm": require.resolve("vm-browserify"),
      "process": require.resolve("process/browser"),
      "buffer": require.resolve("buffer/"),
    };

    // 2. Global Variables
    config.plugins = (config.plugins || []).concat([
      new webpack.ProvidePlugin({
        process: 'process/browser',
        Buffer: ['buffer', 'Buffer']
      })
    ]);

    // 3. Allow .mjs files
    config.module.rules.push({
      test: /\.m?js$/,
      resolve: {
        fullySpecified: false,
      },
    });

    // 4. Ignore Source Maps for node_modules
    config.module.rules.push({
      test: /\.js$/,
      enforce: "pre",
      use: ["source-map-loader"],
      exclude: /node_modules/,
    });
    config.ignoreWarnings = [/Failed to parse source map/];
    
    // 5. Extensions
    config.resolve.extensions = ['.mjs', '.js', '.jsx', '.ts', '.tsx', '.json', ...config.resolve.extensions];

    // 6. Fix for "Can't resolve .js extension" when it is actually .ts
    config.resolve.extensionAlias = {
        '.js': ['.ts', '.tsx', '.js', '.jsx'],
        '.mjs': ['.mts', '.mjs']
    };

    return config;
  },
};
