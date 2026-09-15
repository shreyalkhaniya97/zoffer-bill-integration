const { findClosestRates } = require('../rag/vectorStore');

const SIMILARITY_MIN = 0.55; // below this, the match is too weak to trust - skip it

/**
 * Sits between extraction and Zoho mapping. Cross-checks each extracted line
 * item's declared GST rate against a small local knowledge base (see
 * src/rag/gstKnowledge.js) and attaches human-readable warnings. Never
 * blocks or edits the extracted data - flags only, a person reviews.
 */
async function ragMiddleware(req, res, next) {
  try {
    const lineItems = req.extraction?.extracted?.lineItems || [];
    const flags = [];

    for (const item of lineItems) {
      if (item.taxRate == null || !item.description) continue;

      const [match] = await findClosestRates(item.description, 1);
      if (!match || match.score < SIMILARITY_MIN) continue;

      if (Number(item.taxRate) !== Number(match.gstRate)) {
        flags.push(
          `"${item.description}" was extracted at ${item.taxRate}% GST, but looks similar to ` +
            `HSN ${match.hsnCode} (${match.description}), usually taxed at ${match.gstRate}%. Please verify.`
        );
      }
    }

    req.extraction.extracted.ragFlags = flags;
    next();
  } catch (err) {
    // RAG is an advisory layer - a failure here shouldn't block posting the bill.
    console.error('[rag] middleware failed, continuing without flags:', err.message);
    req.extraction.extracted.ragFlags = [];
    next();
  }
}

module.exports = ragMiddleware;
