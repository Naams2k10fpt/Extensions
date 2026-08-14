require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { exec, spawn } = require('child_process');
const { downloadYtDlp } = require('./utils/setup');
const { getVideoInfo, downloadVideo, getPlatform } = require('./utils/downloader');
const ffmpeg = require('ffmpeg-static');

const app = express();
const PORT = process.env.PORT || 4000;

const startTime = Date.now();
let lastHeartbeat = Date.now();

const logFilePath = path.join(__dirname, 'server.log');

// Log writer helper
function writeLog(type, message, error) {
  try {
    const timestamp = new Date().toISOString();
    let logContent = `[${timestamp}] [${type}] ${message}\n`;
    if (error) {
      logContent += `Error Message: ${error.message || error}\n`;
      if (error.stack) {
        logContent += `Stack: ${error.stack}\n`;
      }
    }
    logContent += `----------------------------------------\n`;
    fs.appendFileSync(logFilePath, logContent, 'utf8');
  } catch (err) {
    console.error('Failed to write to log file:', err);
  }
}

// Log startup info
writeLog('STARTUP', `Server starting up on port ${PORT}...`);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// In-memory store for tracking download progress
// Key: downloadId, Value: { progress, status, message, clients: [] }
const activeDownloads = {};

// Function to update yt-dlp in background
function updateYtDlp() {
  const isWindows = process.platform === 'win32';
  const fileName = isWindows ? 'yt-dlp.exe' : 'yt-dlp';
  const ytDlpPath = path.join(__dirname, 'bin', fileName);

  if (!fs.existsSync(ytDlpPath)) return;

  writeLog('INFO', 'Checking for yt-dlp updates in background...');
  console.log('[Server] Checking for yt-dlp updates...');

  const updateProcess = spawn(ytDlpPath, ['-U']);
  let output = '';
  let errorOutput = '';

  updateProcess.stdout.on('data', (data) => {
    output += data.toString();
  });

  updateProcess.stderr.on('data', (data) => {
    errorOutput += data.toString();
  });

  updateProcess.on('close', (code) => {
    if (code === 0) {
      writeLog('SUCCESS', `yt-dlp update check finished. Output: ${output.trim()}`);
      console.log(`[Server] yt-dlp update check completed: ${output.trim()}`);
    } else {
      writeLog('ERROR', `yt-dlp update check failed with code ${code}. Error: ${errorOutput.trim()}`);
      console.error(`[Server] yt-dlp update check failed: ${errorOutput.trim()}`);
    }
  });
}

// Auto-setup yt-dlp on startup
console.log('[Server] Starting setup check...');
downloadYtDlp()
  .then((filePath) => {
    console.log(`[Server] yt-dlp setup complete. Path: ${filePath}`);
    // Check for updates in background asynchronously after 2 seconds
    setTimeout(updateYtDlp, 2000);
  })
  .catch((err) => {
    console.error('[Server] Critical: Failed to download yt-dlp on startup.', err.message);
  });

// API: Get video metadata
app.post('/api/info', async (req, res) => {
  const { url } = req.body;
  if (!url) {
    writeLog('WARNING', 'Info request received without URL.');
    return res.status(400).json({ error: 'URL is required.' });
  }

  console.log(`[Server] Received info request for: ${url}`);
  writeLog('INFO', `Received info request for URL: ${url}`);

  try {
    const info = await getVideoInfo(url);
    res.json(info);
  } catch (error) {
    console.error('[Server] Info fetch failed:', error.message);
    writeLog('ERROR', `Failed to get video info for: ${url}`, error);
    res.status(500).json({ error: error.message });
  }
});

