require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { exec, spawn } = require('child_process');
const { downloadYtDlp } = require('./utils/setup');
const { getVideoInfo, downloadVideo, getPlatform } = require('./utils/downloader');

const app = express();
const PORT = process.env.PORT || 4000;

const startTime = Date.now();
let lastHeartbeat = Date.now();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// In-memory store for tracking download progress
// Key: downloadId, Value: { progress, status, message, clients: [] }
const activeDownloads = {};

// Auto-setup yt-dlp on startup
console.log('[Server] Starting setup check...');
downloadYtDlp()
  .then((filePath) => {
    console.log(`[Server] yt-dlp setup complete. Path: ${filePath}`);
  })
  .catch((err) => {
    console.error('[Server] Critical: Failed to download yt-dlp on startup.', err.message);
  });

// API: Get video metadata
app.post('/api/info', async (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'URL is required.' });
  }

  try {
    const info = await getVideoInfo(url);
    res.json(info);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Start download
app.post('/api/download', async (req, res) => {
  const { url, format, resolution } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'URL is required.' });
  }

  const downloadId = Date.now().toString();
  
  // Initialize progress tracking
  activeDownloads[downloadId] = {
    progress: 0,
    status: 'starting',
    message: 'Starting download process...',
    clients: [],
    platform: getPlatform(url)
  };

  // Start download in background
  downloadVideo(url, { format, resolution }, (progressData) => {
    // Progress Callback
    if (activeDownloads[downloadId]) {
      activeDownloads[downloadId].progress = progressData.progress;
      activeDownloads[downloadId].status = progressData.status;
      activeDownloads[downloadId].message = progressData.message;

      // Broadcast progress to all connected clients for this downloadId
      const payload = JSON.stringify({
        progress: progressData.progress,
        status: progressData.status,
        message: progressData.message,
        filePath: progressData.filePath || ''
      });

      activeDownloads[downloadId].clients.forEach((clientRes) => {
        clientRes.write(`data: ${payload}\n\n`);
      });

      // If finished or failed, clean up clients and record after a short delay
      if (progressData.status === 'completed' || progressData.status === 'failed') {
        // Auto-open folder if completed (optional, or let user click button. We will open it auto as well!)
        if (progressData.status === 'completed') {
          const platform = getPlatform(url);
          const downloadBaseDir = process.env.DOWNLOAD_DIR || path.join(process.env.USERPROFILE || process.env.HOME || '.', 'Videos', 'ExtensionVideos');
          const platformDir = path.join(downloadBaseDir, platform);
          if (process.platform === 'win32') {
            try {
              spawn('explorer.exe', [platformDir], { detached: true, stdio: 'ignore' }).unref();
            } catch (err) {
              console.error('[Server] Failed to open folder:', err.message);
            }
          }
        }

        setTimeout(() => {
          if (activeDownloads[downloadId]) {
            activeDownloads[downloadId].clients.forEach((clientRes) => clientRes.end());
            delete activeDownloads[downloadId];
          }
        }, 5000); // Wait 5 seconds so client receives final complete message
      }
    }
  }).catch((err) => {
    // Handle error
    console.error(`[Server] Download ID ${downloadId} error:`, err.message);
    if (activeDownloads[downloadId]) {
      activeDownloads[downloadId].status = 'failed';
      activeDownloads[downloadId].message = err.message;
      
      const payload = JSON.stringify({
        progress: 0,
        status: 'failed',
        message: err.message
      });

      activeDownloads[downloadId].clients.forEach((clientRes) => {
        clientRes.write(`data: ${payload}\n\n`);
        clientRes.end();
      });

      delete activeDownloads[downloadId];
    }
  });

  res.json({
    success: true,
    downloadId: downloadId,
    message: 'Download started.'
  });
});

// API: Server-Sent Events for download progress
app.get('/api/progress/:downloadId', (req, res) => {
  const { downloadId } = req.params;
  const download = activeDownloads[downloadId];

  // Set SSE Headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // If download doesn't exist, send error
  if (!download) {
    res.write(`data: ${JSON.stringify({ status: 'failed', message: 'Download task not found or expired.' })}\n\n`);
    return res.end();
  }

  // Add client response to broadcasting array
  download.clients.push(res);

  // Send current state immediately
  res.write(`data: ${JSON.stringify({
    progress: download.progress,
    status: download.status,
    message: download.message
  })}\n\n`);

  // Handle client disconnect
  req.on('close', () => {
    if (activeDownloads[downloadId]) {
      activeDownloads[downloadId].clients = activeDownloads[downloadId].clients.filter((c) => c !== res);
    }
  });
});

// API: Open specific download folder in Windows Explorer
app.post('/api/open-folder', (req, res) => {
  const { platform } = req.body;
  const downloadBaseDir = process.env.DOWNLOAD_DIR || path.join(process.env.USERPROFILE || process.env.HOME || '.', 'Videos', 'ExtensionVideos');
  const platformDir = platform ? path.join(downloadBaseDir, platform) : downloadBaseDir;

  if (!fs.existsSync(platformDir)) {
    fs.mkdirSync(platformDir, { recursive: true });
  }

  if (process.platform === 'win32') {
    try {
      spawn('explorer.exe', [platformDir], { detached: true, stdio: 'ignore' }).unref();
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to open directory: ' + err.message });
    }
  } else {
    res.status(501).json({ error: 'Not supported on this platform' });
  }
});

// API: Heartbeat ping from front-end to keep server alive
app.post('/api/heartbeat', (req, res) => {
  lastHeartbeat = Date.now();
  res.json({ success: true });
});

// Auto-shutdown checking interval (every 4s)
setInterval(() => {
  const elapsed = Date.now() - lastHeartbeat;
  const timeSinceStart = Date.now() - startTime;
  
  // No heartbeat for 8 seconds, and server has been running for at least 15 seconds (grace period to launch browser)
  if (elapsed > 8000 && timeSinceStart > 15000) {
    console.log('[Server] Detect app closed (No heartbeat received for 8 seconds). Auto-shutting down...');
    process.exit(0);
  }
}, 4000);

// Start Server
app.listen(PORT, () => {
  console.log(`[Server] Express server running at http://localhost:${PORT}`);
});
