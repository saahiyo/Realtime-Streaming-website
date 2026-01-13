/**
 * StreamFlow Video Player — FINAL FIXED VERSION
 * Aggressive buffering, fast seeking, stable playback
 */

class StreamFlowPlayer {
    constructor() {
        // Core
        this.video = document.getElementById('videoPlayer');
        this.urlInput = document.getElementById('videoUrl');
        this.loadBtn = document.getElementById('loadBtn');
        this.useProxyCheckbox = document.getElementById('useProxy');
        this.backBtn = document.getElementById('backBtn');

        // Sections
        this.urlSection = document.getElementById('urlSection');
        this.playerSection = document.getElementById('playerSection');
        this.playerContainer = document.getElementById('playerContainer');

        // Overlays
        this.loadingOverlay = document.getElementById('loadingOverlay');
        this.playOverlay = document.getElementById('playOverlay');
        this.errorOverlay = document.getElementById('errorOverlay');
        this.errorText = document.getElementById('errorText');
        this.retryBtn = document.getElementById('retryBtn');
        this.bufferIndicator = document.getElementById('bufferIndicator');
        this.osd = document.getElementById('osd');

        // Controls
        this.playPauseBtn = document.getElementById('playPauseBtn');
        this.bigPlayBtn = document.getElementById('bigPlayBtn');
        this.skipBackBtn = document.getElementById('skipBackBtn');
        this.skipForwardBtn = document.getElementById('skipForwardBtn');
        this.fullscreenBtn = document.getElementById('fullscreenBtn');
        this.muteBtn = document.getElementById('muteBtn');
        this.volumeSlider = document.getElementById('volumeSlider');
        this.pipBtn = document.getElementById('pipBtn');

        // Progress
        this.progressContainer = document.getElementById('progressContainer');
        this.progressPlayed = document.getElementById('progressPlayed');
        this.progressBuffer = document.getElementById('progressBuffer');
        this.progressThumb = document.getElementById('progressThumb');
        this.progressTooltip = document.getElementById('progressTooltip');

        // Stats
        this.currentTimeEl = document.getElementById('currentTime');
        this.durationEl = document.getElementById('duration');
        this.bufferPercent = document.getElementById('bufferPercent');
        this.networkSpeed = document.getElementById('networkSpeed');

        // State
        this.currentUrl = '';
        this.isPlaying = false;
        this.lastBufferedEnd = 0;
        this.lastCheck = performance.now();
        this._nudged = false;

        // Buffer targets (IMPORTANT)
        this.TARGET_BUFFER = 45; // seconds
        this.LOW_BUFFER = 10;

        // OSD timeout
        this.osdTimeout = null;

        // Loading timeout
        this.loadingTimeout = null;
        this.LOADING_TIMEOUT_MS = 15000; // 15 seconds

        // Double-tap detection
        this.lastTapTime = 0;
        this.tapTimeout = null;
        this.DOUBLE_TAP_DELAY = 300; // ms

        this.init();
    }

    init() {
        this.bindEvents();
        this.setupVideoEvents();
        this.urlInput.focus();
    }

    /* =======================
       Terabox Handler
       ======================= */

    isTeraboxUrl(url) {
        // Check if the URL is a Terabox share link
        return url.includes('teraboxshare.com/s/') || url.includes('1024terabox.com/s/');
    }

    async getTeraboxDownloadLink(teraboxUrl) {
        try {
            // Call tera-core API to get the download link
            const apiUrl = `https://tera-core.vercel.app/api?url=${encodeURIComponent(teraboxUrl)}`;
            
            const response = await fetch(apiUrl);
            
            if (!response.ok) {
                throw new Error(`Tera-core API error: ${response.status}`);
            }
            
            const data = await response.json();
            
            // Extract the download_link from the first file in the files array
            if (data.files && data.files.length > 0 && data.files[0].download_link) {
                return data.files[0].download_link;
            } else {
                throw new Error('No download link found in Terabox response');
            }
        } catch (err) {
            throw new Error(`Failed to get Terabox download link: ${err.message}`);
        }
    }

