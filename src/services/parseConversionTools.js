const API_BASE = 'https://api-parse.conversiontools.io/v1';
const API_KEY = process.env.PARSE_API_KEY;
const SCHEMA_ID = process.env.PARSE_SCHEMA_ID || '2074f5dfc1a24650a808180bac09c68e';

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 120 * 1000;

// Parse writes Indian-style amounts like "3270-0" (whole-3270, paise-0,
// hyphen instead of a decimal point) as well as "₹354.05" - strip both to a
// plain number the same way ollama.js's toNumber() does for consistency.
function toNumber(value) {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  const cleaned = String(value)
    .replace(/[₹,%]/g, '')
    .replace(/(\d)-(\d{1,2})$/, '$1.$2') // "3270-0" -> "3270.0"
    .trim();
  const num = parseFloat(cleaned);
  return Number.isFinite(num) ? num : null;
}

async function submit(buffer, filename) {
  const form = new FormData();
  form.append('file', new Blob([buffer]), filename);
  form.append('wait', '60');
  form.append('schema_id', SCHEMA_ID);

  const res = await fetch(`${API_BASE}/extract`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}` },
    body: form,
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Parse API error: ${JSON.stringify(body)}`);
  return body;
}

async function pollUntilComplete(id) {
  const start = Date.now();
  while (Date.now() - start < POLL_TIMEOUT_MS) {
    const res = await fetch(`${API_BASE}/extractions/${id}`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    const body = await res.json();
    if (!res.ok) throw new Error(`Parse API error: ${JSON.stringify(body)}`);
    if (body.status === 'completed') return body;
    if (body.status === 'failed') throw new Error(`Parse extraction failed: ${body.error || 'unknown error'}`);
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`Parse extraction ${id} did not complete within ${POLL_TIMEOUT_MS / 1000}s`);
}

// Maps Parse's schema (sold_by/billing_address/items/totals, all Indian-
// amount-style strings) into the same shape ollama.js produces, so it can
// drop into the existing ragMiddleware/zohoMappingMiddleware unchanged.
function normalize(data) {
  const lineItems = (data.items || []).map((item) => {
    const quantity = toNumber(item.quantity);
    const unitPrice = toNumber(item.unit_price);
    let amount = toNumber(item.net_amount ?? item.total_amount);
    if (amount == null && quantity != null && unitPrice != null) {
      amount = Math.round(quantity * unitPrice * 100) / 100;
    }
    return {
      description: item.description || null,
      hsnCode: item.hsn || null,
      quantity,
      unitPrice,
      taxRate: toNumber(item.tax_rate),
      amount,
    };
  });

  const totalAmount = toNumber(data.totals?.total_amount);
  const taxAmount = toNumber(data.totals?.tax_amount);
  const subTotal = lineItems.reduce((sum, i) => sum + (i.amount || 0), 0);
  // No per-line tax_rate given (e.g. tax stated once for the whole bill) -
  // derive an effective overall rate from the invoice-level tax/subtotal so
  // zohoMappingMiddleware's existing fallback still applies it per line.
  const overallTaxRate =
    lineItems.every((i) => i.taxRate == null) && taxAmount != null && subTotal > 0
      ? Math.round((taxAmount / subTotal) * 1000) / 10
      : null;

  return {
    vendorName: data.sold_by?.name || null,
    invoiceNumber: data.invoice_details?.invoice_number || null,
    invoiceDate: data.invoice_details?.invoice_date || null,
    lineItems,
    totalAmount,
    overallTaxRate,
  };
}

async function extractBillData(file) {
  const submitted = await submit(file.buffer, file.originalname);
  const result = submitted.status === 'completed' ? submitted : await pollUntilComplete(submitted.id);
  const extracted = normalize(result.data);
  const sourceFileType = file.mimetype.startsWith('image/') ? 'image' : 'pdf-text';
  return { extracted, sourceFileType, extractionMethod: 'parse-conversiontools' };
}

module.exports = { extractBillData };
