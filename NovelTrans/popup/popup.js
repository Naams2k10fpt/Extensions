// popup.js - Logic điều khiển menu nhanh của NovelTrans

document.addEventListener('DOMContentLoaded', async () => {
  const apiStatus = document.getElementById('api-status');
  const currentDomainSpan = document.getElementById('current-domain');
  const toggleSiteBtn = document.getElementById('toggle-site-btn');
  const openSettingsBtn = document.getElementById('open-settings-btn');

  let currentDomain = '';

  // 1. Lấy thông tin tab hiện tại
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  if (activeTab && activeTab.url) {
    try {
      const url = new URL(activeTab.url);
      currentDomain = url.hostname.replace('www.', '');
      currentDomainSpan.textContent = currentDomain;
    } catch (e) {
      currentDomainSpan.textContent = 'Không khả dụng';
      toggleSiteBtn.disabled = true;
    }
  } else {
    currentDomainSpan.textContent = 'Không khả dụng';
    toggleSiteBtn.disabled = true;
  }

  // 2. Kiểm tra cấu hình API Key
  const settings = await chrome.storage.local.get({
    apiKey: '',
    disabledDomains: []
  });

  if (settings.apiKey) {
    apiStatus.textContent = 'Đã cấu hình';
    apiStatus.className = 'status-badge configured';
  } else {
    apiStatus.textContent = 'Chưa cấu hình';
    apiStatus.className = 'status-badge missing';
  }

  // 3. Trạng thái hoạt động tại trang hiện tại
  let isDisabled = settings.disabledDomains.includes(currentDomain);
  
  function updateButtonState() {
    if (isDisabled) {
      toggleSiteBtn.textContent = 'Đã tắt tại trang này';
      toggleSiteBtn.className = 'btn btn-secondary flex-1';
    } else {
      toggleSiteBtn.textContent = 'Đang hoạt động';
      toggleSiteBtn.className = 'btn btn-secondary active flex-1';
    }
  }

  if (currentDomain) {
    updateButtonState();

    toggleSiteBtn.addEventListener('click', async () => {
      let { disabledDomains } = await chrome.storage.local.get({ disabledDomains: [] });
      
      if (isDisabled) {
        // Kích hoạt lại
        disabledDomains = disabledDomains.filter(d => d !== currentDomain);
        isDisabled = false;
      } else {
        // Tắt đi
        disabledDomains.push(currentDomain);
        isDisabled = true;
      }

      await chrome.storage.local.set({ disabledDomains });
      updateButtonState();

      // Gửi thông báo tải lại trang hoặc cập nhật giao diện trong content script
      if (activeTab && activeTab.id) {
        chrome.tabs.sendMessage(activeTab.id, { action: 'toggleSiteActive', disabled: isDisabled });
      }
    });
  }

  // 4. Mở trang cài đặt chi tiết
  openSettingsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
});
