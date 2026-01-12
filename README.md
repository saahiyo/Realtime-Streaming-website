# StreamFlow - Advanced Video Player

A modern, high-performance video streaming player with aggressive buffering, custom controls, and CORS proxy support.

## Features

- 🚀 **Aggressive Buffering** - Preloads up to 45 seconds ahead for smooth playback
- 🎨 **Modern UI** - Beautiful gradient design with glassmorphism effects
- ⚡ **Fast Seeking** - Jump to any point instantly with optimized chunk loading
- 🔄 **CORS Proxy** - Built-in proxy server to bypass CORS restrictions
- 📊 **Real-time Stats** - Live buffer and network speed monitoring
- ⌨️ **Keyboard Shortcuts** - Full keyboard control support
- 🎯 **Click to Play** - Click anywhere on the video to play/pause
- 🖼️ **Picture-in-Picture** - Multitask while watching
- 🎬 **Variable Speed** - Play at speeds from 0.25x to 100x
- 📱 **Responsive** - Works on all screen sizes

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

2. No dependencies to install - pure vanilla JavaScript!

### Running the Application

#### Option 1: Direct File Access
Simply open `index.html` in your browser for direct video URL streaming.

#### Option 2: With Proxy Server (Recommended for CORS-blocked videos)
```bash
node server.js
```

Then open `http://localhost:4001` in your browser.

The proxy server:
- Runs on port 4001 (configurable via `PORT` environment variable)
- Handles CORS restrictions
- Maintains keep-alive connections for better performance
- Supports up to 200 concurrent streams

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
- **`server.js`** - Optional CORS proxy server

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

### Server Configuration

Edit `server.js` to customize:

```javascript
const PORT = process.env.PORT || 4001;           // Server port
const MAX_CONCURRENT = 200;                      // Max concurrent streams
const REQUEST_TIMEOUT_MS = 30_000;               // Request timeout
const KEEPALIVE_MAX_SOCKETS = 500;              // Max keep-alive sockets
```

### Player Configuration

Edit `player.js` to customize buffering:

```javascript
this.TARGET_BUFFER = 45;  // Target buffer in seconds
this.LOW_BUFFER = 10;     // Low buffer warning threshold
```

## Error Handling

The application includes robust error handling for:
- ❌ Network connection resets
- ❌ CORS errors (use proxy)
- ❌ Invalid video URLs
- ❌ Timeout errors
- ❌ Server overload (503 with retry-after)

## Performance Optimizations

- **Keep-alive connections** - Reduces latency with connection reuse
- **TCP_NODELAY** - Disables Nagle's algorithm for faster streaming
- **High water marks** - 256KB buffers for optimal throughput
- **Smart preloading** - Metadata first, then aggressive buffering on play

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
