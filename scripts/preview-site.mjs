// Builds the landing page and serves site/dist on http://localhost:4173.
//
//     node scripts/preview-site.mjs
//
// For looking at the page locally; GitHub Pages serves the same folder.

import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

await import('./build-site.mjs');

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'site', 'dist');
const port = Number(process.env.PORT ?? 4173);

const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.xml': 'application/xml; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.ico': 'image/x-icon',
};

async function resolve(url) {
    const path = decodeURIComponent(new URL(url, 'http://localhost').pathname);
    const safe = normalize(path).replace(/^(\.\.[/\\])+/, '');
    for (const candidate of [join(dist, safe), join(dist, safe, 'index.html')]) {
        try {
            const info = await stat(candidate);
            if (info.isFile()) {
                return candidate;
            }
        } catch {
            // Try the next shape.
        }
    }
    return null;
}

createServer(async (request, response) => {
    const file = await resolve(request.url ?? '/');
    if (!file) {
        response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('Not found');
        return;
    }
    response.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
    response.end(await readFile(file));
}).listen(port, () => {
    console.log(`\nCatCup site on http://localhost:${port}\n`);
});
