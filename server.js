/**
 * StreamFlow Proxy — tuned for aggressive next-chunk buffering
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');
const path = require('path');
const fs = require('fs');
const stream = require('stream');
const { pipeline, PassThrough } = stream;
const { promisify } = require('util');
const pipe = promisify(pipeline);

const PORT = process.env.PORT || 4001;

// Performance tuning
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

const server = http.createServer(async (req, res) => {
    // 🔴 Disable Nagle (critical for streaming)
    req.socket.setNoDelay(true);

    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');

    // 🔴 Always expose these
    res.setHeader(
        'Access-Control-Expose-Headers',
        'Content-Length, Content-Range, Accept-Ranges'
    );

    // 🔴 FORCE byte-range support
    res.setHeader('Accept-Ranges', 'bytes');

    // 🔴 Explicit keep-alive
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Keep-Alive', 'timeout=60');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);

    if (parsedUrl.pathname === '/proxy') {
        const videoUrl = parsedUrl.searchParams.get('url');
        if (!videoUrl) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing url parameter' }));
            return;
        }

        if (activeRequests >= MAX_CONCURRENT) {
            res.writeHead(503, { 'Retry-After': '5' });
            res.end('Server busy');
            return;
        }

        activeRequests++;
        try {
            await proxyVideo(videoUrl, req, res);
        } finally {
            activeRequests--;
        }
        return;
    }

    // Static files
    let filePath = parsedUrl.pathname === '/' ? '/index.html' : parsedUrl.pathname;
    filePath = path.join(__dirname, filePath);

    if (!filePath.startsWith(__dirname)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(err.code === 'ENOENT' ? 404 : 500);
            res.end();
            return;
        }
        res.writeHead(200);
        res.end(data);
    });
});

async function proxyVideo(videoUrl, clientReq, clientRes) {
    const src = new URL(videoUrl);
    const isHttps = src.protocol === 'https:';
    const agent = isHttps ? httpsAgent : httpAgent;

    const headers = {
        'User-Agent': clientReq.headers['user-agent'] || 'StreamFlow/1.0',
        'Accept': '*/*',
        'Connection': 'keep-alive',
        'Referer': `${src.protocol}//${src.hostname}/`
    };

    if (clientReq.headers.range) {
        headers.Range = clientReq.headers.range;
    }

    const options = {
        protocol: src.protocol,
        hostname: src.hostname,
        port: src.port || (isHttps ? 443 : 80),
        path: src.pathname + src.search,
        method: clientReq.method === 'HEAD' ? 'HEAD' : 'GET',
        headers,
        agent,
        timeout: REQUEST_TIMEOUT_MS
    };

    const protocol = isHttps ? https : http;

    return new Promise((resolve, reject) => {
        let upstreamReq;
        let isResolved = false;

        const cleanup = () => {
            if (upstreamReq && !upstreamReq.destroyed) {
                upstreamReq.destroy();
            }
        };

        const safeResolve = () => {
            if (!isResolved) {
                isResolved = true;
                cleanup();
                resolve();
            }
        };

        const safeReject = (err) => {
            if (!isResolved) {
                isResolved = true;
                cleanup();
                // Don't reject on client-side aborts
                if (err.code === 'ECONNRESET' || err.code === 'ERR_STREAM_PREMATURE_CLOSE') {
                    console.log('Client aborted request');
                    resolve();
                } else {
                    reject(err);
                }
            }
        };

        // Handle client disconnect
        clientReq.on('close', () => {
            safeResolve();
        });

        clientRes.on('close', () => {
            safeResolve();
        });

        upstreamReq = protocol.request(options, upstreamRes => {
            // Redirects
            if (
                upstreamRes.statusCode >= 300 &&
                upstreamRes.statusCode < 400 &&
                upstreamRes.headers.location
            ) {
                upstreamReq.destroy();
                proxyVideo(
                    new URL(upstreamRes.headers.location, src).toString(),
                    clientReq,
                    clientRes
                ).then(resolve).catch(reject);
                return;
            }

            const headersOut = {
                'Content-Type': upstreamRes.headers['content-type'] || 'video/mp4',
                'Content-Length': upstreamRes.headers['content-length'],
                'Content-Range': upstreamRes.headers['content-range'],
                'Accept-Ranges': 'bytes',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive'
            };

            clientRes.writeHead(upstreamRes.statusCode || 200, headersOut);

            if (options.method === 'HEAD') {
                clientRes.end();
                resolve();
                return;
            }

            // 🔴 Bigger buffer = faster chunk flow
            const pass = new PassThrough({
                highWaterMark: 256 * 1024 // 256 KB
            });

            pipeline(upstreamRes, pass, clientRes, err => {
                if (err) {
                    safeReject(err);
                } else {
                    safeResolve();
                }
            });
        });

        upstreamReq.on('error', safeReject);
        upstreamReq.on('timeout', () => {
            safeReject(new Error('Request timeout'));
        });
        upstreamReq.end();
    });
}

// Global error handlers
process.on('unhandledRejection', (err) => {
    console.error('Unhandled rejection:', err.message);
    // Don't crash on network errors
    if (err.code !== 'ECONNRESET' && err.code !== 'ERR_STREAM_PREMATURE_CLOSE') {
        console.error(err.stack);
    }
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err.message);
    if (err.code !== 'ECONNRESET' && err.code !== 'ERR_STREAM_PREMATURE_CLOSE') {
        console.error(err.stack);
        process.exit(1);
    }
});

server.listen(PORT, () => {
    console.log(`🚀 StreamFlow Proxy running on http://localhost:${PORT}`);
});
