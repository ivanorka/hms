import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const publicDir = path.join(__dirname, 'public');
const port = Number(process.env.PORT || 5174);
const host = process.env.HOST || 'localhost';

const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp']
]);

function sendFile(res, filePath) {
  const ext = path.extname(filePath);
  res.writeHead(200, { 'Content-Type': mimeTypes.get(ext) || 'application/octet-stream' });
  createReadStream(filePath).pipe(res);
}

createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${port}`);

  if (url.pathname === '/data/hms-seed.json') {
    sendFile(res, path.join(root, 'data', 'hms-seed.json'));
    return;
  }

  const requested = path.normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  const staticPath = path.join(publicDir, requested === '/' ? 'index.html' : requested);

  if (existsSync(staticPath) && !staticPath.endsWith(path.sep)) {
    sendFile(res, staticPath);
    return;
  }

  try {
    const html = await readFile(path.join(publicDir, 'index.html'), 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`Frontend error: ${error.message}`);
  }
}).listen(port, host, () => {
  console.log(`HMS frontend: http://localhost:${port}`);
});
