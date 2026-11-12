#!/usr/bin/env node
// Static preview server for the extension folder.
//
// It does two things a plain file server cannot:
//   1. serves `extension/` so `preview/index.html` can iframe `../panel/index.html`;
//   2. answers every `/panel/*.html` with the exact Content-Security-Policy
//      OpenChamber puts on a guest document (`guestFramePolicy(null)`), so the
//      panel runs under production network lockdown in the preview too.
//
//   node preview/server.mjs          # http://127.0.0.1:4173/preview/

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PORT = Number(process.env.PORT ?? 4173);

// Mirrors packages/sdk/src/frame-policy.ts `guestFramePolicy(null)`.
const GUEST_POLICY = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' 'self' data: blob:",
  "style-src 'unsafe-inline' 'self' data: blob:",
  "img-src 'self' data: blob:",
  "font-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "worker-src 'self' data: blob:",
  "frame-src 'self' data: blob:",
  "connect-src 'none'",
  "object-src 'none'",
  "form-action 'none'",
].join("; ");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".map": "application/json; charset=utf-8",
};

const server = createServer((request, response) => {
  void (async () => {
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${PORT}`);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === "/") {
      response.writeHead(302, { location: "/preview/" });
      response.end();
      return;
    }
    if (pathname.endsWith("/")) pathname += "index.html";
    const target = normalize(join(ROOT, pathname));
    if (!target.startsWith(ROOT.endsWith(sep) ? ROOT : ROOT + sep)) {
      response.writeHead(403).end("forbidden");
      return;
    }
    try {
      const body = await readFile(target);
      const type = MIME[extname(target)] ?? "application/octet-stream";
      const headers = { "Content-Type": type, "X-Content-Type-Options": "nosniff" };
      // The guest document runs under the production guest policy.
      if (target.startsWith(join(ROOT, "panel")) && target.endsWith(".html")) {
        headers["Content-Security-Policy"] = GUEST_POLICY;
      }
      response.writeHead(200, headers).end(body);
    } catch {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end(`not found: ${pathname}`);
    }
  })();
});

server.listen(PORT, "127.0.0.1", () => {
  process.stdout.write(`preview: http://127.0.0.1:${PORT}/preview/\n`);
});
