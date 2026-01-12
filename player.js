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

        this.init();
    }

    init() {
        this.bindEvents();
        this.setupVideoEvents();
        this.urlInput.focus();
    }

    /* =======================
       Load Video
       ======================= */

    loadVideo() {
        let url = this.urlInput.value.trim();
        if (!url) return;

        if (this.useProxyCheckbox?.checked) {
            // Automatically use Vercel edge function in production, localhost in dev
            const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
            const proxyBase = isLocalhost 
                ? 'http://localhost:4001/proxy' 
                : 'https://streamflow-rho.vercel.app/api/server';
            url = `${proxyBase}?url=${encodeURIComponent(url)}`;
        }

        this.currentUrl = url;
        this.showPlayerSection();
        this.resetUI();

        this.lastBufferedEnd = 0;
        this.lastCheck = performance.now();
        this._nudged = false;

        this.video.pause();
        this.video.removeAttribute('src');
        this.video.preload = 'metadata';
        this.video.src = url;
        this.video.load();
    }

    /* =======================
       Events
       ======================= */

    bindEvents() {
        this.loadBtn.addEventListener('click', () => this.loadVideo());
        this.backBtn.addEventListener('click', () => this.showUrlSection());

        this.playPauseBtn.addEventListener('click', () => this.togglePlay());
        this.bigPlayBtn.addEventListener('click', () => this.togglePlay());
        this.video.addEventListener('click', () => this.togglePlay());

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
                this.showOSD(this.video.paused ? '▶️ Play' : '⏸️ Pause');
                break;
            
            case 'f':
                e.preventDefault();
                this.toggleFullscreen();
                this.showOSD(document.fullscreenElement ? '🔲 Fullscreen' : '⬜ Exit Fullscreen');
                break;
            
            case 'm':
                e.preventDefault();
                this.video.muted = !this.video.muted;
                this.showOSD(this.video.muted ? '🔇 Muted' : '🔊 Unmuted');
                break;
            
            case 'p':
                e.preventDefault();
                this.togglePiP();
                this.showOSD('📺 Picture-in-Picture');
                break;
            
            case 'arrowleft':
                e.preventDefault();
                this.seekBy(-10);
                this.showOSD('⏪ -10s');
                break;
            
            case 'arrowright':
                e.preventDefault();
                this.seekBy(10);
                this.showOSD('⏩ +10s');
                break;
            
            case 'arrowup':
                e.preventDefault();
                this.video.volume = Math.min(1, this.video.volume + 0.1);
                this.volumeSlider.value = this.video.volume;
                this.showOSD(`🔊 Volume: ${Math.round(this.video.volume * 100)}%`);
                break;
            
            case 'arrowdown':
                e.preventDefault();
                this.video.volume = Math.max(0, this.video.volume - 0.1);
                this.volumeSlider.value = this.video.volume;
                this.showOSD(`🔉 Volume: ${Math.round(this.video.volume * 100)}%`);
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
                this.showOSD(`⏱️ Jump to ${percent * 100}%`);
                break;
        }
    }

    setupVideoEvents() {
        this.video.addEventListener('loadedmetadata', () => {
            this.durationEl.textContent = this.formatTime(this.video.duration);
            this.hideLoading();
            this.playOverlay.classList.remove('hidden');
            this.updatePlayPauseIcon();
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

        this.video.addEventListener('error', () => {
            this.showError('Unable to load video');
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

    showOSD(message) {
        // Clear any existing timeout
        if (this.osdTimeout) {
            clearTimeout(this.osdTimeout);
        }

        // Show the OSD with the message
        this.osd.textContent = message;
        this.osd.classList.add('show');

        // Hide after 1 second
        this.osdTimeout = setTimeout(() => {
            this.osd.classList.remove('show');
        }, 1000);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.streamFlow = new StreamFlowPlayer();
});
