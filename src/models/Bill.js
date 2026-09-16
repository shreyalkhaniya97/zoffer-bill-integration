const mongoose = require('mongoose');

const LineItemSchema = new mongoose.Schema(
  {
    description: String,
    hsnCode: String,
    quantity: Number,
    unitPrice: Number,
    taxRate: Number,
    amount: Number,
  },
  { _id: false }
);

const BillSchema = new mongoose.Schema(
  {
    orgId: { type: String, required: true, index: true },
    sourceFileName: String,
    sourceFileType: { type: String, enum: ['image', 'pdf-text', 'pdf-scanned'] },
    extractionMethod: { type: String, enum: ['ollama-vision', 'ollama-text', 'parse-conversiontools'] },

    rawExtractedJson: mongoose.Schema.Types.Mixed,
    lineItems: [LineItemSchema],
    vendorName: String,
    invoiceNumber: String,
    invoiceDate: String,
    totalAmount: Number,

    ragFlags: [String],

    mappedZohoPayload: mongoose.Schema.Types.Mixed,
    zohoBillId: String,
    zohoVendorId: String,

    status: {
      type: String,
      enum: ['received', 'extracted', 'mapped', 'synced', 'failed'],
      default: 'received',
    },
    errorMessage: String,
  },
  { timestamps: true }
);

module.exports = mongoose.model('Bill', BillSchema);
