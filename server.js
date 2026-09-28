import express from 'express';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import handler from './api/relay.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// Serve the static index
app.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'index.html'));
});

// Mount the relay as a real Express route
app.get('/api/relay', async (req, res) => {
  // Adapt the Vercel-style handler to Express
  await handler(req, res);
});

app.options('/api/relay', async (req, res) => {
  await handler(req, res);
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
