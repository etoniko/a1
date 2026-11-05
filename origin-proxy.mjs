import https from "https";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PFX = path.join(ROOT, "dev-certs", "local.pfx");
const PASSPHRASE = "localdev";
const SPOOF_ORIGIN = "https://xn--80aaiv4ak.xn--p1ai";
const SPOOF_REFERER = "https://xn--80aaiv4ak.xn--p1ai/";

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".txt": "text/plain; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".xml": "application/xml",
};

function allowedHost(hostname) {
    return hostname === "agar.su" || hostname.endsWith(".agar.su");
}

function parseProxy(url) {
    const q = url.indexOf("?");
    const pathname = q === -1 ? url : url.slice(0, q);
    const search = q === -1 ? "" : url.slice(q);
    const m = pathname.match(/^\/p\/([^/]+)(\/.*)?$/);
    if (!m) return null;
    const hostport = decodeURIComponent(m[1]);
    let hostname = hostport;
    let port = 443;
    const colon = hostport.lastIndexOf(":");
    if (colon > 0 && /^\d+$/.test(hostport.slice(colon + 1))) {
        hostname = hostport.slice(0, colon);
        port = Number(hostport.slice(colon + 1));
    }
    if (!allowedHost(hostname)) return null;
    return { hostname, port, path: (m[2] || "/") + search };
}

function upstreamHeaders(req, hostname, port) {
    const out = {};
    for (const [k, v] of Object.entries(req.headers)) {
        const key = k.toLowerCase();
        if (key === "host" || key === "origin" || key === "referer") continue;
        out[k] = v;
    }
    out.host = port === 443 ? hostname : hostname + ":" + port;
    out.origin = SPOOF_ORIGIN;
    out.referer = SPOOF_REFERER;
    return out;
}

function corsHeaders(req) {
    return {
        "access-control-allow-origin": req.headers.origin || "https://localhost",
        "access-control-allow-credentials": "true",
        "access-control-allow-headers": req.headers["access-control-request-headers"] || "*",
        "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    };
}

function proxyHttp(req, res) {
    if (req.method === "OPTIONS") {
        res.writeHead(204, corsHeaders(req));
        res.end();
        return;
    }
    const target = parseProxy(req.url || "/");
    if (!target) {
        res.writeHead(404, corsHeaders(req));
        res.end("bad proxy target");
        return;
    }
    const headers = upstreamHeaders(req, target.hostname, target.port);
    console.log("[proxy]", req.method, target.hostname + ":" + target.port, target.path, "origin", headers.origin);
    const up = https.request({
        host: target.hostname,
        servername: target.hostname,
        port: target.port,
        method: req.method,
        path: target.path,
        headers,
        rejectUnauthorized: true,
    }, (upRes) => {
        res.writeHead(upRes.statusCode || 502, { ...upRes.headers, ...corsHeaders(req) });
        upRes.pipe(res);
    });
    up.on("error", (err) => {
        console.error("[proxy]", target.hostname, err.message);
        if (!res.headersSent) res.writeHead(502);
        res.end("upstream error");
    });
    req.pipe(up);
}

function proxyUpgrade(req, socket, head) {
    const target = parseProxy(req.url || "/");
    if (!target) {
        socket.destroy();
        return;
    }
    const headers = upstreamHeaders(req, target.hostname, target.port);
    const up = https.request({
        host: target.hostname,
        servername: target.hostname,
        port: target.port,
        method: "GET",
        path: target.path,
        headers,
        rejectUnauthorized: true,
    });
    up.on("upgrade", (upRes, upSocket, upHead) => {
        const lines = ["HTTP/1.1 " + (upRes.statusCode || 101) + " " + (upRes.statusMessage || "Switching Protocols")];
        for (const [k, v] of Object.entries(upRes.headers)) {
            const vals = Array.isArray(v) ? v : [v];
            for (const val of vals) {
                if (val != null) lines.push(k + ": " + val);
            }
        }
        socket.write(lines.join("\r\n") + "\r\n\r\n");
        if (upHead && upHead.length) socket.write(upHead);
        if (head && head.length) upSocket.write(head);
        upSocket.pipe(socket);
        socket.pipe(upSocket);
        const close = () => {
            upSocket.destroy();
            socket.destroy();
        };
        upSocket.on("error", close);
        socket.on("error", close);
        upSocket.on("close", () => socket.end());
        socket.on("close", () => upSocket.end());
    });
    up.on("error", (err) => {
        console.error("[proxy ws]", target.hostname, err.message);
        socket.destroy();
    });
    up.on("response", (upRes) => {
        socket.write("HTTP/1.1 " + upRes.statusCode + " " + upRes.statusMessage + "\r\n\r\n");
        upRes.pipe(socket);
    });
    up.end();
}

function serveStatic(req, res) {
    let rel = decodeURIComponent((req.url || "/").split("?")[0]);
    if (rel === "/") rel = "/index.html";
    const file = path.normalize(path.join(ROOT, rel));
    if (!file.startsWith(ROOT)) {
        res.writeHead(403);
        res.end();
        return;
    }
    fs.readFile(file, (err, data) => {
        if (err) {
            res.writeHead(404);
            res.end("not found");
            return;
        }
        const ext = path.extname(file).toLowerCase();
        res.writeHead(200, {
            "Content-Type": MIME[ext] || "application/octet-stream",
            "Cache-Control": "no-store",
        });
        res.end(data);
    });
}

const server = https.createServer({
    pfx: fs.readFileSync(PFX),
    passphrase: PASSPHRASE,
}, (req, res) => {
    if ((req.url || "").startsWith("/p/")) proxyHttp(req, res);
    else serveStatic(req, res);
});

server.on("upgrade", (req, socket, head) => {
    if ((req.url || "").startsWith("/p/")) proxyUpgrade(req, socket, head);
    else socket.destroy();
});

server.listen(8443, "127.0.0.1", () => {
    console.log("origin proxy https://127.0.0.1:8443  spoof", SPOOF_ORIGIN);
});
