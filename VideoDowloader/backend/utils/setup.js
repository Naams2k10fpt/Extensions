const fs = require('fs');
const path = require('path');
const axios = require('axios');

async function downloadYtDlp() {
  const binDir = path.join(__dirname, '..', 'bin');
  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true });
  }

  const isWindows = process.platform === 'win32';
  const fileName = isWindows ? 'yt-dlp.exe' : 'yt-dlp';
  const filePath = path.join(binDir, fileName);

  if (fs.existsSync(filePath)) {
    console.log(`[Setup] yt-dlp binary already exists at: ${filePath}`);
    return filePath;
  }

  // URL for downloading latest yt-dlp
  // Windows: releases/latest/download/yt-dlp.exe
  // Unix: releases/latest/download/yt-dlp
  const url = isWindows
    ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
    : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';

  console.log(`[Setup] Downloading yt-dlp from: ${url}`);
  console.log(`[Setup] Target path: ${filePath}`);

  try {
    const response = await axios({
      method: 'get',
      url: url,
      responseType: 'stream',
    });

    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
        console.log('[Setup] Download completed successfully.');
        if (!isWindows) {
          // Make it executable on Unix/Mac
          try {
            fs.chmodSync(filePath, '755');
            console.log('[Setup] Made yt-dlp executable.');
          } catch (chmodErr) {
            console.warn('[Setup] Failed to make executable:', chmodErr.message);
          }
        }
        resolve(filePath);
      });
      writer.on('error', (err) => {
        console.error('[Setup] Writer error:', err);
        reject(err);
      });
    });
  } catch (error) {
    console.error('[Setup] Failed to download yt-dlp:', error.message);
    throw error;
  }
}

if (require.main === module) {
  downloadYtDlp().catch((err) => {
    console.error('[Setup] Setup failed:', err);
    process.exit(1);
  });
}

module.exports = { downloadYtDlp };
