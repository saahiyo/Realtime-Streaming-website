/**
 * StreamFlow Proxy — hardened & optimized for byte-range streaming
 * Now with HMAC-based security for signed URLs
 */

// Load environment variables from .env file
require('dotenv').config();

const http = require('http');
const https = require('https');
const { URL } = require('url');
const path = require('path');
const fs = require('fs');
const { PassThrough, pipeline } = require('stream');
const crypto = require('crypto');

const PORT = process.env.PORT || 4001;

// Security config
const STREAM_SECRET = process.env.STREAM_SECRET || 'dev-secret-key-change-in-production';
const MAX_SKEW_SECONDS = 300; // 5 minutes
const MAX_REDIRECTS = 5;

// Performance limits
const MAX_CONCURRENT = 200;
const REQUEST_TIMEOUT_MS = 30_000;
const KEEPALIVE_MAX_SOCKETS = 500;

// Keep-alive agents
const httpAgent = new http.Agent({
    keepAlive: true,
    maxSockets: KEEPALIVE_MAX_SOCKETS
});
const httpsAgent = new https.Agent({
    keepAlive: true,
    maxSockets: KEEPALIVE_MAX_SOCKETS
});

let activeRequests = 0;

// ================= UTILITIES =================

function hmacSHA256(message, secret) {
    return crypto
        .createHmac('sha256', secret)
        .update(message)
        .digest('base64');
}

function isValidHttpUrl(value) {
    try {
        const u = new URL(value);
        return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
        return false;
    }
}

function generateNonce() {
    return crypto.randomBytes(16).toString('hex');
}

// ================= SERVER =================

const server = http.createServer((req, res) => {
    req.socket.setNoDelay(true);

    // CORS + streaming headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');
    res.setHeader(
        'Access-Control-Expose-Headers',
        'Content-Length, Content-Range, Accept-Ranges'
    );
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Connection', 'keep-alive');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        return res.end();
    }

    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);

    // ================= GENERATE SIGNED URL ENDPOINT =================
    if (parsedUrl.pathname === '/generate-signed-url' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { url } = JSON.parse(body);
                
                if (!url || !isValidHttpUrl(url)) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: 'Invalid URL' }));
                }

                const timestamp = Math.floor(Date.now() / 1000);
                const nonce = generateNonce();
                const signature = hmacSHA256(`${url}|${timestamp}|${nonce}`, STREAM_SECRET);

                const signedUrl = `/proxy?url=${encodeURIComponent(url)}&t=${timestamp}&nonce=${nonce}&sig=${encodeURIComponent(signature)}`;

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ signedUrl }));
            } catch (err) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid request' }));
            }
        });
        return;
    }

    // ================= PROXY ENDPOINT =================
    if (parsedUrl.pathname === '/proxy') {
        const targetUrl = parsedUrl.searchParams.get('url');
        const t = parsedUrl.searchParams.get('t');
        const nonce = parsedUrl.searchParams.get('nonce');
        const sig = parsedUrl.searchParams.get('sig');

        // Health check
        if (!targetUrl) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({
                status: 'healthy',
                activeRequests,
                maxConcurrent: MAX_CONCURRENT
            }));
        }

        // Security validation
        if (!t || !nonce || !sig) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'Unauthorized' }));
        }

        if (!isValidHttpUrl(targetUrl)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'Invalid URL' }));
        }

        // Timestamp validation
        const now = Math.floor(Date.now() / 1000);
        const timestamp = parseInt(t, 10);

        if (Math.abs(now - timestamp) > MAX_SKEW_SECONDS) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'Link expired' }));
        }

        // Signature validation
        const expectedSig = hmacSHA256(`${targetUrl}|${t}|${nonce}`, STREAM_SECRET);

        if (sig !== expectedSig) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'Invalid signature' }));
        }

        // Overload protection
        if (activeRequests >= MAX_CONCURRENT) {
            res.writeHead(503, { 'Retry-After': '5' });
            return res.end('Server busy');
        }

        activeRequests++;
        proxyVideo(targetUrl, req, res)
            .catch(err => {
                if (!res.headersSent) res.writeHead(500);
                res.end();
            })
            .finally(() => activeRequests--);

        return;
    }

    // ================= STATIC FILE SERVING =================
    let filePath = parsedUrl.pathname === '/' ? '/index.html' : parsedUrl.pathname;
    filePath = path.join(__dirname, filePath);

    if (!filePath.startsWith(__dirname)) {
        res.writeHead(403);
        return res.end('Forbidden');
    }

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(err.code === 'ENOENT' ? 404 : 500);
            return res.end();
        }
        res.writeHead(200);
        res.end(data);
    });
});

