/**
 * StreamFlow Proxy — hardened & optimized for byte-range streaming
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');
const path = require('path');
const fs = require('fs');
const { PassThrough, pipeline } = require('stream');

const PORT = process.env.PORT || 4001;

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

const server = http.createServer((req, res) => {
    req.socket.setNoDelay(true);

    // CORS + streaming headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
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

    if (parsedUrl.pathname === '/proxy') {
        const target = parsedUrl.searchParams.get('url');
        if (!target) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'Missing url parameter' }));
        }

        if (activeRequests >= MAX_CONCURRENT) {
            res.writeHead(503, { 'Retry-After': '5' });
            return res.end('Server busy');
        }

        activeRequests++;
        proxyVideo(target, req, res)
            .catch(err => {
                if (!res.headersSent) res.writeHead(500);
                res.end();
            })
            .finally(() => activeRequests--);

        return;
    }

    // Static file serving
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
});
