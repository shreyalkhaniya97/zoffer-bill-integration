const axios = require('axios');

const HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
const TEXT_MODEL = process.env.OLLAMA_TEXT_MODEL || 'llama3.2:3b';
const VISION_MODEL = process.env.OLLAMA_VISION_MODEL || 'llama3.2-vision';
const EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text';

// Local inference on a laptop GPU can be slow, especially the first call after
// a model loads into VRAM. Timeout is intentionally generous.
const client = axios.create({ baseURL: HOST, timeout: 5 * 60 * 1000 });

const EXTRACTION_INSTRUCTIONS = `You are extracting structured data from a business bill/invoice.
Numeric fields must be plain numbers - no currency symbols, no "%", no commas, no units.
If a field is illegible or missing, use null. Do not invent values. Compute "amount" as
quantity * unitPrice when both are present, and "totalAmount" as the sum of line item
amounts, unless the bill states a different total explicitly.

Field meanings, do not confuse these:
- "taxRate" is a tax PERCENTAGE (e.g. GST/IGST rate) - always a small number, typically 0-30.
- "amount" and "totalAmount" are MONEY VALUES - typically much larger than taxRate.
- "hsnCode" is numeric (e.g. "8205"), often on its own line labeled "HSN:". A code that mixes
  letters and digits (e.g. "B0921N4SZB") is a product/ASIN code, not an hsnCode - put it in
  the description instead, never in hsnCode.
If the source text is a flattened table (numbers not clearly aligned to column headers),
use the nearby label text to decide which number is which - never assume position/order.
A single item's description may wrap across several consecutive lines before that item's
price/qty/tax/total figures appear together, often several lines later or on their own line -
merge wrapped description lines into ONE line item, do not create a separate line item just
because a product code or part of a long description sits on its own line.

Some invoices state tax ONCE for the whole bill (e.g. "IGST @ 18%" near the taxable value/
total, with no per-line tax column) rather than per line item. When that's the case, leave
every line item's "taxRate" null and put that percentage in the top-level "overallTaxRate"
field instead - do not guess a per-line rate that isn't actually printed next to that line.`;

// Constrains Ollama's structured-output decoding so numeric fields cannot come
// back as strings (e.g. "8%") - stronger than relying on prompt wording alone.
const EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    vendorName: { type: ['string', 'null'] },
    invoiceNumber: { type: ['string', 'null'] },
    invoiceDate: { type: ['string', 'null'] },
    lineItems: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          description: { type: ['string', 'null'] },
          hsnCode: { type: ['string', 'null'] },
          quantity: { type: ['number', 'null'] },
          unitPrice: { type: ['number', 'null'] },
          taxRate: { type: ['number', 'null'] },
          amount: { type: ['number', 'null'] },
        },
        required: ['description', 'hsnCode', 'quantity', 'unitPrice', 'taxRate', 'amount'],
      },
    },
    totalAmount: { type: ['number', 'null'] },
    overallTaxRate: { type: ['number', 'null'] },
  },
  required: ['vendorName', 'invoiceNumber', 'invoiceDate', 'lineItems', 'totalAmount', 'overallTaxRate'],
};

function stripJsonFences(text) {
  return text
    .trim()
    .replace(/^```(json)?/i, '')
    .replace(/```$/, '')
    .trim();
}

function parseModelJson(raw) {
  const cleaned = stripJsonFences(raw);
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error(`Model did not return parseable JSON: ${err.message}`);
  }
}

async function extractFromText(rawText) {
  const { data } = await client.post('/api/generate', {
    model: TEXT_MODEL,
    prompt: `${EXTRACTION_INSTRUCTIONS}\n\nBill text below is laid out one PDF line per text line, with "|" ` +
      `separating fragments that sit in different columns on that same line (reconstructed from the PDF's ` +
      `actual layout) - use these groupings to tell which numbers belong to which row/label.\n\n${rawText}`,
    format: EXTRACTION_SCHEMA,
    options: { temperature: 0 },
    stream: false,
  });
  return parseModelJson(data.response);
}

async function extractFromImage(imageBase64) {
  const { data } = await client.post('/api/generate', {
    model: VISION_MODEL,
    prompt: EXTRACTION_INSTRUCTIONS,
    images: [imageBase64],
    format: EXTRACTION_SCHEMA,
    options: { temperature: 0 },
    stream: false,
  });
  return parseModelJson(data.response);
}

async function embed(text) {
  const { data } = await client.post('/api/embeddings', {
    model: EMBED_MODEL,
    prompt: text,
  });
  return data.embedding;
}

module.exports = { extractFromText, extractFromImage, embed };
