const BACKEND_URL = window.location.origin; // Dynamically use the current host (http://localhost:4000)
let currentPlatform = 'other';
let eventSource = null;
let selectedFile = null;
let isConvertMode = false;

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
const videoTitleInput = document.getElementById('video-title-input');
const videoUploader = document.getElementById('video-uploader');

const selectFormat = document.getElementById('select-format');
const selectResolution = document.getElementById('select-resolution');
const resolutionRow = document.getElementById('resolution-row');
const btnDownload = document.getElementById('btn-download');

// Tabs DOM Elements
const tabDownload = document.getElementById('tab-download');
const tabConvert = document.getElementById('tab-convert');
const downloaderTabContent = document.getElementById('downloader-tab-content');
const converterTabContent = document.getElementById('converter-tab-content');

// Converter DOM Elements
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');
const btnBrowseFile = document.getElementById('btn-browse-file');
const convertOptionsCard = document.getElementById('convert-options-card');
const convertTitleInput = document.getElementById('convert-title-input');
const selectedFileSize = document.getElementById('selected-file-size');
const convertSelectFormat = document.getElementById('convert-select-format');
const btnStartConvert = document.getElementById('btn-start-convert');

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
  // Tab selection
  tabDownload.addEventListener('click', () => {
    tabDownload.classList.add('active');
    tabConvert.classList.remove('active');
    downloaderTabContent.classList.remove('hidden');
    converterTabContent.classList.add('hidden');
    isConvertMode = false;
    showInputSection();
  });

  tabConvert.addEventListener('click', () => {
    tabConvert.classList.add('active');
    tabDownload.classList.remove('active');
    converterTabContent.classList.remove('hidden');
    downloaderTabContent.classList.add('hidden');
    isConvertMode = true;
    showInputSection();
  });

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
    if (selectFormat.value === 'mp3' || selectFormat.value === 'ogg' || selectFormat.value === 'gif' || currentPlatform !== 'youtube') {
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

  // Converter Drag and Drop Events
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('dragover');
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer.files.length) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  });

  btnBrowseFile.addEventListener('click', () => {
    fileInput.click();
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length) {
      handleFileSelect(e.target.files[0]);
    }
  });

  // Start conversion button click
  btnStartConvert.addEventListener('click', startConversion);
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
  console.error('[App Error]', msg);
  videoInfoCard.classList.add('hidden');
  progressCard.classList.add('hidden');
  successCard.classList.add('hidden');
  errorCard.classList.remove('hidden');
  
  const errElement = document.getElementById('error-message');
  if (errElement) {
    errElement.textContent = msg || 'Lỗi không xác định.';
  }
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
    videoTitleInput.value = data.title;
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

  const customFilename = videoTitleInput.value.trim();

  videoInfoCard.classList.add('hidden');
  progressCard.classList.remove('hidden');
  updateProgress(0, 'downloading', 'Đang yêu cầu tải...', 'Kết nối tới backend server...');

  try {
    const response = await fetch(`${BACKEND_URL}/api/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, format, resolution, customFilename })
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
          if (isConvertMode) {
            successFilepath.textContent = `Đã lưu vào thư mục Music/audio/`;
          } else {
            successFilepath.textContent = `Đã lưu vào thư mục Videos/ExtensionVideos/${currentPlatform}/`;
          }
        }, 800);
      } else if (data.status === 'failed') {
        eventSource.close();
        eventSource = null;
        
        setTimeout(() => {
          progressCard.classList.add('hidden');
          showError(data.message || 'Tiến trình thất bại.');
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
    showError('Mất kết nối với backend server trong quá trình xử lý.');
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
    const targetPlatform = isConvertMode ? 'audio' : currentPlatform;
    await fetch(`${BACKEND_URL}/api/open-folder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform: targetPlatform })
    });
  } catch (err) {
    console.error('Không thể mở thư mục:', err);
  }
}

// Converter functions
function handleFileSelect(file) {
  if (!file) return;
  selectedFile = file;
  
  // Get filename without extension
  const fileNameWithoutExt = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
  convertTitleInput.value = fileNameWithoutExt;
  
  // Format file size
  const sizeInMB = (file.size / (1024 * 1024)).toFixed(1);
  selectedFileSize.textContent = `Kích thước: ${sizeInMB} MB`;
  
  // Show options card
  convertOptionsCard.classList.remove('hidden');
}

function startConversion() {
  if (!selectedFile) {
    showError('Vui lòng chọn tệp video trước.');
    return;
  }

  const format = convertSelectFormat.value;
  const filename = convertTitleInput.value.trim() || 'audio_converted';

  converterTabContent.classList.add('hidden');
  progressCard.classList.remove('hidden');
  updateProgress(0, 'downloading', 'Đang tải tệp lên...', 'Bắt đầu truyền file tới backend...');

  const xhr = new XMLHttpRequest();
  xhr.open('POST', `${BACKEND_URL}/api/convert?format=${encodeURIComponent(format)}&filename=${encodeURIComponent(filename)}`);

  xhr.upload.onprogress = (e) => {
    if (e.lengthComputable) {
      // Scale upload progress to 0-80% to leave room for backend conversion phase
      const percent = (e.loaded / e.total) * 80;
      updateProgress(percent, 'downloading', 'Đang tải tệp lên...', `Đã tải lên: ${percent.toFixed(1)}%`);
    }
  };

  xhr.onload = () => {
    if (xhr.status >= 200 && xhr.status < 300) {
      try {
        const res = JSON.parse(xhr.responseText);
        const downloadId = res.downloadId;
        // Listen to conversion progress from SSE
        listenToProgress(downloadId);
      } catch (err) {
        progressCard.classList.add('hidden');
        showError('Phản hồi không hợp lệ từ máy chủ.');
      }
    } else {
      try {
        const res = JSON.parse(xhr.responseText);
        progressCard.classList.add('hidden');
        showError(res.error || 'Lỗi xảy ra trong quá trình chuyển đổi.');
      } catch (err) {
        progressCard.classList.add('hidden');
        showError('Máy chủ trả về lỗi không xác định.');
      }
    }
  };

  xhr.onerror = () => {
    progressCard.classList.add('hidden');
    showError('Lỗi kết nối mạng khi gửi tệp.');
  };

  xhr.send(selectedFile);
}
