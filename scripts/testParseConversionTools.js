// One-off accuracy test for the Parse (conversiontools.io) document-extraction
// API against our two real test bills - NOT wired into the app's request
// pipeline. Run manually: node scripts/testParseConversionTools.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const API_URL = 'https://api-parse.conversiontools.io/v1/extract';
const KEY = process.env.PARSE_API_KEY;
const SCHEMA_ID = '2074f5dfc1a24650a808180bac09c68e';

async function extract(filePath) {
  const buffer = fs.readFileSync(filePath);
  const blob = new Blob([buffer]);
  const form = new FormData();
  form.append('file', blob, path.basename(filePath));
  form.append('wait', '60');
  form.append('schema_id', SCHEMA_ID);

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}` },
    body: form,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
  return JSON.parse(text);
}

async function main() {
  for (const file of ['test-bills/amazon-invoice.pdf', 'test-bills/handwritten-gst-invoice.jpg']) {
    console.log(`\n=== ${file} ===`);
    const start = Date.now();
    try {
      const result = await extract(file);
      console.log(`(${((Date.now() - start) / 1000).toFixed(1)}s)`);
      console.log(JSON.stringify(result, null, 2));
    } catch (err) {
      console.error('FAILED:', err.message);
    }
  }
}

main();
