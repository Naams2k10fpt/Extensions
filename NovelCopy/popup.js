// Default settings
const DEFAULT_SETTINGS = {
  imageFormat: 'markdown',
  includeSource: true,
  includeTitle: true,
  cleanText: true,
  ocrEnabled: false
};

// DOM Elements
const imageFormatSelect = document.getElementById('image-format');
const includeSourceCheckbox = document.getElementById('include-source');
const includeTitleCheckbox = document.getElementById('include-title');
const cleanTextCheckbox = document.getElementById('clean-text');
const ocrEnabledCheckbox = document.getElementById('ocr-enabled');
const manualSelectBtn = document.getElementById('manual-select-btn');

// Load settings and history on startup
document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.sync.get(DEFAULT_SETTINGS, (settings) => {
    imageFormatSelect.value = settings.imageFormat;
    includeSourceCheckbox.checked = settings.includeSource;
    includeTitleCheckbox.checked = settings.includeTitle;
    cleanTextCheckbox.checked = settings.cleanText;
    ocrEnabledCheckbox.checked = settings.ocrEnabled;
  });

  loadHistory();
});

// Save settings on changes
imageFormatSelect.addEventListener('change', (e) => {
  chrome.storage.sync.set({ imageFormat: e.target.value });
});

includeSourceCheckbox.addEventListener('change', (e) => {
  chrome.storage.sync.set({ includeSource: e.target.checked });
});

includeTitleCheckbox.addEventListener('change', (e) => {
  chrome.storage.sync.set({ includeTitle: e.target.checked });
});

cleanTextCheckbox.addEventListener('change', (e) => {
  chrome.storage.sync.set({ cleanText: e.target.checked });
});

ocrEnabledCheckbox.addEventListener('change', (e) => {
  chrome.storage.sync.set({ ocrEnabled: e.target.checked });
});

// Trigger manual selection in the active tab
manualSelectBtn.addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      console.error("No active tab found.");
      return;
    }

    // Send message to start manual select
    chrome.tabs.sendMessage(tab.id, { target: "content", action: "start-manual-select" }, (response) => {
      // Check for error (e.g. content script not loaded yet)
      if (chrome.runtime.lastError) {
        alert("Không thể kích hoạt ở trang này. Vui lòng tải lại trang và thử lại!");
        console.error(chrome.runtime.lastError);
      } else {
        // Close popup to let user interact with the page
        window.close();
      }
    });
  } catch (error) {
    console.error("Error initiating manual selection:", error);
  }
});

// Load and render copy history
function loadHistory() {
  const historyList = document.getElementById('history-list');
  if (!historyList) return;

  chrome.storage.local.get({ copyHistory: [] }, (result) => {
    const history = result.copyHistory || [];
    if (history.length === 0) {
      historyList.innerHTML = '<div class="empty-history">Chưa có lịch sử sao chép gần đây.</div>';
      return;
    }

    historyList.innerHTML = '';
    history.forEach(item => {
      const el = document.createElement('div');
      el.className = 'history-item';
      el.innerHTML = `
        <div class="history-info">
          <div class="history-title" title="${item.title}">${item.title}</div>
          <div class="history-meta">
            <span>🕒 ${item.time}</span>
            <span>🔗 <a href="${item.url}" target="_blank" style="color: #818cf8; text-decoration: none; font-weight: 500;">Nguồn</a></span>
          </div>
        </div>
        <button class="history-copy-btn" data-id="${item.id}">📋 Copy lại</button>
      `;

      // Setup copy button click
      const btn = el.querySelector('.history-copy-btn');
      btn.addEventListener('click', () => {
        navigator.clipboard.writeText(item.markdown)
          .then(() => {
            btn.textContent = '✓ Đã copy!';
            btn.classList.add('copied');
            setTimeout(() => {
              btn.textContent = '📋 Copy lại';
              btn.classList.remove('copied');
            }, 1500);
          })
          .catch(err => {
            console.error("Failed to copy back from history:", err);
            alert("Lỗi sao chép! Hãy cấp quyền truy cập clipboard cho extension.");
          });
      });

      historyList.appendChild(el);
    });
  });
}
