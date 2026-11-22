import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { apiApp } from './backend/routes/api.ts';

dotenv.config();

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

async function startServer() {
  const PORT = Number(process.env.PORT || 3000);
  const isProd = process.env.NODE_ENV === 'production';

  const vite = !isProd
    ? await (await import('vite')).createServer({
        server: { middlewareMode: true },
        appType: 'spa',
      })
    : null;

  const distDir = path.resolve(process.cwd(), 'dist');

  const server = http.createServer(async (req, res) => {
    const urlPath = req.url || '/';

    if (urlPath.startsWith('/api/')) {
      try {
        const origin = `http://${req.headers.host || `localhost:${PORT}`}`;
        const fullUrl = new URL(urlPath, origin);
        const headers = new Headers();
        for (const [k, v] of Object.entries(req.headers)) {
          if (typeof v === 'string') headers.set(k, v);
          else if (Array.isArray(v)) headers.set(k, v.join(', '));
        }

        const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
        const chunks: Buffer[] = [];
        if (hasBody) {
          for await (const chunk of req) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          }
        }
        const bodyBuf = chunks.length > 0 ? Buffer.concat(chunks) : undefined;

        const webReq = new Request(fullUrl.toString(), {
          method: req.method,
          headers,
          body: bodyBuf,
        });

        const webRes = await apiApp.fetch(webReq);
        res.statusCode = webRes.status;
        webRes.headers.forEach((value, key) => {
          res.setHeader(key, value);
        });

        if (webRes.body) {
          const reader = webRes.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) res.write(Buffer.from(value));
          }
          res.end();
        } else {
          res.end();
        }
      } catch (err) {
        console.error('[ShortsPilot] API request error:', err);
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
      return;
    }

    if (vite) {
      vite.middlewares(req, res, () => {
        res.statusCode = 404;
        res.end('Not found');
      });
      return;
    }

    const reqPath = urlPath.split('?')[0];
    const normalizedRel = reqPath === '/' ? 'index.html' : reqPath.replace(/^\/+/, '');
    const candidate = path.resolve(distDir, normalizedRel);
    const isInsideDist = candidate.startsWith(distDir + path.sep) || candidate === distDir;
    const targetFile =
      isInsideDist && fs.existsSync(candidate) && fs.statSync(candidate).isFile()
        ? candidate
        : path.join(distDir, 'index.html');

    const ext = path.extname(targetFile).toLowerCase();
    res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream');
    fs.createReadStream(targetFile).pipe(res);
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[ShortsPilot] Render Node.js Hono server listening on port ${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('[ShortsPilot] Fatal startup error:', err);
  process.exit(1);
});
