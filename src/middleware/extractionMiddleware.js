const { fromBuffer } = require('file-type');
const { extractBillData } = require('../services/extraction');

const ALLOWED_MIME_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);

async function extractionMiddleware(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded. Send it as form-data field "bill".' });
    }

    // Never trust the client-supplied Content-Type - sniff the actual bytes.
    const sniffed = await fromBuffer(req.file.buffer);
    const realMimeType = sniffed?.mime;
    if (!realMimeType || !ALLOWED_MIME_TYPES.has(realMimeType)) {
      return res.status(415).json({
        error: `Unsupported or unrecognized file content (detected: ${realMimeType || 'unknown'}). Only PDF, JPEG, PNG are accepted.`,
      });
    }
    req.file.mimetype = realMimeType;

    const { extracted, sourceFileType, extractionMethod } = await extractBillData(req.file);
    req.extraction = { extracted, sourceFileType, extractionMethod };
    next();
  } catch (err) {
    console.error('[extraction] failed:', err);
    res.status(502).json({ error: `Extraction failed: ${err.message}` });
  }
}

module.exports = extractionMiddleware;
