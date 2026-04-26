#!/usr/bin/env node
// Scans apps/mobile/src for Chinese residues outside of locale JSONs.
// Usage: node apps/mobile/scripts/extract-cjk.mjs

import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const ROOT = new URL('../src/', import.meta.url).pathname;
const EXCLUDE_DIRS = new Set(['__tests__', '__snapshots__']);
const EXCLUDE_FILES = new Set(['zh.json', 'en.json']);
const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const HAN = /\p{Script=Han}/u;

async function walk(dir, acc = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name)) continue;
      await walk(join(dir, entry.name), acc);
    } else if (entry.isFile()) {
      if (EXCLUDE_FILES.has(entry.name)) continue;
      if (!EXTENSIONS.has(entry.name.slice(entry.name.lastIndexOf('.')))) continue;
      acc.push(join(dir, entry.name));
    }
  }
  return acc;
}

const files = await walk(ROOT);
let hits = 0;
for (const file of files) {
  const text = await readFile(file, 'utf8');
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (HAN.test(lines[i])) {
      console.log(`${relative(process.cwd(), file)}:${i + 1}:${lines[i].trim()}`);
      hits++;
    }
  }
}

if (hits > 0) {
  console.error(`\nFound ${hits} residual CJK line(s). Migrate them via i18n keys.`);
  process.exit(1);
} else {
  console.log('Clean — no residual CJK outside locale files.');
}
