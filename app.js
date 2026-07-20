import http from 'node:http';
import handler from './api/flow.js';

const MAX_BODY_BYTES = 1024 * 1024;

function enhanceResponse(response) {
  response.status = (statusCode) => {
    response.statusCode = statusCode;
    return response;
  };

  response.json = (payload) => {
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.end(JSON.stringify(payload));
  };

  response.send = (payload = '') => {
    response.end(payload);
  };

  return response;
}

async function readRawBody(request) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error('Payload maior que 1 MB.');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

const server = http.createServer(async (request, rawResponse) => {
  const response = enhanceResponse(rawResponse);
  const pathname = new URL(request.url, 'http://localhost').pathname.replace(/\/+$/, '') || '/';

  if (pathname !== '/' && pathname !== '/api/flow') {
    return response.status(404).json({ error: 'Not found' });
  }

  try {
    // Mantém o corpo exatamente como chegou. O envelope JSON só é convertido
    // dentro da rotina de descriptografia do WhatsApp Flow.
    request.rawBody = request.method === 'POST' ? await readRawBody(request) : Buffer.alloc(0);
    request.body = request.rawBody;
    await handler(request, response);
  } catch (error) {
    console.error('HTTP ERROR:', error);
    if (!response.headersSent) {
      response.status(error.statusCode ?? 500).json({ error: error.message });
    } else if (!response.writableEnded) {
      response.end();
    }
  }
});

const port = Number(process.env.PORT) || 3000;
server.listen(port, () => {
  console.log(`Flow API listening on port ${port}`);
});

export default server;
