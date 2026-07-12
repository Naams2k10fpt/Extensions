const BACKEND_URL = window.location.origin; // Dynamically use the current host (http://localhost:4000)
let currentPlatform = 'other';
let eventSource = null;

// DOM Elements
const connectionStatus = document.getElementById('connection-status');
const videoUrlInput = document.getElementById('video-url');
const btnPaste = document.getElementById('btn-paste');
const btnAnalyze = document.getElementById('btn-analyze');
const btnAnalyzeSpinner = btnAnalyze.querySelector('.loading-spinner');
const btnAnalyzeText = btnAnalyze.querySelector('span');

const videoInfoCard = document.getElementById('video-info-card');
const videoThumbnail = document.getElementById('video-thumbnail');
const videoDuration = document.getElementById('video-duration');
const platformBadge = document.getElementById('platform-badge');
const videoTitle = document.getElementById('video-title');
const videoUploader = document.getElementById('video-uploader');

const selectFormat = document.getElementById('select-format');
const selectResolution = document.getElementById('select-resolution');
const resolutionRow = document.getElementById('resolution-row');
const btnDownload = document.getElementById('btn-download');

const progressCard = document.getElementById('progress-card');
const progressStatusText = document.getElementById('progress-status-text');
const progressPercent = document.getElementById('progress-percent');
const progressBarFill = document.getElementById('progress-bar-fill');
const progressMessage = document.getElementById('progress-message');

const successCard = document.getElementById('success-card');
const successFilepath = document.getElementById('success-filepath');
const btnOpenFolder = document.getElementById('btn-open-folder');
const btnReset = document.getElementById('btn-reset');

const errorCard = document.getElementById('error-card');
const errorMessage = document.getElementById('error-message');
const btnErrorBack = document.getElementById('btn-error-back');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  checkBackendConnection();
  setupEventListeners();
  startHeartbeat();
});

// Send heartbeat to server every 3 seconds to keep it alive
function startHeartbeat() {
  // Send initial heartbeat
  sendHeartbeat();
  
  setInterval(sendHeartbeat, 3000);
}

async function sendHeartbeat() {
  try {
    await fetch(`${BACKEND_URL}/api/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.warn('[Heartbeat] Connection to backend lost:', err.message);
    setConnectionState(false);
  }
}

// Check if backend server is online
async function checkBackendConnection() {
  try {
    const response = await fetch(`${BACKEND_URL}/api/info`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: '' }) // Send empty URL to check connectivity
    });
    setConnectionState(true);
  } catch (err) {
    setConnectionState(false);
  }
}

function setConnectionState(isOnline) {
  if (isOnline) {
    connectionStatus.className = 'status-dot online';
    connectionStatus.title = 'Backend: Online';
    btnAnalyze.removeAttribute('disabled');
  } else {
    connectionStatus.className = 'status-dot offline';
    connectionStatus.title = 'Backend: Offline (Vui lòng khởi chạy ứng dụng)';
    btnAnalyze.setAttribute('disabled', 'true');
  }
}

function setupEventListeners() {
  // Paste button click
  btnPaste.addEventListener('click', async () => {
    try {
      // Browsers require permission to read from clipboard
      const text = await navigator.clipboard.readText();
      if (text) {
        videoUrlInput.value = text;
      }
    } catch (err) {
      console.error('Không thể đọc Clipboard:', err);
      alert('Vui lòng cấp quyền truy cập bộ nhớ tạm hoặc sử dụng phím Ctrl+V để dán trực tiếp.');
    }
  });

  // Analyze button click
  btnAnalyze.addEventListener('click', analyzeUrl);

  // Format selection change
  selectFormat.addEventListener('change', () => {
    if (selectFormat.value === 'mp3' || currentPlatform !== 'youtube') {
      resolutionRow.classList.add('hidden');
    } else {
      resolutionRow.classList.remove('hidden');
    }
  });

  // Download button click
  btnDownload.addEventListener('click', startDownload);

  // Open folder button click
  btnOpenFolder.addEventListener('click', openDownloadFolder);

  // Reset button click
  btnReset.addEventListener('click', showInputSection);

  // Error back button click
  btnErrorBack.addEventListener('click', showInputSection);

  // Also support pressing Enter key in the URL input box
  videoUrlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      analyzeUrl();
    }
  });
}

// State display management
function showInputSection() {
  videoInfoCard.classList.add('hidden');
  progressCard.classList.add('hidden');
  successCard.classList.add('hidden');
  errorCard.classList.add('hidden');
  
  // Enable input
  videoUrlInput.removeAttribute('disabled');
  btnPaste.removeAttribute('disabled');
  btnAnalyze.removeAttribute('disabled');
  btnAnalyzeSpinner.classList.add('hidden');
  btnAnalyzeText.textContent = 'Phân tích Link';
  
  checkBackendConnection();
}

function showLoadingState(isLoading) {
  if (isLoading) {
    btnAnalyze.setAttribute('disabled', 'true');
    videoUrlInput.setAttribute('disabled', 'true');
    btnPaste.setAttribute('disabled', 'true');
    btnAnalyzeSpinner.classList.remove('hidden');
    btnAnalyzeText.textContent = 'Đang phân tích...';
  } else {
    btnAnalyzeSpinner.classList.add('hidden');
    btnAnalyzeText.textContent = 'Phân tích Link';
  }
}

function showError(msg) {
  videoInfoCard.classList.add('hidden');
  progressCard.classList.add('hidden');
  successCard.classList.add('hidden');
  errorCard.classList.remove('hidden');
  errorMessage.textContent = msg;
}

// API Call: Fetch Video Info
async function analyzeUrl() {
  const url = videoUrlInput.value.trim();
  if (!url) {
    showError('Vui lòng nhập hoặc dán đường dẫn video.');
    return;
  }

  showLoadingState(true);
  videoInfoCard.classList.add('hidden');
  errorCard.classList.add('hidden');

  try {
    const response = await fetch(`${BACKEND_URL}/api/info`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Lỗi không xác định khi phân tích video.');
    }

    // Success: Populate Card
    currentPlatform = data.platform;
    videoThumbnail.src = data.thumbnail || 'icon.png';
    videoDuration.textContent = data.duration;
    videoTitle.textContent = data.title;
    videoUploader.textContent = `Kênh: ${data.uploader}`;

    // Configure platform badge
    platformBadge.className = `platform-badge ${data.platform}`;
    if (data.platform === 'youtube') {
      platformBadge.textContent = 'YouTube';
    } else if (data.platform === 'tiktok') {
      platformBadge.textContent = 'TikTok';
    } else if (data.platform === 'facebook') {
      platformBadge.textContent = 'Facebook';
    } else if (data.platform === 'twitter') {
      platformBadge.textContent = 'X (Twitter)';
    } else {
      platformBadge.textContent = 'Video';
    }

    // Format selection default handling
    selectFormat.value = 'mp4';
    if (data.platform === 'youtube') {
      resolutionRow.classList.remove('hidden');
    } else {
      resolutionRow.classList.add('hidden');
    }

    // Show Card
    showLoadingState(false);
    videoInfoCard.classList.remove('hidden');
  } catch (err) {
    showLoadingState(false);
    showError(err.message);
  }
}

// API Call: Start Download
async function startDownload() {
  const url = videoUrlInput.value.trim();
  const format = selectFormat.value;
  const resolution = selectResolution.value;

  videoInfoCard.classList.add('hidden');
  progressCard.classList.remove('hidden');
  updateProgress(0, 'downloading', 'Đang yêu cầu tải...', 'Kết nối tới backend server...');

  try {
    const response = await fetch(`${BACKEND_URL}/api/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, format, resolution })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Lỗi không khởi chạy được tiến trình tải.');
    }

    const downloadId = data.downloadId;
    listenToProgress(downloadId);
  } catch (err) {
    progressCard.classList.add('hidden');
    showError(err.message);
  }
}

