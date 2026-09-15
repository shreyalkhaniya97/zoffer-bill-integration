const zoho = require('../services/zoho');

function toIsoDate(value) {
  const parsed = value ? new Date(value) : null;
  if (parsed && !isNaN(parsed)) return parsed.toISOString().slice(0, 10);
  return new Date().toISOString().slice(0, 10); // fall back to today
}

async function zohoMappingMiddleware(req, res, next) {
  try {
    const bill = req.extraction.extracted;
    const [vendorId, expenseAccountId] = await Promise.all([
      zoho.findOrCreateVendor(bill.vendorName),
      zoho.getDefaultExpenseAccountId(),
    ]);

    const rawItems = bill.lineItems?.length ? bill.lineItems : [{ description: 'Bill total', amount: bill.totalAmount }];
    const lineItems = await Promise.all(
      rawItems.map(async (item) => {
        // rate is the PRE-tax unit price - Zoho applies tax_id on top of
        // rate*quantity itself, so passing a tax-inclusive "amount" here
        // instead would double up the tax in Zoho's computed total.
        // Fall back to the whole-bill tax rate when this line has none of
        // its own - common on invoices that state tax once near the total
        // rather than per line item (see ollama.js EXTRACTION_INSTRUCTIONS).
        const taxId = await zoho.findTaxIdForRate(item.taxRate ?? bill.overallTaxRate);
        return {
          account_id: expenseAccountId,
          name: (item.description || 'Line item').slice(0, 100),
          description: item.description || '',
          rate: item.unitPrice ?? item.amount ?? 0,
          quantity: item.quantity ?? 1,
          ...(taxId ? { tax_id: taxId } : {}),
        };
      })
    );

    req.zohoPayload = {
      vendor_id: vendorId,
      bill_number: bill.invoiceNumber || `AUTO-${Date.now()}`,
      date: toIsoDate(bill.invoiceDate),
      line_items: lineItems,
    };
    req.zohoVendorId = vendorId;
    next();
  } catch (err) {
    console.error('[zoho-mapping] failed:', err);
    res.status(502).json({ error: `Zoho mapping/lookup failed: ${err.message}` });
  }
}

module.exports = zohoMappingMiddleware;