    /* =======================
       Load Video
       ======================= */

    async loadVideo() {
        let url = this.urlInput.value.trim();
        if (!url) return;

        // Show loading immediately
        this.showPlayerSection();
        this.resetUI();

        // Clear any existing timeout
        if (this.loadingTimeout) {
            clearTimeout(this.loadingTimeout);
            this.loadingTimeout = null;
        }

        try {
            // Check if this is a Terabox link
            if (this.isTeraboxUrl(url)) {
                // Get the actual download link from tera-core API
                url = await this.getTeraboxDownloadLink(url);
            }

            if (this.useProxyCheckbox?.checked) {
                // Get signed URL from server
                const signedUrl = await this.getSignedUrl(url);
                url = signedUrl;
            }

            this.currentUrl = url;
            this.lastBufferedEnd = 0;
            this.lastCheck = performance.now();
            this._nudged = false;

            this.video.pause();
            this.video.removeAttribute('src');
            this.video.preload = 'metadata';
            this.video.src = url;
            this.video.load();

            // Set timeout to detect stuck loading
            this.loadingTimeout = setTimeout(() => {
                if (this.video.readyState === 0 || (this.video.networkState === 2 && this.video.readyState < 2)) {
                    this.showError('Loading timeout - video failed to load');
                }
            }, this.LOADING_TIMEOUT_MS);
        } catch (err) {
            this.showError(`Failed to load video: ${err.message}`);
        }
    }

    retryLoad() {
        // Hide error overlay and retry loading
        this.errorOverlay.classList.remove('active');
        this.loadVideo();
    }

