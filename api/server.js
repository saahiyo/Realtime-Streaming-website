/**
 * StreamFlow Proxy — Vercel Edge Function version
 * Optimized for byte-range streaming on Vercel Edge Runtime
 */

export const config = {
    runtime: 'edge',
};

// Performance limits
const MAX_CONCURRENT = 100; // Lower for edge functions
const REQUEST_TIMEOUT_MS = 25000; // 25s max for edge functions

// Track active requests (using global state in edge runtime)
let activeRequests = 0;

export default async function handler(req) {
    const url = new URL(req.url);

    // CORS headers
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Range, Content-Type',
        'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
        'Accept-Ranges': 'bytes',
    };

    // Handle OPTIONS preflight
    if (req.method === 'OPTIONS') {
        return new Response(null, {
            status: 200,
            headers: corsHeaders,
        });
    }

    // Health check endpoint
    if (url.pathname === '/api/health' || url.pathname === '/api/server/health') {
        return new Response(
            JSON.stringify({
                status: 'healthy',
                service: 'StreamFlow Proxy Edge',
                timestamp: new Date().toISOString(),
                activeRequests,
                maxConcurrent: MAX_CONCURRENT,
            }),
            {
                status: 200,
                headers: {
                    ...corsHeaders,
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-cache, no-store, must-revalidate',
                },
            }
        );
    }

    // Extract target URL from query parameter
    const targetUrl = url.searchParams.get('url');
    
    if (!targetUrl) {
        return new Response(
            JSON.stringify({ error: 'Missing url parameter' }),
            {
                status: 400,
                headers: {
                    ...corsHeaders,
                    'Content-Type': 'application/json',
                },
            }
        );
    }

    // Rate limiting
    if (activeRequests >= MAX_CONCURRENT) {
        return new Response('Server busy', {
            status: 503,
            headers: {
                ...corsHeaders,
                'Retry-After': '5',
            },
        });
    }

    activeRequests++;

    try {
        // Proxy the video stream
        const response = await proxyVideo(targetUrl, req, corsHeaders);
        return response;
    } catch (error) {
        console.error('Proxy error:', error);
        return new Response('Proxy error', {
            status: 500,
            headers: corsHeaders,
        });
    } finally {
        activeRequests--;
    }
}

async function proxyVideo(videoUrl, clientReq, corsHeaders) {
    let redirectCount = 0;
    const MAX_REDIRECTS = 5;
    let currentUrl = videoUrl;

    while (redirectCount < MAX_REDIRECTS) {
        // Prepare headers for upstream request
        const upstreamHeaders = {
            'User-Agent': clientReq.headers.get('user-agent') || 'StreamFlow/2.0',
            'Accept': '*/*',
        };

        // Parse URL to add Referer
        const targetUrlObj = new URL(currentUrl);
        upstreamHeaders['Referer'] = `${targetUrlObj.protocol}//${targetUrlObj.host}/`;

        // Forward Range header if present
        const rangeHeader = clientReq.headers.get('range');
        if (rangeHeader) {
            upstreamHeaders['Range'] = rangeHeader;
        }

        // Create AbortController for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

        try {
            // Fetch from upstream
            const upstreamRes = await fetch(currentUrl, {
                method: clientReq.method === 'HEAD' ? 'HEAD' : 'GET',
                headers: upstreamHeaders,
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            // Handle redirects
            if (upstreamRes.status >= 300 && upstreamRes.status < 400) {
                const location = upstreamRes.headers.get('location');
                if (location) {
                    currentUrl = new URL(location, currentUrl).toString();
                    redirectCount++;
                    continue;
                }
            }

            // Build response headers
            const responseHeaders = { ...corsHeaders };
            
            // Forward important headers
            const headersToForward = [
                'content-type',
                'content-length',
                'content-range',
                'accept-ranges',
            ];

            for (const header of headersToForward) {
                const value = upstreamRes.headers.get(header);
                if (value) {
                    responseHeaders[header] = value;
                }
            }

            // Return response
            if (clientReq.method === 'HEAD') {
                return new Response(null, {
                    status: upstreamRes.status,
                    headers: responseHeaders,
                });
            }

            return new Response(upstreamRes.body, {
                status: upstreamRes.status,
                headers: responseHeaders,
            });

        } catch (error) {
            clearTimeout(timeoutId);
            
            // Handle timeout
            if (error.name === 'AbortError') {
                throw new Error('Upstream request timeout');
            }
            
            throw error;
        }
    }

    // Too many redirects
    throw new Error('Too many redirects');
}
