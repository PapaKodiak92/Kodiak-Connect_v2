import { spawn } from 'node:child_process';
import { createServer, request as httpRequest } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const service = process.argv[2] === 'auth' ? 'auth' : 'backend';
const publicPort = Number(process.env.PORT || (service === 'auth' ? process.env.KODIAK_AUTH_PUBLIC_PORT : process.env.KODIAK_BACKEND_PUBLIC_PORT) || (service === 'auth' ? 8788 : 8787));
const internalPort = Number(service === 'auth' ? process.env.KODIAK_AUTH_INTERNAL_PORT || 18788 : process.env.KODIAK_BACKEND_INTERNAL_PORT || 18787);
const targetFile = service === 'auth' ? 'authServer.mjs' : 'server.mjs';
const serviceLabel = service === 'auth' ? 'Kodiak Auth' : 'Kodiak Backend';
const corsAllowHeaders = 'Content-Type, X-Kodiak-User-Id, Authorization';

function getCorsOrigin(origin) {
  if (!origin) {
    return '*';
  }

  return origin;
}

function writeCorsHeaders(response, origin) {
  response.setHeader('Access-Control-Allow-Origin', getCorsOrigin(origin));
  response.setHeader('Access-Control-Allow-Headers', corsAllowHeaders);
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  response.setHeader('Access-Control-Max-Age', '86400');
  response.setHeader('Vary', 'Origin');
}

function startInternalServer() {
  const env = {
    ...process.env,
    PORT: '',
  };

  if (service === 'auth') {
    env.KODIAK_AUTH_PORT = String(internalPort);
  } else {
    env.KODIAK_BACKEND_PORT = String(internalPort);
  }

  const child = spawn(process.execPath, [join(__dirname, targetFile)], {
    env,
    stdio: ['ignore', 'inherit', 'inherit'],
  });

  child.on('exit', (code, signal) => {
    console.error(`[${serviceLabel}] internal server exited`, { code, signal });
    process.exit(code ?? 1);
  });

  process.on('SIGINT', () => child.kill('SIGINT'));
  process.on('SIGTERM', () => child.kill('SIGTERM'));
}

function proxyRequest(clientRequest, clientResponse) {
  writeCorsHeaders(clientResponse, clientRequest.headers.origin);

  if (clientRequest.method === 'OPTIONS') {
    clientResponse.writeHead(204);
    clientResponse.end();
    return;
  }

  const targetRequest = httpRequest(
    {
      headers: clientRequest.headers,
      hostname: '127.0.0.1',
      method: clientRequest.method,
      path: clientRequest.url,
      port: internalPort,
    },
    (targetResponse) => {
      clientResponse.writeHead(targetResponse.statusCode ?? 502, {
        ...targetResponse.headers,
        'Access-Control-Allow-Origin': getCorsOrigin(clientRequest.headers.origin),
        'Access-Control-Allow-Headers': corsAllowHeaders,
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        Vary: 'Origin',
      });
      targetResponse.pipe(clientResponse);
    },
  );

  targetRequest.on('error', (error) => {
    console.error(`[${serviceLabel}] public proxy failed`, error);
    if (!clientResponse.headersSent) {
      clientResponse.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    }
    clientResponse.end(JSON.stringify({ error: `${serviceLabel} is starting or unavailable.` }));
  });

  clientRequest.pipe(targetRequest);
}

startInternalServer();

createServer(proxyRequest).listen(publicPort, '0.0.0.0', () => {
  console.log(`[${serviceLabel}] public proxy listening on 0.0.0.0:${publicPort} -> 127.0.0.1:${internalPort}`);
});
