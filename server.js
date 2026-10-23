import express from 'express';
import flowHandler from './api/flow.js';

const app = express();

app.use(express.json({ limit: '1mb' }));

app.all('/api/flow', flowHandler);

const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log(`Servidor a correr na porta ${PORT}`);
});
