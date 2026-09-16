const express = require('express');
const multer = require('multer');
const Bill = require('../models/Bill');
const zoho = require('../services/zoho');
const extractionMiddleware = require('../middleware/extractionMiddleware');
const ragMiddleware = require('../middleware/ragMiddleware');
const zohoMappingMiddleware = require('../middleware/zohoMappingMiddleware');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB - invoices/scans shouldn't exceed this
});
const router = express.Router();

// Dev-only: run extraction + RAG check without touching Zoho, so the
// AI pipeline can be validated in Postman before Zoho creds are wired up.
router.post('/bills/extract-only', upload.single('bill'), extractionMiddleware, ragMiddleware, (req, res) => {
  res.json(req.extraction);
});

// Postman -> upload -> extract (Ollama) -> RAG GST check -> map -> Zoho Books
router.post(
  '/bills',
  upload.single('bill'),
  extractionMiddleware,
  ragMiddleware,
  zohoMappingMiddleware,
  async (req, res) => {
    const { extracted, sourceFileType, extractionMethod } = req.extraction;
    const orgId = process.env.DEFAULT_ORG_ID || 'demo-org-1';

    const billDoc = new Bill({
      orgId,
      sourceFileName: req.file.originalname,
      sourceFileType,
      extractionMethod,
      rawExtractedJson: extracted,
      lineItems: extracted.lineItems,
      vendorName: extracted.vendorName,
      invoiceNumber: extracted.invoiceNumber,
      invoiceDate: extracted.invoiceDate,
      totalAmount: extracted.totalAmount,
      ragFlags: extracted.ragFlags,
      mappedZohoPayload: req.zohoPayload,
      zohoVendorId: req.zohoVendorId,
      status: 'mapped',
    });

    let zohoBill;
    let taxDropped = false;
    let taxDropReason;
    try {
      const result = await zoho.createBillWithFallback(req.zohoPayload);
      zohoBill = result.bill;
      taxDropped = result.taxDropped;
      taxDropReason = result.taxDropReason;
      billDoc.zohoBillId = zohoBill.bill_id;
      billDoc.status = 'synced';
      if (taxDropped) billDoc.errorMessage = `Posted without tax - ${taxDropReason}`;
    } catch (err) {
      billDoc.status = 'failed';
      billDoc.errorMessage = err.response?.data?.message || err.message;
      console.error('[zoho] createBill failed:', billDoc.errorMessage);
    }

    // A Mongo save failure (e.g. a schema validation error) must never crash
    // the process or swallow the Zoho outcome above - log it and still
    // respond with whatever we know, rather than leaving the request hanging
    // into an unhandled rejection.
    try {
      await billDoc.save();
    } catch (saveErr) {
      console.error('[mongo] failed to save Bill document:', saveErr.message);
    }

    if (zohoBill) {
      return res.status(201).json({
        message: taxDropped
          ? 'Bill extracted and logged to Zoho Books (posted without tax - see note).'
          : 'Bill extracted and logged to Zoho Books.',
        billId: billDoc._id,
        zohoBillId: zohoBill.bill_id,
        extraction: extracted,
        ragFlags: extracted.ragFlags,
        ...(taxDropped ? { note: `Tax could not be applied and was dropped: ${taxDropReason}` } : {}),
      });
    }
    return res.status(502).json({
      error: `Zoho Books sync failed: ${billDoc.errorMessage}`,
      billId: billDoc._id,
      extraction: extracted,
    });
  }
);

module.exports = router;
