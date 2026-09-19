// Local calibration UI with the real, read-only owner-access check.
// Never proxy uploads, analytics, billing, generation or other API calls.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync } from 'node:fs';

// Mirror the deployed static pages: Vite otherwise serves the scanner shell
// for a clean help/policy URL, hiding route and navigation mistakes locally.
const pageRoutes = new Map(JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')).rewrites
  .filter(({ source, destination }) => /^\/[a-z0-9/-]+$/.test(source) && /^\/[a-z0-9-]+\.html$/.test(destination))
  .map(({ source, destination }) => [source, destination]));

export function calibrationPreviewPage(pathname) {
  return pageRoutes.get(pathname.replace(/\/$/, '')) ?? null;
}

const UPSTREAM = 'https://www.truemax.app/api/quick-access';

export async function calibrationPreviewApi(request, { origin, fetcher = fetch }) {
  if (request.headers.get('origin') && request.headers.get('origin') !== origin) {
    return Response.json({ error: 'Cross-origin calls are not allowed.' }, { status: 403 });
  }
  const url = new URL(request.url);
  if (url.pathname !== '/api/quick-access' || url.search || request.method !== 'GET') {
    return Response.json({ error: 'This local calibration preview disables other API calls.' }, { status: 503 });
  }
  const token = request.headers.get('authorization') ?? '';
  if (!/^Bearer\s+\S+$/i.test(token) || token.length > 8192) {
    return Response.json({ allowed: false }, { status: 401 });
  }
  try {
    const response = await fetcher(UPSTREAM, {
      method: 'GET',
      headers: { authorization: token, accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Expected JSON');
    return Response.json(await response.json(), {
      status: response.status,
      headers: { 'cache-control': 'no-store' },
    });
  } catch {
    return Response.json({ allowed: false, error: 'Owner access could not be checked. Try again.' }, { status: 503 });
  }
}

async function start() {
  const { createServer } = await import('vite');
  const root = fileURLToPath(new URL('../', import.meta.url));
  const port = 4189;
  const origin = `http://127.0.0.1:${port}`;
  const server = await createServer({
    root,
    server: { host: '127.0.0.1', port, strictPort: true, cors: false },
    plugins: [{
      name: 'local-calibration-access',
      configureServer(vite) {
        vite.middlewares.use(async (req, res, next) => {
          if (req.headers.host !== `127.0.0.1:${port}`) {
            res.writeHead(403); res.end('Use the loopback preview address.'); return;
          }
          const url = new URL(req.url ?? '/', origin);
          if (url.pathname.startsWith('/api/')) {
            const response = await calibrationPreviewApi(new Request(url, {
              method: req.method,
              headers: {
                ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}),
                ...(req.headers.origin ? { origin: req.headers.origin } : {}),
              },
            }), { origin });
            res.writeHead(response.status, Object.fromEntries(response.headers));
            res.end(await response.text());
            return;
          }
          const page = calibrationPreviewPage(url.pathname);
          if (page) req.url = page + url.search;
          next();
        });
      },
    }],
  });
  await server.listen();
  console.log(`Calibration preview: ${origin}/league/tools#calibrate`);
  console.log('Sign in normally. The real owner grant is checked; other API calls are disabled. Photos remain local unless exported.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  start().catch(() => { console.error('Calibration preview could not start. Check port 4189 is available.'); process.exitCode = 1; });
}