    async getSignedUrl(videoUrl) {
        // Determine the signing endpoint based on environment
        const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        const signingEndpoint = isLocalhost 
            ? 'http://localhost:4001/generate-signed-url'
            : '/api/server?action=sign';

        const response = await fetch(signingEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ url: videoUrl })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
            throw new Error(errorData.error || 'Failed to generate signed URL');
        }

        const data = await response.json();
        
        // Construct full URL
        const baseUrl = isLocalhost 
            ? 'http://localhost:4001'
            : window.location.origin;
        
        return `${baseUrl}${data.signedUrl}`;
    }

    /* =======================
       Events
       ======================= */

    bindEvents() {
        this.loadBtn.addEventListener('click', () => this.loadVideo());
        this.backBtn.addEventListener('click', () => this.showUrlSection());
        this.retryBtn.addEventListener('click', () => this.retryLoad());

        this.playPauseBtn.addEventListener('click', () => this.togglePlay());
        this.bigPlayBtn.addEventListener('click', () => this.togglePlay());
        
        // Double-tap/click for play/pause on video and overlays
        this.video.addEventListener('click', (e) => this.handleVideoTap(e));
        this.playOverlay.addEventListener('click', (e) => this.handleVideoTap(e));
        this.playerContainer.addEventListener('click', (e) => {
            // Only handle clicks on the container itself, not on controls or other children
            if (e.target === this.playerContainer) {
                this.handleVideoTap(e);
            }
        });

        this.skipBackBtn.addEventListener('click', () => this.seekBy(-10));
        this.skipForwardBtn.addEventListener('click', () => this.seekBy(10));

        this.volumeSlider.addEventListener('input', e => {
            this.video.volume = e.target.value;
            this.video.muted = this.video.volume === 0;
        });

        this.muteBtn.addEventListener('click', () => {
            this.video.muted = !this.video.muted;
        });

        this.fullscreenBtn.addEventListener('click', () => this.toggleFullscreen());
        this.pipBtn.addEventListener('click', () => this.togglePiP());

        this.progressContainer.addEventListener('click', e => this.seek(e));
        
        // Progress bar tooltip
        this.progressContainer.addEventListener('mousemove', e => this.updateProgressTooltip(e));
        this.progressContainer.addEventListener('mouseleave', () => {
            this.progressTooltip.style.opacity = '0';
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => this.handleKeyboard(e));
    }

    handleKeyboard(e) {
        // Don't handle keyboard shortcuts if user is typing in an input
        if (e.target.tagName === 'INPUT') return;

        switch(e.key.toLowerCase()) {
            case ' ':
            case 'k':
                e.preventDefault();
                this.togglePlay();
                // No OSD for play/pause - visual feedback from playOverlay is enough
                break;
            
            case 'f':
                e.preventDefault();
                this.toggleFullscreen();
                // No OSD - fullscreen change is immediately obvious
                break;
            
            case 'm':
                e.preventDefault();
                this.video.muted = !this.video.muted;
                this.showOSD(this.video.muted ? 'volume-x' : 'volume-2', this.video.muted ? 'Muted' : 'Unmuted');
                break;
            
            case 'p':
                e.preventDefault();
                this.togglePiP();
                // No OSD - PiP mode is immediately visible

                break;
            
            case 'arrowleft':
                e.preventDefault();
                this.seekBy(-10);
                this.showOSD('rewind', '-10s');
                break;
            
            case 'arrowright':
                e.preventDefault();
                this.seekBy(10);
                this.showOSD('fast-forward', '+10s');
                break;
            
            case 'arrowup':
                e.preventDefault();
                this.video.volume = Math.min(1, this.video.volume + 0.1);
                this.volumeSlider.value = this.video.volume;
                this.showOSD('volume-2', `${Math.round(this.video.volume * 100)}%`);
                break;
            
            case 'arrowdown':
                e.preventDefault();
                this.video.volume = Math.max(0, this.video.volume - 0.1);
                this.volumeSlider.value = this.video.volume;
                this.showOSD('volume-1', `${Math.round(this.video.volume * 100)}%`);
                break;
            
            case '0':
            case '1':
            case '2':
            case '3':
            case '4':
            case '5':
            case '6':
            case '7':
            case '8':
            case '9':
                e.preventDefault();
                const percent = parseInt(e.key) / 10;
                this.video.currentTime = this.video.duration * percent;
                this.updateProgress(); // Immediate visual feedback
                // Show time instead of percentage for better context
                this.showOSD('clock', this.formatTime(this.video.currentTime));
                break;
        }
    }

    setupVideoEvents() {
        this.video.addEventListener('loadstart', () => {
            // Clear timeout when loading starts
            if (this.loadingTimeout) {
                clearTimeout(this.loadingTimeout);
            }
            this.showLoading();
        });

        this.video.addEventListener('loadedmetadata', () => {
            if (this.loadingTimeout) {
                clearTimeout(this.loadingTimeout);
                this.loadingTimeout = null;
            }
            this.durationEl.textContent = this.formatTime(this.video.duration);
            this.hideLoading();
            this.playOverlay.classList.remove('hidden');
            this.updatePlayPauseIcon();
        });

        this.video.addEventListener('loadeddata', () => {
            if (this.loadingTimeout) {
                clearTimeout(this.loadingTimeout);
                this.loadingTimeout = null;
            }
        });

        this.video.addEventListener('canplay', () => {
            if (this.loadingTimeout) {
                clearTimeout(this.loadingTimeout);
                this.loadingTimeout = null;
            }
        });

        this.video.addEventListener('play', () => {
            this.isPlaying = true;
            this.video.preload = 'auto';
            this.playOverlay.classList.add('hidden');
            this.updatePlayPauseIcon();

            // One-time seek nudge to force future ranges
            if (!this._nudged) {
                const t = this.video.currentTime;
                this.video.currentTime = Math.min(t + 0.01, this.video.duration);
                this.video.currentTime = t;
                this._nudged = true;
            }
        });

        this.video.addEventListener('pause', () => {
            this.isPlaying = false;
            this.video.preload = 'auto';
            this.playOverlay.classList.remove('hidden');
            this.updatePlayPauseIcon();
        });

        this.video.addEventListener('timeupdate', () => {
            this.updateProgress();
        });

        this.video.addEventListener('progress', () => {
            this.updateBufferStats();
        });

        this.video.addEventListener('waiting', () => {
            this.showLoading();
        });

        this.video.addEventListener('playing', () => {
            this.hideLoading();
        });

        this.video.addEventListener('stalled', () => {
            console.warn('Video stalled');
            // Don't show error immediately, waiting event will show loading
        });

        this.video.addEventListener('suspend', () => {
            console.warn('Video suspended');
            // Browser suspended loading, but might resume
        });

        this.video.addEventListener('abort', () => {
            console.warn('Video abort');
            if (this.loadingTimeout) {
                clearTimeout(this.loadingTimeout);
                this.loadingTimeout = null;
            }
        });

        this.video.addEventListener('error', () => {
            if (this.loadingTimeout) {
                clearTimeout(this.loadingTimeout);
                this.loadingTimeout = null;
            }

            let errorMessage = 'Unable to load video';
            
            if (this.video.error) {
                switch (this.video.error.code) {
                    case 1: // MEDIA_ERR_ABORTED
                        errorMessage = 'Video loading aborted';
                        break;
                    case 2: // MEDIA_ERR_NETWORK
                        errorMessage = 'Network error - failed to load video';
                        break;
                    case 3: // MEDIA_ERR_DECODE
                        errorMessage = 'Video decoding error';
                        break;
                    case 4: // MEDIA_ERR_SRC_NOT_SUPPORTED
                        errorMessage = 'Video format not supported or source unavailable';
                        break;
                    default:
                        errorMessage = `Video error (code ${this.video.error.code})`;
                }
                
                if (this.video.error.message) {
                    console.error('Video error details:', this.video.error.message);
                }
            }
            
            this.showError(errorMessage);
        });

        // Continuous buffer pressure (CRITICAL)
        setInterval(() => {
            if (!this.video.duration || this.video.paused) return;
            if (this.video.buffered.length) {
                this.video.buffered.end(this.video.buffered.length - 1);
            }
        }, 500);
    }

    /* =======================
       Buffer & Speed (CORRECT)
       ======================= */

    updateBufferStats() {
        if (!this.video.buffered.length || !this.video.duration) return;

        const now = performance.now();
        const bufferedEnd = this.video.buffered.end(this.video.buffered.length - 1);
        const bufferAhead = bufferedEnd - this.video.currentTime;

        // Buffer display
        this.bufferPercent.textContent = `${Math.round(bufferAhead)}s`;
        this.progressBuffer.style.width =
            `${(bufferedEnd / this.video.duration) * 100}%`;

        // Buffer growth rate (x realtime)
        const dt = (now - this.lastCheck) / 1000;
        if (dt > 0.5) {
            const delta = bufferedEnd - this.lastBufferedEnd;
            if (delta > 0) {
                const rate = delta / dt;
                this.networkSpeed.textContent = `${rate.toFixed(1)}× realtime`;
            }
            this.lastBufferedEnd = bufferedEnd;
            this.lastCheck = now;
        }

        // Stall indicator
        if (bufferAhead < this.LOW_BUFFER && !this.video.paused) {
            this.bufferIndicator.classList.add('active');
        } else {
            this.bufferIndicator.classList.remove('active');
        }
    }

    /* =======================
       Playback Helpers
       ======================= */

    handleVideoTap(e) {
        // Ignore clicks on buttons and control elements
        if (e.target.tagName === 'BUTTON' || e.target.closest('button')) {
            return;
        }

        const now = Date.now();
        const timeSinceLastTap = now - this.lastTapTime;

        // Clear any existing timeout
        if (this.tapTimeout) {
            clearTimeout(this.tapTimeout);
            this.tapTimeout = null;
        }

        // Check if this is a double-tap (within DOUBLE_TAP_DELAY ms)
        if (timeSinceLastTap < this.DOUBLE_TAP_DELAY && timeSinceLastTap > 0) {
            // Double-tap detected - toggle play/pause
            this.lastTapTime = 0; // Reset to prevent triple-tap
            this.togglePlay();
            // No OSD needed - play overlay provides visual feedback
        } else {
            // First tap - wait to see if there's a second one
            this.lastTapTime = now;
            this.tapTimeout = setTimeout(() => {
                // No second tap detected within delay - treat as single tap
                // For single tap, we'll just do nothing (rely on controls overlay)
                this.tapTimeout = null;
            }, this.DOUBLE_TAP_DELAY);
        }
    }

    togglePlay() {
        this.video.paused ? this.video.play() : this.video.pause();
    }

    seekBy(seconds) {
        this.video.currentTime = Math.max(
            0,
            Math.min(this.video.currentTime + seconds, this.video.duration)
        );
        // Immediate visual feedback
        this.updateProgress();
    }

    seek(e) {
        const rect = this.progressContainer.getBoundingClientRect();
        const pct = (e.clientX - rect.left) / rect.width;
        this.video.currentTime = pct * this.video.duration;
        // Immediate visual feedback
        this.updateProgress();
    }

    toggleFullscreen() {
        document.fullscreenElement
            ? document.exitFullscreen()
            : this.playerContainer.requestFullscreen();
    }

    async togglePiP() {
        try {
            document.pictureInPictureElement
                ? await document.exitPictureInPicture()
                : await this.video.requestPictureInPicture();
        } catch {}
    }

    updateProgressTooltip(e) {
        if (!this.video.duration) return;

        const rect = this.progressContainer.getBoundingClientRect();
        const percent = (e.clientX - rect.left) / rect.width;
        const time = percent * this.video.duration;
        
        // Update tooltip text
        this.progressTooltip.textContent = this.formatTime(time);
        
        // Position tooltip
        this.progressTooltip.style.left = `${percent * 100}%`;
        this.progressTooltip.style.opacity = '1';
    }

    /* =======================
       UI Helpers
       ======================= */

    resetUI() {
        this.showLoading();
        this.errorOverlay.classList.remove('active');
        this.bufferIndicator.classList.remove('active');
        this.progressPlayed.style.width = '0%';
        this.progressBuffer.style.width = '0%';
        this.bufferPercent.textContent = '0s';
        this.networkSpeed.textContent = '—';
    }

    updateProgress() {
        const pct = (this.video.currentTime / this.video.duration) * 100;
        this.progressPlayed.style.width = `${pct}%`;
        this.progressThumb.style.left = `${pct}%`;
        this.currentTimeEl.textContent = this.formatTime(this.video.currentTime);
    }

    showPlayerSection() {
        this.urlSection.classList.add('hidden');
        this.playerSection.classList.add('active');
    }

    showUrlSection() {
        this.video.pause();
        this.video.src = '';
        this.video.load();
        this.urlSection.classList.remove('hidden');
        this.playerSection.classList.remove('active');
    }

    showLoading() {
        this.loadingOverlay.classList.add('active');
    }

    hideLoading() {
        this.loadingOverlay.classList.remove('active');
    }

    showError(msg) {
        this.errorText.textContent = msg;
        this.errorOverlay.classList.add('active');
        this.hideLoading();
    }

    formatTime(sec) {
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        return `${m}:${String(s).padStart(2, '0')}`;
    }

    updatePlayPauseIcon() {
        const playIcon = this.playPauseBtn.querySelector('.icon-play');
        const pauseIcon = this.playPauseBtn.querySelector('.icon-pause');
        
        if (this.video.paused) {
            playIcon.style.display = 'block';
            pauseIcon.style.display = 'none';
        } else {
            playIcon.style.display = 'none';
            pauseIcon.style.display = 'block';
        }
    }

    showOSD(iconOrMessage, message = null) {
        // Clear any existing timeout
        if (this.osdTimeout) {
            clearTimeout(this.osdTimeout);
        }

        // If message is provided, first param is icon name
        if (message) {
            this.osd.innerHTML = `<i data-lucide="${iconOrMessage}"></i><span>${message}</span>`;
            // Reinitialize all Lucide icons
            if (typeof lucide !== 'undefined') {
                lucide.createIcons();
            }
        } else {
            // Just text, no icon
            this.osd.innerHTML = `<span>${iconOrMessage}</span>`;
        }
        
        this.osd.classList.add('show');

        // Hide after 800ms - shorter for premium feel
        this.osdTimeout = setTimeout(() => {
            this.osd.classList.remove('show');
        }, 800);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.streamFlow = new StreamFlowPlayer();
});
