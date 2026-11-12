// Server rendering example (J2): a plain Node HTTP server with Vite as middleware.
//   npm start -w @gantt/ssr-example      then open http://127.0.0.1:5185
// Each request renders <App /> with react-dom/server and returns full HTML; the browser then hydrates it.
// Next.js works the same way: render <Gantt ssr … /> from a client component ('use client'), and import
// '@gantt/react' as usual. The `ssr` prop is what makes the first render synchronous on both sides.
import { createServer as createHttp } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer as createVite } from 'vite';
import react from '@vitejs/plugin-react';

const root = fileURLToPath(new URL('.', import.meta.url));
const css = readFileSync(new URL('../../packages/react/src/gantt.css', import.meta.url), 'utf8');

/** Starts the server on `port` and returns a function that stops it (used by the e2e test). */
export async function start(port = 5185) {
  const vite = await createVite({ root, plugins: [react()], server: { middlewareMode: true }, appType: 'custom', logLevel: 'warn' });
  const http = createHttp((req, res) => {
    vite.middlewares(req, res, async () => {
      try {
        const template = await vite.transformIndexHtml(req.url ?? '/', readFileSync(root + 'index.html', 'utf8'));
        const { render } = await vite.ssrLoadModule('/src/entry-server.tsx');
        // The stylesheet is inlined in <head>, so the server HTML is laid out before any script runs (no jump).
        const html = template.replace('<!--styles-->', `<style>${css}</style>`).replace('<!--app-->', render());
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(html);
      } catch (e) {
        vite.ssrFixStacktrace(e);
        res.writeHead(500).end(String(e?.stack ?? e));
      }
    });
  });
  await new Promise((r) => http.listen(port, '127.0.0.1', r));
  return async () => { await new Promise((r) => http.close(r)); await vite.close(); };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await start(Number(process.env.PORT ?? 5185));
  console.log('Server rendering example on http://127.0.0.1:5185');
}
