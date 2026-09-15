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

    const lineItems = (bill.lineItems?.length ? bill.lineItems : [{ description: 'Bill total', amount: bill.totalAmount }]).map(
      (item) => ({
        account_id: expenseAccountId,
        name: (item.description || 'Line item').slice(0, 100),
        description: item.description || '',
        rate: item.unitPrice ?? item.amount ?? 0,
        quantity: item.quantity ?? 1,
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
