#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { validateWorkflow } from './validate-core.mjs';

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/validate.mjs <workflow.json>');
  process.exit(2);
}

let raw;
try {
  raw = readFileSync(file, 'utf8');
} catch (err) {
  console.error(`REJECTED: ${file} — cannot read file (${err.message})`);
  process.exit(1);
}

let doc;
try {
  doc = JSON.parse(raw.replace(/^\uFEFF/, ''));
} catch (err) {
  console.error(`REJECTED: ${file} — not valid JSON (${err.message})`);
  process.exit(1);
}

const { valid, errors } = validateWorkflow(doc);
if (!valid) {
  console.error(`REJECTED: ${file}`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`OK: ${file}`);
