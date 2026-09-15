require('dotenv').config();
const express = require('express');
const { connectDB } = require('./src/config/db');
const { ensureIndex } = require('./src/rag/vectorStore');
const billsRouter = require('./src/routes/bills');

const app = express();
app.use(express.json());

app.get('/health', (req, res) => res.json({ ok: true }));
app.use('/', billsRouter);

const PORT = process.env.PORT || 3000;

async function start() {
  await connectDB();
  ensureIndex().catch((err) => console.error('[rag] index build failed:', err.message));
  app.listen(PORT, () => console.log(`[server] listening on http://localhost:${PORT}`));
}

start().catch((err) => {
  console.error('[server] failed to start:', err);
  process.exit(1);
});
