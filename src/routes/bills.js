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

    try {
      const zohoBill = await zoho.createBill(req.zohoPayload);
      billDoc.zohoBillId = zohoBill.bill_id;
      billDoc.status = 'synced';
      await billDoc.save();

      return res.status(201).json({
        message: 'Bill extracted and logged to Zoho Books.',
        billId: billDoc._id,
        zohoBillId: zohoBill.bill_id,
        extraction: extracted,
        ragFlags: extracted.ragFlags,
      });
    } catch (err) {
      billDoc.status = 'failed';
      billDoc.errorMessage = err.response?.data?.message || err.message;
      await billDoc.save();
      console.error('[zoho] createBill failed:', billDoc.errorMessage);
      return res.status(502).json({
        error: `Zoho Books sync failed: ${billDoc.errorMessage}`,
        billId: billDoc._id,
        extraction: extracted,
      });
    }
  }
);

module.exports = router;
