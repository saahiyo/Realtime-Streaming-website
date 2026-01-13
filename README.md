# StreamFlow - Advanced Video Player

A modern, high-performance video streaming player with aggressive buffering, custom controls, and secure CORS proxy support.

## Features

### Core Capabilities
- 🚀 **Aggressive Buffering** - Preloads up to 45 seconds ahead for smooth playback
- 🎨 **Modern UI** - Beautiful gradient design with glassmorphism effects
- ⚡ **Fast Seeking** - Jump to any point instantly with optimized chunk loading
- 🔄 **Secure CORS Proxy** - HMAC-signed URLs for secure video streaming
- 📊 **Real-time Stats** - Live buffer and network speed monitoring
- ⌨️ **Keyboard Shortcuts** - Full keyboard control support
- 🎯 **Click to Play** - Click anywhere on the video to play/pause
- 🖼️ **Picture-in-Picture** - Multitask while watching
- 🎬 **Variable Speed** - Play at speeds from 0.25x to 100x
- 📱 **Responsive** - Works on all screen sizes

### Security & Reliability
- 🔐 **HMAC Authentication** - Time-limited signed URLs prevent unauthorized access
- ⚠️ **Robust Error Handling** - Clear error messages for network, timeout, and format issues
- ⏱️ **Smart Timeout Detection** - Automatic detection of stuck loading states
- 🛡️ **Rate Limiting** - Protection against server overload

## Getting Started

### Prerequisites

- Node.js (v14 or higher)
- Modern web browser (Chrome, Firefox, Safari, Edge)

### Installation

1. Clone the repository:
```bash
git clone https://github.com/saahiyo/Realtime-Streaming-website.git
cd Realtime-Streaming-website
```

2. **Install dependencies** (required for local proxy server):
   ```bash
   npm install
   ```
   This installs the `dotenv` package needed to load environment variables.

3. **Set up environment variables** (for proxy security):
   - Copy `.env.example` to `.env`:
     ```bash
     cp .env.example .env
     ```
   - Edit `.env` and set a strong secret key:
     ```env
     STREAM_SECRET=your-secure-secret-key-here
     ```
   - **⚠️ Important**: Use a strong, random secret in production!

4. **No other dependencies** - Frontend is pure vanilla JavaScript!

### Running the Application

#### Option 1: Direct File Access
Simply open `index.html` in your browser for direct video URL streaming (no proxy features).

#### Option 2: With Proxy Server (Recommended for CORS-blocked videos)
```bash
node server.js
```

Then open `http://localhost:4001` in your browser.

The proxy server includes:
- **HMAC-based security** - All proxy requests require signed URLs with timestamps
- **Automatic URL signing** - Server generates signed URLs via `/generate-signed-url` endpoint
- Runs on port 4001 (configurable via `PORT` environment variable)
- Handles CORS restrictions transparently
- Maintains keep-alive connections for better performance
- Supports up to 200 concurrent streams
- Time-limited URLs (5-minute expiration)
- Rate limiting and overload protection

**Security Note**: The player automatically requests signed URLs from the server when the "Use Proxy" option is enabled. You don't need to manually sign URLs.

#### Option 3: Deploy to Vercel (Production)

Deploy the proxy as a serverless edge function for global, scalable performance:

1. **Set up environment variables in Vercel**:
   - Go to your Vercel project settings
   - Add environment variable: `STREAM_SECRET=your-production-secret-key`
   - **⚠️ Critical**: Use a strong, unique secret in production!

2. **Install Vercel CLI** (if not already installed):
```bash
npm install -g vercel
```

3. **Deploy to Vercel**:
```bash
vercel
```

4. **Access your deployment**:
   - **Health check**: `https://your-domain.vercel.app/api/server` (returns status JSON)
   - **Sign URL endpoint**: `https://your-domain.vercel.app/api/server/generate-signed-url` (POST)
   - **Proxy endpoint**: `https://your-domain.vercel.app/api/server?url=...` (automatically used by player)

The Vercel edge function includes:
- **Same HMAC security** as local server
- Automatically scales based on demand
- Runs on Vercel's global edge network
- Supports up to 100 concurrent streams per region
- 25-second timeout limit (edge runtime requirement)
- Health check endpoint for monitoring

**Automatic Environment Detection**: The player automatically detects the environment:
- 🏠 **Local development**: Uses `http://localhost:4001/generate-signed-url` and `http://localhost:4001/proxy`
- 🚀 **Production (Vercel)**: Uses your Vercel domain's `generate-signed-url` endpoint
- No manual configuration needed!

## Usage

1. **Enter Video URL**: Paste a direct video URL (MP4, WebM, OGG, HLS, DASH)
2. **Enable Proxy** (if needed): Toggle "Use Local Proxy" for CORS-blocked videos
3. **Click Stream**: Start watching instantly

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play/Pause |
| `F` | Toggle Fullscreen |
| `M` | Mute/Unmute |
| `P` | Picture-in-Picture |
| `←` | Skip backward 10s |
| `→` | Skip forward 10s |
| `↑` | Volume up |
| `↓` | Volume down |
| `0-9` | Jump to 0%-90% |
| `Click` time display | Jump to specific timestamp |

## Architecture

### Files

