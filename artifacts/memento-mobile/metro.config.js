const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Exclude Stripe runtime temp directories (created briefly then deleted, causing watcher errors)
config.resolver.blockList = [
  /stripe_tmp_[^/]+\//,
];

module.exports = config;