// SSE Connection: Listen to progress
function listenToProgress(downloadId) {
  if (eventSource) {
    eventSource.close();
  }

  eventSource = new EventSource(`${BACKEND_URL}/api/progress/${downloadId}`);

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      
      updateProgress(data.progress, data.status, getStatusText(data.status), data.message);

      if (data.status === 'completed') {
        eventSource.close();
        eventSource = null;
        
        // Show success card
        setTimeout(() => {
          progressCard.classList.add('hidden');
          successCard.classList.remove('hidden');
          successFilepath.textContent = `Đã lưu vào thư mục Videos/ExtensionVideos/${currentPlatform}/`;
        }, 800);
      } else if (data.status === 'failed') {
        eventSource.close();
        eventSource = null;
        
        setTimeout(() => {
          progressCard.classList.add('hidden');
          showError(data.message || 'Tiến trình tải thất bại.');
        }, 800);
      }
    } catch (err) {
      console.error('Lỗi phân tích gói tin progress:', err);
    }
  };

  eventSource.onerror = (err) => {
    console.error('SSE Error:', err);
    eventSource.close();
    eventSource = null;
    
    progressCard.classList.add('hidden');
    showError('Mất kết nối với backend server trong quá trình tải.');
  };
}

function getStatusText(status) {
  switch (status) {
    case 'starting': return 'Khởi tạo...';
    case 'downloading': return 'Đang tải xuống...';
    case 'merging': return 'Đang ghép file...';
    case 'converting': return 'Đang chuyển đổi...';
    case 'completed': return 'Hoàn thành!';
    case 'failed': return 'Thất bại';
    default: return 'Đang xử lý...';
  }
}

function updateProgress(percent, status, statusText, message) {
  progressStatusText.textContent = statusText;
  progressPercent.textContent = `${Math.round(percent)}%`;
  progressBarFill.style.width = `${percent}%`;
  progressMessage.textContent = message;
}

// API Call: Open download folder
async function openDownloadFolder() {
  try {
    await fetch(`${BACKEND_URL}/api/open-folder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform: currentPlatform })
    });
  } catch (err) {
    console.error('Không thể mở thư mục:', err);
  }
}