// ================= PROXY FUNCTION =================

function proxyVideo(videoUrl, clientReq, clientRes) {
    return new Promise((resolve, reject) => {
        const src = new URL(videoUrl);
        const isHttps = src.protocol === 'https:';
        const protocol = isHttps ? https : http;
        const agent = isHttps ? httpsAgent : httpAgent;

        const headers = {
            'User-Agent': clientReq.headers['user-agent'] || 'StreamFlow/1.0',
            'Accept': '*/*',
            'Referer': `${src.protocol}//${src.host}/`,
            'Connection': 'keep-alive'
        };

        if (clientReq.headers.range) {
            headers.Range = clientReq.headers.range;
        }

        const upstreamReq = protocol.request(
            {
                protocol: src.protocol,
                hostname: src.hostname,
                port: src.port || (isHttps ? 443 : 80),
                path: src.pathname + src.search,
                method: clientReq.method === 'HEAD' ? 'HEAD' : 'GET',
                headers,
                agent,
                timeout: REQUEST_TIMEOUT_MS
            },
            upstreamRes => {
                // Handle redirects
                if (
                    upstreamRes.statusCode >= 300 &&
                    upstreamRes.statusCode < 400 &&
                    upstreamRes.headers.location
                ) {
                    upstreamReq.destroy();
                    return proxyVideo(
                        new URL(upstreamRes.headers.location, src).toString(),
                        clientReq,
                        clientRes
                    ).then(resolve).catch(reject);
                }

                const outHeaders = {};
                for (const h of [
                    'content-type',
                    'content-length',
                    'content-range',
                    'accept-ranges'
                ]) {
                    if (upstreamRes.headers[h]) {
                        outHeaders[h] = upstreamRes.headers[h];
                    }
                }

                clientRes.writeHead(
                    upstreamRes.statusCode || 200,
                    outHeaders
                );

                if (clientReq.method === 'HEAD') {
                    clientRes.end();
                    return resolve();
                }

                const pass = new PassThrough({
                    highWaterMark: 256 * 1024 // 256KB aggressive buffering
                });

                pipeline(upstreamRes, pass, clientRes, err => {
                    if (err) return reject(err);
                    resolve();
                });
            }
        );

        upstreamReq.on('timeout', () => {
            upstreamReq.destroy();
            reject(new Error('Upstream timeout'));
        });

        upstreamReq.on('error', err => {
            if (
                err.code === 'ECONNRESET' ||
                err.code === 'ERR_STREAM_PREMATURE_CLOSE'
            ) {
                return resolve();
            }
            reject(err);
        });

        const abort = () => upstreamReq.destroy();
        clientReq.once('close', abort);
        clientRes.once('close', abort);

        upstreamReq.end();
    });
}

// Global safety
process.on('unhandledRejection', err => {
    if (!['ECONNRESET', 'ERR_STREAM_PREMATURE_CLOSE'].includes(err.code)) {
        console.error(err);
    }
});

process.on('uncaughtException', err => {
    console.error(err);
    if (!['ECONNRESET', 'ERR_STREAM_PREMATURE_CLOSE'].includes(err.code)) {
        process.exit(1);
    }
});

server.listen(PORT, () => {
    console.log(`StreamFlow Proxy running at http://localhost:${PORT}`);
    console.log(`Using STREAM_SECRET: ${STREAM_SECRET === 'dev-secret-key-change-in-production' ? '⚠️  DEFAULT (change in production!)' : '✓ Custom'}`);
});