// API: Start download
app.post('/api/download', async (req, res) => {
  const { url, format, resolution, customFilename } = req.body;
  if (!url) {
    writeLog('WARNING', 'Download request received without URL.');
    return res.status(400).json({ error: 'URL is required.' });
  }

  writeLog('INFO', `Received download request for URL: ${url}, Format: ${format}, Resolution: ${resolution}, customFilename: ${customFilename}`);

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
  downloadVideo(url, { format, resolution, downloadId, customFilename }, (progressData) => {
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

      // Log complete/fail events
      if (progressData.status === 'completed') {
        writeLog('SUCCESS', `Download complete for URL: ${url}. Saved to: ${progressData.filePath}`);
      } else if (progressData.status === 'failed') {
        writeLog('ERROR', `Download callback reported failure for URL: ${url}. Msg: ${progressData.message}`);
      }

      // If finished or failed, clean up clients and record after a short delay
      if (progressData.status === 'completed' || progressData.status === 'failed') {
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
    writeLog('DOWNLOAD_ERROR', `Download ID ${downloadId} failed. URL: ${url}`, err);
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

// Helper to broadcast progress to all connected clients
function broadcastProgress(downloadId, progressData) {
  if (activeDownloads[downloadId]) {
    activeDownloads[downloadId].progress = progressData.progress;
    activeDownloads[downloadId].status = progressData.status;
    activeDownloads[downloadId].message = progressData.message;

    const payload = JSON.stringify({
      progress: progressData.progress,
      status: progressData.status,
      message: progressData.message,
      filePath: progressData.filePath || ''
    });

    activeDownloads[downloadId].clients.forEach((clientRes) => {
      clientRes.write(`data: ${payload}\n\n`);
    });
  }
}

// API: Convert uploaded video to audio (MP3/OGG)
app.post('/api/convert', (req, res) => {
  const { format, filename } = req.query;
  
  if (!format || !filename) {
    writeLog('WARNING', 'Convert request received with missing parameters.');
    return res.status(400).json({ error: 'Format and filename are required in query params.' });
  }

  const downloadId = Date.now().toString();
  writeLog('INFO', `Received conversion request ID: ${downloadId}. Target Name: ${filename}, Format: ${format}`);

  // Create directories if they do not exist
  const audioDir = process.env.AUDIO_DOWNLOAD_DIR || path.join(process.env.USERPROFILE || process.env.HOME || '.', 'Music');
  const targetDir = path.join(audioDir, 'audio');
  
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const tempVideoPath = path.join(targetDir, `temp_upload_${downloadId}.mp4`);

  // Initialize progress tracking
  activeDownloads[downloadId] = {
    progress: 0,
    status: 'starting',
    message: 'Preparing upload stream...',
    clients: [],
    platform: 'audio'
  };

  const fileStream = fs.createWriteStream(tempVideoPath);
  req.pipe(fileStream);

  fileStream.on('error', (err) => {
    writeLog('ERROR', `File write error on conversion ID ${downloadId}`, err);
    activeDownloads[downloadId].status = 'failed';
    activeDownloads[downloadId].message = 'Lỗi ghi file tạm lên server.';
    
    broadcastProgress(downloadId, {
      progress: 0,
      status: 'failed',
      message: 'Lỗi ghi file tạm lên server.'
    });

    res.status(500).json({ error: 'Failed to write temporary file.' });
  });

  fileStream.on('finish', () => {
    writeLog('INFO', `File upload finished for conversion ID ${downloadId}. Saved to temp: ${tempVideoPath}`);
    
    // Respond to HTTP upload request immediately so client knows upload completed
    res.json({
      success: true,
      downloadId: downloadId,
      message: 'File uploaded. Conversion starting...'
    });

    // Start background conversion
    broadcastProgress(downloadId, {
      progress: 80,
      status: 'converting',
      message: 'Đang chuyển đổi video sang audio...'
    });

    const cleanName = filename.replace(/[\\/:*?"<>|]/g, '_').trim() || 'audio_converted';
    const finalFilePath = path.join(targetDir, `${cleanName}.${format}`);
    
    // Choose audio codec
    const audioCodec = format === 'ogg' ? 'libvorbis' : 'libmp3lame';
    
    const ffmpegArgs = [
      '-y',
      '-i', tempVideoPath,
      '-vn',
      '-acodec', audioCodec,
      '-ab', '320k',
      finalFilePath
    ];

    writeLog('INFO', `Starting FFmpeg process: ${ffmpeg} ${ffmpegArgs.join(' ')}`);

    const ffmpegProcess = spawn(ffmpeg, ffmpegArgs);
    let ffmpegErr = '';

    ffmpegProcess.stderr.on('data', (d) => {
      ffmpegErr += d.toString();
    });

    ffmpegProcess.on('close', (code) => {
      // Clean up temp video file
      try {
        if (fs.existsSync(tempVideoPath)) {
          fs.unlinkSync(tempVideoPath);
        }
      } catch (unlinkErr) {
        console.warn(`Failed to delete temp video upload file: ${tempVideoPath}`, unlinkErr.message);
      }

      if (code !== 0) {
        writeLog('ERROR', `FFmpeg conversion failed for ID ${downloadId}. Err: ${ffmpegErr}`);
        broadcastProgress(downloadId, {
          progress: 0,
          status: 'failed',
          message: 'Lỗi chuyển mã FFmpeg.'
        });
      } else {
        writeLog('SUCCESS', `Successfully converted video to audio. Saved: ${finalFilePath}`);
        broadcastProgress(downloadId, {
          progress: 100,
          status: 'completed',
          message: 'Chuyển đổi thành công!',
          filePath: finalFilePath
        });
      }

      // Short delay before closing SSE clients
      setTimeout(() => {
        if (activeDownloads[downloadId]) {
          activeDownloads[downloadId].clients.forEach((clientRes) => clientRes.end());
          delete activeDownloads[downloadId];
        }
      }, 5000);
    });
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

// API: Check and update yt-dlp manually
app.post('/api/check-update', (req, res) => {
  const isWindows = process.platform === 'win32';
  const fileName = isWindows ? 'yt-dlp.exe' : 'yt-dlp';
  const ytDlpPath = path.join(__dirname, 'bin', fileName);

  if (!fs.existsSync(ytDlpPath)) {
    return res.status(400).json({ error: 'yt-dlp is not installed yet.' });
  }

  writeLog('INFO', 'Manual update request received.');
  const updateProcess = spawn(ytDlpPath, ['-U']);
  let output = '';
  let errorOutput = '';

  updateProcess.stdout.on('data', (data) => {
    output += data.toString();
  });

  updateProcess.stderr.on('data', (data) => {
    errorOutput += data.toString();
  });

  updateProcess.on('close', (code) => {
    if (code === 0) {
      writeLog('SUCCESS', `Manual update check completed. Output: ${output.trim()}`);
      res.json({ success: true, message: output.trim() });
    } else {
      writeLog('ERROR', `Manual update check failed. Error: ${errorOutput.trim()}`);
      res.status(500).json({ error: errorOutput.trim() || 'Failed to check updates.' });
    }
  });
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
  writeLog('START', `Express server running at http://localhost:${PORT}`);
});

process.on('uncaughtException', (err) => {
  writeLog('CRITICAL_UNCAUGHT', 'Uncaught Exception occurred', err);
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  writeLog('CRITICAL_REJECTION', `Unhandled Rejection at promise: ${promise}`, reason);
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
