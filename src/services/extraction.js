const pdfParse = require('pdf-parse');
const ollama = require('./ollama');

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

function normalizeExtraction(extracted) {
  const lineItems = (extracted.lineItems || []).map((item) => {
    const quantity = toNumber(item.quantity);
    const unitPrice = toNumber(item.unitPrice);
    const taxRate = toNumber(item.taxRate);
    let amount = toNumber(item.amount);
    if (amount == null && quantity != null && unitPrice != null) {
      amount = Math.round(quantity * unitPrice * 100) / 100;
    }
    return { ...item, quantity, unitPrice, taxRate, amount };
  });

  let totalAmount = toNumber(extracted.totalAmount);
  if (totalAmount == null && lineItems.some((i) => i.amount != null)) {
    totalAmount = Math.round(lineItems.reduce((sum, i) => sum + (i.amount || 0), 0) * 100) / 100;
  }

  return { ...extracted, lineItems, totalAmount };
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
async function extractBillData(file) {
  const isImage = file.mimetype.startsWith('image/');

  if (isImage) {
    const extracted = normalizeExtraction(await ollama.extractFromImage(file.buffer.toString('base64')));
    return { extracted, sourceFileType: 'image', extractionMethod: 'ollama-vision' };
  }

  if (file.mimetype === 'application/pdf') {
    const parsed = await pdfParse(file.buffer);
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

module.exports = { extractBillData };
