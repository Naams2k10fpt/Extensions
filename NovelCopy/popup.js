// Default settings
const DEFAULT_SETTINGS = {
  imageFormat: 'markdown',
  includeSource: true,
  includeTitle: true,
  cleanText: true
};

// DOM Elements
const imageFormatSelect = document.getElementById('image-format');
const includeSourceCheckbox = document.getElementById('include-source');
const includeTitleCheckbox = document.getElementById('include-title');
const cleanTextCheckbox = document.getElementById('clean-text');
const manualSelectBtn = document.getElementById('manual-select-btn');

// Load settings on startup
document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.sync.get(DEFAULT_SETTINGS, (settings) => {
    imageFormatSelect.value = settings.imageFormat;
    includeSourceCheckbox.checked = settings.includeSource;
    includeTitleCheckbox.checked = settings.includeTitle;
    cleanTextCheckbox.checked = settings.cleanText;
  });
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

// Trigger manual selection in the active tab
manualSelectBtn.addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      console.error("No active tab found.");
      return;
    }
    
    // Send message to start manual select
    chrome.tabs.sendMessage(tab.id, { action: "start-manual-select" }, (response) => {
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
