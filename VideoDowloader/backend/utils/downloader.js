const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const ffmpeg = require('ffmpeg-static');

// Path to the yt-dlp binary
const getCustomYtDlpPath = () => {
  const isWindows = process.platform === 'win32';
  const fileName = isWindows ? 'yt-dlp.exe' : 'yt-dlp';
  return path.join(__dirname, '..', 'bin', fileName);
};

// Identify platform from URL
function getPlatform(url) {
  const lowercaseUrl = url.toLowerCase();
  if (lowercaseUrl.includes('youtube.com') || lowercaseUrl.includes('youtu.be')) {
    return 'youtube';
  } else if (lowercaseUrl.includes('tiktok.com')) {
    return 'tiktok';
  } else if (lowercaseUrl.includes('facebook.com') || lowercaseUrl.includes('fb.watch') || lowercaseUrl.includes('fb.com')) {
    return 'facebook';
  } else if (lowercaseUrl.includes('twitter.com') || lowercaseUrl.includes('x.com')) {
    return 'twitter';
  }
  return 'other';
}

// Convert seconds to HH:MM:SS or MM:SS
function formatDuration(durationSec) {
  if (!durationSec) return 'Unknown';
  const hrs = Math.floor(durationSec / 3600);
  const mins = Math.floor((durationSec % 3600) / 60);
  const secs = Math.floor(durationSec % 60);

  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Get video metadata
function getVideoInfo(url) {
  return new Promise((resolve, reject) => {
    const ytDlpPath = getCustomYtDlpPath();

    if (!fs.existsSync(ytDlpPath)) {
      return reject(new Error('yt-dlp is not installed. Please wait for setup to finish or restart the server.'));
    }

    console.log(`[Downloader] Fetching info for: ${url}`);
    
    const args = ['--dump-json', '--no-playlist'];
    
    // Check for cookies.txt file or environment browser cookies setting
    const cookiesPathRoot = path.join(__dirname, '..', '..', 'cookies.txt');
    const cookiesPathBackend = path.join(__dirname, '..', 'cookies.txt');
    if (fs.existsSync(cookiesPathRoot)) {
      args.push('--cookies', cookiesPathRoot);
    } else if (fs.existsSync(cookiesPathBackend)) {
      args.push('--cookies', cookiesPathBackend);
    } else if (process.env.COOKIES_FROM_BROWSER) {
      args.push('--cookies-from-browser', process.env.COOKIES_FROM_BROWSER);
    }
    
    args.push(url);
    
    const ytDlpProcess = spawn(ytDlpPath, args);

    let stdoutData = '';
    let stderrData = '';

    ytDlpProcess.stdout.on('data', (data) => {
      stdoutData += data.toString();
    });

    ytDlpProcess.stderr.on('data', (data) => {
      stderrData += data.toString();
    });

    ytDlpProcess.on('close', (code) => {
      if (code !== 0) {
        console.error(`[Downloader] yt-dlp failed with code ${code}. Error: ${stderrData}`);
        return reject(new Error(`Failed to retrieve video information: ${stderrData.split('\n')[0] || 'Unknown error'}`));
      }

      try {
        const metadata = JSON.parse(stdoutData);
        const platform = getPlatform(url);

        // Normalize info response
        const result = {
          title: metadata.title,
          thumbnail: metadata.thumbnail || (metadata.thumbnails && metadata.thumbnails.length ? metadata.thumbnails[metadata.thumbnails.length - 1].url : ''),
          duration: formatDuration(metadata.duration),
          durationRaw: metadata.duration,
          uploader: metadata.uploader || metadata.author || 'Unknown',
          platform: platform,
          originalUrl: url,
        };

        resolve(result);
      } catch (parseErr) {
        console.error('[Downloader] JSON parse error:', parseErr);
        reject(new Error('Failed to parse video metadata.'));
      }
    });
  });
}

// Download video/audio
function downloadVideo(url, options = {}, progressCallback) {
  return new Promise((resolve, reject) => {
    const ytDlpPath = getCustomYtDlpPath();
    const ffmpegPath = ffmpeg;
    const ffmpegDir = path.dirname(ffmpegPath);

    if (!fs.existsSync(ytDlpPath)) {
      return reject(new Error('yt-dlp is not installed.'));
    }

    const platform = getPlatform(url);
    const downloadBaseDir = process.env.DOWNLOAD_DIR || path.join(process.env.USERPROFILE || process.env.HOME || '.', 'Videos', 'ExtensionVideos');
    const platformDir = path.join(downloadBaseDir, platform);

    // Create directories if they do not exist
    if (!fs.existsSync(platformDir)) {
      fs.mkdirSync(platformDir, { recursive: true });
    }

    console.log(`[Downloader] Target download folder: ${platformDir}`);

    const formatOption = options.format || 'mp4'; // 'mp4' or 'mp3'
    const resolution = options.resolution || 'best'; // 'best', '1080p', '720p', '480p'

    const args = [];

    // Check for cookies.txt file or environment browser cookies setting
    const cookiesPathRoot = path.join(__dirname, '..', '..', 'cookies.txt');
    const cookiesPathBackend = path.join(__dirname, '..', 'cookies.txt');
    if (fs.existsSync(cookiesPathRoot)) {
      args.push('--cookies', cookiesPathRoot);
    } else if (fs.existsSync(cookiesPathBackend)) {
      args.push('--cookies', cookiesPathBackend);
    } else if (process.env.COOKIES_FROM_BROWSER) {
      args.push('--cookies-from-browser', process.env.COOKIES_FROM_BROWSER);
    }

    // Add output template: e.g. path/to/youtube/%(title)s.%(ext)s
    // To avoid issues with weird characters, we can clean titles or use yt-dlp defaults
    args.push('-o', path.join(platformDir, '%(title)s.%(ext)s'));
    
    // Add ffmpeg location
    args.push('--ffmpeg-location', ffmpegDir);

    // Handle format and resolution arguments
    if (formatOption === 'mp3') {
      args.push('-f', 'ba/b');
      args.push('-x');
      args.push('--audio-format', 'mp3');
      args.push('--audio-quality', '0'); // Best quality MP3
    } else {
      // MP4 format
      if (platform !== 'youtube') {
        // For TikTok, Facebook, etc., use default best video and audio stream
        args.push('-f', 'bv*+ba/b');
        args.push('--merge-output-format', 'mp4');
      } else {
        // YouTube resolution selection
        if (resolution === 'best') {
          args.push('-f', 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4] / bv*+ba/b');
          args.push('--merge-output-format', 'mp4');
        } else if (resolution === '1080p') {
          args.push('-f', 'bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080][ext=mp4] / bv*[height<=1080]+ba/b[height<=1080]');
          args.push('--merge-output-format', 'mp4');
        } else if (resolution === '720p') {
          args.push('-f', 'bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720][ext=mp4] / bv*[height<=720]+ba/b[height<=720]');
          args.push('--merge-output-format', 'mp4');
        } else if (resolution === '480p') {
          args.push('-f', 'bv*[height<=480][ext=mp4]+ba[ext=m4a]/b[height<=480][ext=mp4] / bv*[height<=480]+ba/b[height<=480]');
          args.push('--merge-output-format', 'mp4');
        } else {
          // Fallback
          args.push('-f', 'bv+ba/b');
          args.push('--merge-output-format', 'mp4');
        }
      }
    }

    // Add generic flags
    args.push('--no-playlist');
    args.push('--newline'); // Force yt-dlp to output progress on new lines
    args.push(url);

    console.log(`[Downloader] Running yt-dlp with arguments: ${args.join(' ')}`);

    const ytDlpProcess = spawn(ytDlpPath, args);
    let lastPercent = 0;
    let isExtractingOrMerging = false;
    let finalFilePath = '';

    ytDlpProcess.stdout.on('data', (data) => {
      const output = data.toString();

      // Look for download percentage: "[download]  12.3% of..."
      const progressMatch = output.match(/\[download\]\s+(\d+(?:\.\d+)?)%/);
      if (progressMatch) {
        const percent = parseFloat(progressMatch[1]);
        if (percent > lastPercent) {
          lastPercent = percent;
          progressCallback({
            status: 'downloading',
            progress: percent,
            message: `Downloading: ${percent.toFixed(1)}%`
          });
        }
      }

      // Look for destination file path (useful to know where it saved)
      const destMatch = output.match(/\[download\] Destination: (.+)/) || output.match(/\[Merge\] Merging formats into "(.+)"/) || output.match(/\[ExtractAudio\] Destination: (.+)/);
      if (destMatch) {
        finalFilePath = destMatch[1].trim();
      }

      // Check if it's merging or extracting audio
      if (output.includes('[Merger]') || output.includes('Merging formats')) {
        if (!isExtractingOrMerging) {
          isExtractingOrMerging = true;
          progressCallback({
            status: 'merging',
            progress: 99,
            message: 'Merging video and audio streams...'
          });
        }
      } else if (output.includes('[ExtractAudio]') || output.includes('Converting video to audio')) {
        if (!isExtractingOrMerging) {
          isExtractingOrMerging = true;
          progressCallback({
            status: 'converting',
            progress: 99,
            message: 'Extracting and converting audio to MP3...'
          });
        }
      }
    });

    let errorOutput = '';
    ytDlpProcess.stderr.on('data', (data) => {
      errorOutput += data.toString();
      // stderr can also show warnings, but we log it
      console.warn(`[Downloader yt-dlp stderr]: ${data.toString().trim()}`);
    });

    ytDlpProcess.on('close', (code) => {
      if (code !== 0) {
        console.error(`[Downloader] Download process failed with code ${code}. Error: ${errorOutput}`);
        return reject(new Error(errorOutput.split('\n')[0] || `Download process exited with code ${code}`));
      }

      console.log(`[Downloader] Download process completed successfully.`);
      progressCallback({
        status: 'completed',
        progress: 100,
        message: 'Download completed successfully!',
        filePath: finalFilePath || path.join(platformDir, 'Unknown')
      });
      resolve(finalFilePath);
    });
  });
}

module.exports = {
  getVideoInfo,
  downloadVideo,
  getPlatform
};
