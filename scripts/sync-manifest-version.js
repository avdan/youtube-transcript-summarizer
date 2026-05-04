#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8'));
const manifestPath = path.resolve(__dirname, '..', 'public', 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

if (manifest.version === pkg.version) {
  process.exit(0);
}

manifest.version = pkg.version;
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`public/manifest.json version → ${pkg.version}`);
