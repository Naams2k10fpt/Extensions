const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { Readable } = require('stream');
const { finished } = require('stream/promises');
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
  return new Promise(async (resolve, reject) => {
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

    // Fetch video info to get metadata (especially title)
    let title = 'video';
    if (options.customFilename) {
      title = options.customFilename;
    } else {
      try {
        const info = await getVideoInfo(url);
        title = info.title || 'video';
      } catch (err) {
        console.warn('[Downloader] Failed to get video info for title, using default name:', err.message);
      }
    }
    
    // Clean title for Windows filesystem compatibility
    const cleanTitle = title.replace(/[\\/:*?"<>|]/g, '_').trim();
    const formatOption = options.format || 'mp4'; // 'mp4', 'mp3', 'gif', 'ogg'
    const resolution = options.resolution || 'best'; // 'best', '1080p', '720p', '480p'
    const downloadId = options.downloadId || Date.now().toString();

    // Determine if video needs transcoding (disabled to keep original file)
    let needsTranscoding = false;

    // Fixed ASCII paths for downloads to prevent Unicode/Emoji encoding issues on Windows
    const tempFileTemplate = path.join(platformDir, `temp_${downloadId}.%(ext)s`);
    const tempFilePathMp4 = path.join(platformDir, `temp_${downloadId}.mp4`);
    const tempFilePathMp3 = path.join(platformDir, `temp_${downloadId}.mp3`);
    const tempFilePathOgg = path.join(platformDir, `temp_${downloadId}.ogg`);
    
    const finalExt = formatOption === 'mp3' ? 'mp3' : (formatOption === 'gif' ? 'gif' : (formatOption === 'ogg' ? 'ogg' : 'mp4'));
    const finalFilePath = path.join(platformDir, `${cleanTitle}.${finalExt}`);

    // ============================================
    // TikTok API Download (Primary Method)
    // ============================================
    if (platform === 'tiktok') {
      console.log(`[Downloader] Attempting TikTok download via TikWM API for URL: ${url}`);
      progressCallback({
        status: 'starting',
        progress: 10,
        message: 'Connecting to TikTok API...'
      });
      
      try {
        const apiUrl = `https://tikwm.com/api/?url=${encodeURIComponent(url)}`;
        const response = await fetch(apiUrl);
        const result = await response.json();
        
        if (result && result.code === 0 && result.data) {
          const data = result.data;
          let isAudio = formatOption === 'mp3' || formatOption === 'ogg';
          let downloadUrl = isAudio ? data.music : data.play;
          
          if (downloadUrl) {
            console.log(`[Downloader] TikTok API success. Stream URL: ${downloadUrl}`);
            const tempFilePath = isAudio 
              ? (formatOption === 'mp3' ? tempFilePathMp3 : tempFilePathOgg) 
              : tempFilePathMp4;
            
            // If ogg is requested, TikWM only returns mp3 stream so we must download to tempFilePathMp3 and convert using ffmpeg
            const downloadDestPath = formatOption === 'ogg' ? tempFilePathMp3 : tempFilePath;
            
            progressCallback({
              status: 'downloading',
              progress: 20,
              message: 'Downloading media stream...'
            });
            
            const streamRes = await fetch(downloadUrl);
            if (!streamRes.ok) {
              throw new Error(`Failed to download TikTok stream: ${streamRes.statusText}`);
            }
            
            const contentLength = streamRes.headers.get('content-length');
            const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;
            
            const fileStream = fs.createWriteStream(downloadDestPath);
            const bodyStream = Readable.fromWeb(streamRes.body);
            let downloadedBytes = 0;
            
            bodyStream.on('data', (chunk) => {
              downloadedBytes += chunk.length;
              if (totalBytes > 0) {
                const percent = (downloadedBytes / totalBytes) * 100;
                progressCallback({
                  status: 'downloading',
                  progress: percent,
                  message: `Downloading: ${percent.toFixed(1)}%`
                });
              }
            });
            
            bodyStream.pipe(fileStream);
            await finished(fileStream);
            
            console.log(`[Downloader] TikTok API download finished. Postprocessing...`);
            
            if (formatOption === 'gif') {
              progressCallback({
                status: 'converting',
                progress: 99,
                message: 'Converting video to high-quality GIF...'
              });
              
              await new Promise((resGif, rejGif) => {
                const ffmpegProcess = spawn(ffmpegPath, [
                  '-y',
                  '-i', tempFilePathMp4,
                  '-vf', 'fps=15,scale=480:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse',
                  '-loop', '0',
                  finalFilePath
                ]);
                
                let ffmpegErr = '';
                ffmpegProcess.stderr.on('data', (d) => ffmpegErr += d.toString());
                ffmpegProcess.on('close', (ffmpegCode) => {
                  try { fs.unlinkSync(tempFilePathMp4); } catch {}
                  if (ffmpegCode !== 0) {
                    rejGif(new Error(`Failed to convert GIF: ${ffmpegErr}`));
                  } else {
                    resGif();
                  }
                });
              });
            } else if (formatOption === 'ogg') {
              // Convert downloaded temp MP3 music stream to OGG
              progressCallback({
                status: 'converting',
                progress: 99,
                message: 'Converting audio to OGG format...'
              });
              
              await new Promise((resOgg, rejOgg) => {
                const ffmpegProcess = spawn(ffmpegPath, [
                  '-y',
                  '-i', tempFilePathMp3,
                  '-c:a', 'libvorbis',
                  finalFilePath
                ]);
                
                let ffmpegErr = '';
                ffmpegProcess.stderr.on('data', (d) => ffmpegErr += d.toString());
                ffmpegProcess.on('close', (ffmpegCode) => {
                  try { fs.unlinkSync(tempFilePathMp3); } catch {}
                  if (ffmpegCode !== 0) {
                    rejOgg(new Error(`Failed to convert OGG: ${ffmpegErr}`));
                  } else {
                    resOgg();
                  }
                });
              });
            } else {
              const tempPath = formatOption === 'mp3' ? tempFilePathMp3 : tempFilePathMp4;
              if (fs.existsSync(finalFilePath)) {
                fs.unlinkSync(finalFilePath);
              }
              fs.renameSync(tempPath, finalFilePath);
            }
            
            progressCallback({
              status: 'completed',
              progress: 100,
              message: 'Download completed successfully!',
              filePath: finalFilePath
            });
            return resolve(finalFilePath);
          }
        }
        console.warn(`[Downloader] TikTok API did not return valid links. Falling back to local yt-dlp...`);
      } catch (apiErr) {
        console.error(`[Downloader] TikTok API download failed. Error:`, apiErr.message);
        console.log(`[Downloader] Falling back to local yt-dlp...`);
      }
    }
    // ============================================

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

    // Add output template using clean ASCII ID
    args.push('-o', tempFileTemplate);
    
    // Add ffmpeg location
    args.push('--ffmpeg-location', ffmpegDir);

    // Handle format and resolution arguments
    if (formatOption === 'mp3' || formatOption === 'ogg') {
      args.push('-f', 'ba/b');
      args.push('-x');
      args.push('--audio-format', formatOption);
      args.push('--audio-quality', '0'); // Best quality
    } else if (formatOption === 'gif') {
      // For GIF conversion, we download as MP4 video (audio not required, but default merge is safe)
      if (platform !== 'youtube') {
        args.push('-f', 'bv*+ba/b');
        args.push('--merge-output-format', 'mp4');
      } else {
        // YouTube: 720p is plenty for GIF conversion (saves download time)
        args.push('-f', 'bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720][ext=mp4] / bv*[height<=720]+ba/b[height<=720]');
        args.push('--merge-output-format', 'mp4');
      }
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
      console.warn(`[Downloader yt-dlp stderr]: ${data.toString().trim()}`);
    });

    ytDlpProcess.on('close', (code) => {
      if (code !== 0) {
        console.error(`[Downloader] Download process failed with code ${code}. Error: ${errorOutput}`);
        return reject(new Error(errorOutput.split('\n')[0] || `Download process exited with code ${code}`));
      }

      console.log(`[Downloader] Download process completed successfully.`);
      
      // 1. Handle Audio conversion rename (MP3/OGG)
      if (formatOption === 'mp3' || formatOption === 'ogg') {
        const tempAudioPath = formatOption === 'mp3' ? tempFilePathMp3 : tempFilePathOgg;
        if (!fs.existsSync(tempAudioPath)) {
          if (fs.existsSync(finalFilePath)) {
            progressCallback({
              status: 'completed',
              progress: 100,
              message: 'Download completed successfully!',
              filePath: finalFilePath
            });
            return resolve(finalFilePath);
          }
          return reject(new Error(`Downloaded ${formatOption.toUpperCase()} file not found.`));
        }

        try {
          if (fs.existsSync(finalFilePath)) {
            fs.unlinkSync(finalFilePath);
          }
          fs.renameSync(tempAudioPath, finalFilePath);
          console.log(`[Downloader] Renamed ${tempAudioPath} to ${finalFilePath}`);
        } catch (renameErr) {
          console.error(`[Downloader] Rename failed:`, renameErr.message);
          return reject(renameErr);
        }

        progressCallback({
          status: 'completed',
          progress: 100,
          message: 'Download completed successfully!',
          filePath: finalFilePath
        });
        return resolve(finalFilePath);
      }

      // 2. Handle GIF Conversion
      if (formatOption === 'gif') {
        if (!fs.existsSync(tempFilePathMp4)) {
          return reject(new Error('Downloaded video file not found for GIF conversion.'));
        }

        progressCallback({
          status: 'converting',
          progress: 99,
          message: 'Converting video to high-quality GIF...'
        });

        console.log(`[Downloader] Converting ${tempFilePathMp4} to ${finalFilePath} using ffmpeg...`);
        
        // ffmpeg command for high-quality loopable GIF using custom palette
        const ffmpegProcess = spawn(ffmpegPath, [
          '-y',
          '-i', tempFilePathMp4,
          '-vf', 'fps=15,scale=480:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse',
          '-loop', '0',
          finalFilePath
        ]);

        let ffmpegErr = '';
        ffmpegProcess.stderr.on('data', (data) => {
          ffmpegErr += data.toString();
        });

        ffmpegProcess.on('close', (ffmpegCode) => {
          try {
            fs.unlinkSync(tempFilePathMp4);
            console.log(`[Downloader] Cleaned up temporary video: ${tempFilePathMp4}`);
          } catch (delErr) {
            console.error(`[Downloader] Failed to delete temp video:`, delErr.message);
          }

          if (ffmpegCode !== 0) {
            console.error(`[Downloader] ffmpeg conversion failed: ${ffmpegErr}`);
            return reject(new Error(`Failed to convert to GIF: ${ffmpegErr.split('\n')[0] || 'Unknown ffmpeg error'}`));
          }

          progressCallback({
            status: 'completed',
            progress: 100,
            message: 'Converted to GIF successfully!',
            filePath: finalFilePath
          });
          resolve(finalFilePath);
        });
      } else if (formatOption === 'mp4' && needsTranscoding) {
        // 3. Handle MP4 Transcoding for incompatible codecs (like bytevc1/HEVC + HE-AAC on TikTok)
        if (!fs.existsSync(tempFilePathMp4)) {
          return reject(new Error('Downloaded video file not found for transcoding.'));
        }

        progressCallback({
          status: 'converting',
          progress: 99,
          message: 'Transcoding video to standard H.264/AAC for compatibility...'
        });

        console.log(`[Downloader] Transcoding ${tempFilePathMp4} to ${finalFilePath} using ffmpeg...`);
        
        const ffmpegProcess = spawn(ffmpegPath, [
          '-y',
          '-i', tempFilePathMp4,
          '-c:v', 'libx264',
          '-c:a', 'aac',
          '-preset', 'fast',
          '-crf', '23',
          finalFilePath
        ]);

        let ffmpegErr = '';
        ffmpegProcess.stderr.on('data', (data) => {
          ffmpegErr += data.toString();
        });

        ffmpegProcess.on('close', (ffmpegCode) => {
          try {
            fs.unlinkSync(tempFilePathMp4);
            console.log(`[Downloader] Cleaned up temporary video: ${tempFilePathMp4}`);
          } catch (delErr) {
            console.error(`[Downloader] Failed to delete temp video:`, delErr.message);
          }

          if (ffmpegCode !== 0) {
            console.error(`[Downloader] ffmpeg transcoding failed: ${ffmpegErr}`);
            return reject(new Error(`Failed to transcode video: ${ffmpegErr.split('\n')[0] || 'Unknown ffmpeg error'}`));
          }

          progressCallback({
            status: 'completed',
            progress: 100,
            message: 'Transcoded and downloaded successfully!',
            filePath: finalFilePath
          });
          resolve(finalFilePath);
        });
      } else {
        // 4. Normal MP4 video download completed (no transcoding needed)
        if (!fs.existsSync(tempFilePathMp4)) {
          return reject(new Error('Downloaded video file not found.'));
        }

        try {
          if (fs.existsSync(finalFilePath)) {
            fs.unlinkSync(finalFilePath);
          }
          fs.renameSync(tempFilePathMp4, finalFilePath);
          console.log(`[Downloader] Renamed ${tempFilePathMp4} to ${finalFilePath}`);
        } catch (renameErr) {
          console.error(`[Downloader] Rename failed:`, renameErr.message);
          return reject(renameErr);
        }

        progressCallback({
          status: 'completed',
          progress: 100,
          message: 'Download completed successfully!',
          filePath: finalFilePath
        });
        resolve(finalFilePath);
      }
    });
  });
}

module.exports = {
  getVideoInfo,
  downloadVideo,
  getPlatform
};
