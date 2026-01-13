/**
 * StreamFlow Proxy — Secure Vercel Edge Function
 * Signed, time-limited, byte-range streaming proxy
 * Now with server-side URL signing endpoint
 */

export const config = {
  runtime: 'edge',
};

// ================= CONFIG =================
const MAX_CONCURRENT = 100;
const REQUEST_TIMEOUT_MS = 25000;
const MAX_SKEW_SECONDS = 300; // 5 minutes
const MAX_REDIRECTS = 5;

// 🔐 MUST be set in Vercel ENV
const STREAM_SECRET = process.env.STREAM_SECRET;

// Track active requests (best-effort)
let activeRequests = 0;

// ================= UTILITIES =================
async function hmacSHA256(message, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
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
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

// ================= HANDLER =================
export default async function handler(req) {
  const url = new URL(req.url);

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Range, Content-Type',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
    'Accept-Ranges': 'bytes',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  // ================= GENERATE SIGNED URL ENDPOINT =================
  const action = url.searchParams.get('action');
  if (action === 'sign' && req.method === 'POST') {
    if (!STREAM_SECRET) {
      return new Response(
        JSON.stringify({ error: 'Server configuration error' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    try {
      const body = await req.json();
      const targetUrl = body.url;

      if (!targetUrl || !isValidHttpUrl(targetUrl)) {
        return new Response(
          JSON.stringify({ error: 'Invalid URL' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const timestamp = Math.floor(Date.now() / 1000);
      const nonce = generateNonce();
      const signature = await hmacSHA256(
        `${targetUrl}|${timestamp}|${nonce}`,
        STREAM_SECRET
      );

      // Return the signed URL path (relative to avoid CORS issues)
      const signedUrl = `/api/server?url=${encodeURIComponent(targetUrl)}&t=${timestamp}&nonce=${nonce}&sig=${encodeURIComponent(signature)}`;

      return new Response(
        JSON.stringify({ signedUrl }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } catch (err) {
      return new Response(
        JSON.stringify({ error: 'Invalid request' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
  }

  // ================= PROXY ENDPOINT =================
  const targetUrl = url.searchParams.get('url');
  const t = url.searchParams.get('t');
  const nonce = url.searchParams.get('nonce');
  const sig = url.searchParams.get('sig');

  // Health check
  if (!targetUrl) {
    return new Response(
      JSON.stringify({
        status: 'healthy',
        activeRequests,
        maxConcurrent: MAX_CONCURRENT,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Overload protection
  if (activeRequests >= MAX_CONCURRENT) {
    return new Response('Server busy', {
      status: 503,
      headers: { ...corsHeaders, 'Retry-After': '5' },
    });
  }

  // ================= SECURITY CHECKS =================
  if (!STREAM_SECRET || !t || !nonce || !sig) {
    return new Response('Unauthorized', { status: 403, headers: corsHeaders });
  }

  if (!isValidHttpUrl(targetUrl)) {
    return new Response('Invalid URL', { status: 400, headers: corsHeaders });
  }

  const now = Math.floor(Date.now() / 1000);
  const ts = parseInt(t, 10);

  if (Math.abs(now - ts) > MAX_SKEW_SECONDS) {
    return new Response('Link expired', { status: 403, headers: corsHeaders });
  }

  const expectedSig = await hmacSHA256(
    `${targetUrl}|${t}|${nonce}`,
    STREAM_SECRET
  );

  if (sig !== expectedSig) {
    return new Response('Invalid signature', { status: 403, headers: corsHeaders });
  }

  // ================= STREAM =================
  activeRequests++;

  try {
    return await proxyVideo(targetUrl, req, corsHeaders);
  } catch (err) {
    return new Response('Proxy error', { status: 502, headers: corsHeaders });
  } finally {
    activeRequests--;
  }
}

// ================= STREAM FUNCTION =================
async function proxyVideo(videoUrl, clientReq, corsHeaders) {
  let currentUrl = videoUrl;
  let redirects = 0;

  while (redirects < MAX_REDIRECTS) {
    const upstreamHeaders = {
      'User-Agent':
        clientReq.headers.get('user-agent') ||
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      Accept: '*/*',
    };

    const range = clientReq.headers.get('range');
    if (range) upstreamHeaders.Range = range;

    const target = new URL(currentUrl);
    upstreamHeaders.Referer = `${target.protocol}//${target.host}/`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const res = await fetch(currentUrl, {
        method: clientReq.method === 'HEAD' ? 'HEAD' : 'GET',
        headers: upstreamHeaders,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        if (loc) {
          currentUrl = new URL(loc, currentUrl).toString();
          redirects++;
          continue;
        }
      }

      // Block HTML (anti-login / anti-bot pages)
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('text/html')) {
        return new Response('Content not streamable', {
          status: 502,
          headers: corsHeaders,
        });
      }

      const headers = { ...corsHeaders };
      [
        'content-type',
        'content-length',
        'content-range',
        'accept-ranges',
      ].forEach(h => {
        const v = res.headers.get(h);
        if (v) headers[h] = v;
      });

      return new Response(
        clientReq.method === 'HEAD' ? null : res.body,
        { status: res.status, headers }
      );
    } catch (err) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') throw new Error('Timeout');
      throw err;
    }
  }

  throw new Error('Too many redirects');
}
