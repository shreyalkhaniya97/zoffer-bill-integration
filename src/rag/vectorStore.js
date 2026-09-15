const ollama = require('../services/ollama');
const knowledge = require('./gstKnowledge');

let index = null; // [{ ...entry, embedding }]
let buildPromise = null;

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function buildIndex() {
  index = await Promise.all(
    knowledge.map(async (entry) => ({
      ...entry,
      embedding: await ollama.embed(`${entry.hsnCode} ${entry.description}`),
    }))
  );
  console.log(`[rag] GST knowledge index built: ${index.length} entries`);
}

// Call once at server startup so the first real request isn't slowed down
// building embeddings.
function ensureIndex() {
  if (!buildPromise) buildPromise = buildIndex();
  return buildPromise;
}

async function findClosestRates(queryText, topK = 1) {
  await ensureIndex();
  const queryEmbedding = await ollama.embed(queryText);
  const scored = index.map((entry) => ({
    ...entry,
    score: cosineSimilarity(queryEmbedding, entry.embedding),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

module.exports = { ensureIndex, findClosestRates };
