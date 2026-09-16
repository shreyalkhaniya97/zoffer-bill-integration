const pdfParse = require('pdf-parse');
const ollama = require('./ollama');
const parseConversionTools = require('./parseConversionTools');

const TEXT_LENGTH_THRESHOLD = 50; // below this, treat the PDF as scanned (no real text layer)

// Coerces any stray "8%" / "1,234.50" strings the model still slips through,
// and backfills amount/totalAmount deterministically instead of trusting the
// model's arithmetic - a safety net on top of the schema-constrained decoding.
function toNumber(value) {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[^0-9.-]/g, '');
  const num = parseFloat(cleaned);
  return Number.isFinite(num) ? num : null;
}

// Vision models on a busy table can re-read the last row instead of the real
// next one, producing an exact duplicate line item. That's silently wrong
// once it reaches Zoho, which sums quantity*rate per line for the bill total -
// it never sees our totalAmount field at all. Drop exact repeats.
function dedupeLineItems(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.quantity}|${item.unitPrice}|${item.amount}`;
    if (seen.has(key) && item.quantity != null) return false;
    seen.add(key);
    return true;
  });
}

function normalizeExtraction(extracted) {
  let lineItems = (extracted.lineItems || []).map((item) => {
    const quantity = toNumber(item.quantity);
    const unitPrice = toNumber(item.unitPrice);
    const taxRate = toNumber(item.taxRate);
    let amount = toNumber(item.amount);
    if (amount == null && quantity != null && unitPrice != null) {
      amount = Math.round(quantity * unitPrice * 100) / 100;
    }
    return { ...item, quantity, unitPrice, taxRate, amount };
  });
  lineItems = dedupeLineItems(lineItems);

  let totalAmount = toNumber(extracted.totalAmount);
  if (totalAmount == null && lineItems.some((i) => i.amount != null)) {
    totalAmount = Math.round(lineItems.reduce((sum, i) => sum + (i.amount || 0), 0) * 100) / 100;
  }
  const overallTaxRate = toNumber(extracted.overallTaxRate);

  return { ...extracted, lineItems, totalAmount, overallTaxRate };
}

// pdf-parse concatenates all text in document order, which flattens table
// columns into one stream (e.g. a tax-rate cell and an amount cell end up
// right next to each other with nothing marking which is which). This
// reconstructs rows/columns from each text fragment's real x/y position on
// the page, so numbers that are visually in the same table row stay grouped
// together for the LLM - fixes the "relation" problem without touching OCR,
// since the text itself is already being read correctly.
const Y_BUCKET = 3; // px tolerance for "same line" (baselines wobble slightly)

function layoutAwarePageRender(pageData) {
  return pageData.getTextContent().then((textContent) => {
    const lines = new Map();
    for (const item of textContent.items) {
      if (!item.str.trim()) continue;
      const x = item.transform[4];
      const y = Math.round(item.transform[5] / Y_BUCKET) * Y_BUCKET;
      if (!lines.has(y)) lines.set(y, []);
      lines.get(y).push({ x, str: item.str });
    }
    const rows = [...lines.entries()]
      .sort((a, b) => b[0] - a[0]) // PDF y-axis increases upward -> top of page first
      .map(([, items]) =>
        items
          .sort((a, b) => a.x - b.x)
          .map((i) => i.str)
          .join(' | ')
      );
    return rows.join('\n');
  });
}

async function renderFirstPdfPageToBase64(buffer) {
  // pdf-to-img is ESM-only (top-level await) - can't require() it from CJS, dynamic import instead.
  const { pdf: pdfToImg } = await import('pdf-to-img');
  const doc = await pdfToImg(buffer, { scale: 2 });
  const page = await doc.getPage(1); // Buffer (PNG)
  return page.toString('base64');
}

/**
 * Figures out image vs digital-PDF vs scanned-PDF, runs the matching Ollama
 * extraction, and returns a uniform result shape.
 */
async function extractBillDataOllama(file) {
  const isImage = file.mimetype.startsWith('image/');

  if (isImage) {
    const extracted = normalizeExtraction(await ollama.extractFromImage(file.buffer.toString('base64')));
    return { extracted, sourceFileType: 'image', extractionMethod: 'ollama-vision' };
  }

  if (file.mimetype === 'application/pdf') {
    const parsed = await pdfParse(file.buffer, { pagerender: layoutAwarePageRender });
    const text = (parsed.text || '').trim();

    if (text.length > TEXT_LENGTH_THRESHOLD) {
      const extracted = normalizeExtraction(await ollama.extractFromText(text));
      return { extracted, sourceFileType: 'pdf-text', extractionMethod: 'ollama-text' };
    }

    // No usable text layer -> render page 1 and fall back to vision, same as a photo.
    const imageBase64 = await renderFirstPdfPageToBase64(file.buffer);
    const extracted = normalizeExtraction(await ollama.extractFromImage(imageBase64));
    return { extracted, sourceFileType: 'pdf-scanned', extractionMethod: 'ollama-vision' };
  }

  throw new Error(`Unsupported file type: ${file.mimetype}`);
}

// Parse's API takes the raw file directly and handles PDF-vs-image, table
// layout, and OCR all server-side - no need for our own branching/layout-
// reconstruction logic on this path.
async function extractBillDataParse(file) {
  const result = await parseConversionTools.extractBillData(file);
  return { ...result, extracted: normalizeExtraction(result.extracted) };
}

// EXTRACTION_PROVIDER lets the pipeline swap between the fully-local Ollama
// path and the hosted Parse API without ripping either one out - see README
// for the accuracy/speed/privacy trade-off between them.
async function extractBillData(file) {
  const provider = process.env.EXTRACTION_PROVIDER || 'ollama';
  if (provider === 'parse') return extractBillDataParse(file);
  return extractBillDataOllama(file);
}

module.exports = { extractBillData };