- **`index.html`** - Main application interface
- **`player.js`** - Video player logic and buffering engine
- **`styles.css`** - Styling and animations
- **`server.js`** - Node.js CORS proxy server (local development)
- **`api/server.js`** - Vercel edge function (production deployment)
- **`package.json`** - Node.js dependencies (dotenv)
- **`.env.example`** - Environment variable template
- **`.gitignore`** - Git ignore rules

### Key Technologies

- **Vanilla JavaScript** - No framework dependencies
- **HTML5 Video API** - Native video capabilities
- **Node.js HTTP/HTTPS** - Proxy server implementation
- **CSS3 Animations** - Smooth transitions and effects

### Buffering Strategy

StreamFlow uses an aggressive buffering approach:
- Target buffer: 45 seconds ahead
- Low buffer threshold: 10 seconds
- Continuous buffer pressure to maximize preloading
- Smart seek optimization for instant jumps

## Configuration

### Environment Variables

Create a `.env` file in the project root:

```env
# Required for proxy security (both local and Vercel)
STREAM_SECRET=your-secure-random-key-here

# Optional: Custom port for local server (default: 4001)
PORT=4001
```

**Security Requirements**:
- Use a strong, random secret key (minimum 32 characters recommended)
- Never commit `.env` to version control (already in `.gitignore`)
- Use different secrets for development and production
- Set `STREAM_SECRET` in Vercel environment variables for production

### Server Configuration

Edit `server.js` to customize local server behavior:

```javascript
const PORT = process.env.PORT || 4001;           // Server port
const MAX_CONCURRENT = 200;                      // Max concurrent streams
const REQUEST_TIMEOUT_MS = 30_000;               // Request timeout (30s)
const KEEPALIVE_MAX_SOCKETS = 500;              // Max keep-alive sockets
const MAX_SKEW_SECONDS = 300;                   // URL expiration time (5 min)
const MAX_REDIRECTS = 5;                        // Max redirect follows
```

### Vercel Edge Function Configuration

Edit `api/server.js` to customize edge function behavior:

```javascript
const MAX_CONCURRENT = 100;                      // Max concurrent streams per region
const REQUEST_TIMEOUT_MS = 25000;                // Request timeout (25s, edge limit)
const MAX_SKEW_SECONDS = 300;                   // URL expiration time (5 min)
const MAX_REDIRECTS = 5;                        // Max redirect follows
```

### Player Configuration

Edit `player.js` to customize buffering and timeouts:

```javascript
this.TARGET_BUFFER = 45;           // Target buffer in seconds
this.LOW_BUFFER = 10;              // Low buffer warning threshold
this.LOADING_TIMEOUT_MS = 15000;   // Loading timeout (15 seconds)
```

## Error Handling

The application includes comprehensive error handling for a smooth user experience:

### Client-Side (Player) Errors
- ⏱️ **Loading Timeout** - Detects and reports videos that fail to load within 15 seconds
- 🔴 **Media Errors** - Clear messages for:
  - Network failures (`MEDIA_ERR_NETWORK`)
  - Format/codec issues (`MEDIA_ERR_DECODE`)
  - Unsupported sources (`MEDIA_ERR_SRC_NOT_SUPPORTED`)
  - Aborted loads (`MEDIA_ERR_ABORTED`)
- 📊 **State Detection** - Monitors video loading states to prevent stuck "Buffering..." UI
- 🎯 **User Feedback** - Error overlay with specific, actionable messages

### Server-Side (Proxy) Errors
- 🔐 **Security Errors**:
  - `401 Unauthorized` - Missing or invalid signature
  - `403 Link Expired` - URL timestamp older than 5 minutes
  - `403 Invalid Signature` - HMAC verification failed
- 🚫 **Request Errors**:
  - `400 Invalid URL` - Malformed or non-HTTP(S) URLs
  - `503 Server Busy` - Too many concurrent requests (with `Retry-After` header)
  - `502 Proxy Error` - Upstream server issues
  - `502 Content Not Streamable` - HTML pages blocked (anti-bot protection)
- ⏱️ **Timeout Protection** - 30s local / 25s edge function timeout
- 🔄 **Auto-Retry** - Graceful handling of network resets and interruptions

## Performance Optimizations

### Network Layer
- **Keep-alive connections** - Reduces latency with connection reuse (local server)
- **TCP_NODELAY** - Disables Nagle's algorithm for faster streaming
- **High water marks** - 256KB buffers for optimal throughput
- **Connection pooling** - Up to 500 concurrent keep-alive sockets

### Buffering Strategy
- **Smart preloading** - Metadata first, then aggressive buffering on play
- **Target buffer: 45 seconds** - Ensures smooth playback even on unstable networks
- **Continuous buffer pressure** - 500ms interval checks to maintain buffer

### Security Optimizations
- **Time-limited URLs** - 5-minute expiration minimizes unauthorized access window
- **HMAC-SHA256** - Fast cryptographic signing with minimal overhead
- **Nonce-based replay protection** - Prevents URL reuse attacks

## Browser Compatibility

- ✅ Chrome 90+
- ✅ Firefox 88+
- ✅ Safari 14+
- ✅ Edge 90+

## Supported Formats

- MP4 (H.264/H.265)
- WebM (VP8/VP9)
- OGG (Theora)
- HLS (m3u8)
- DASH (mpd)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is open source and available under the MIT License.

## Acknowledgments

Built with ❤️ for smooth video streaming experiences.

---

**Note**: This player is designed for personal use and educational purposes. Always respect copyright and content licensing when streaming videos.
