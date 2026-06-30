// options.js - Logic hoạt động của trang cài đặt NovelTrans

document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const navButtons = document.querySelectorAll('.nav-btn');
  const tabContents = document.querySelectorAll('.tab-content');
  const toast = document.getElementById('status-toast');

  // API Elements
  const apiKeyInput = document.getElementById('api-key');
  const toggleApiKeyBtn = document.getElementById('toggle-api-key');
  const modelSelect = document.getElementById('model-select');
  const tempInput = document.getElementById('temperature');
  const tempVal = document.getElementById('temp-val');
  const customInstructionInput = document.getElementById('custom-instruction');
  const saveApiBtn = document.getElementById('save-api-btn');

  // Glossary Elements
  const newGlossarySrc = document.getElementById('new-glossary-src');
  const newGlossaryTarget = document.getElementById('new-glossary-target');
  const addGlossaryItemBtn = document.getElementById('add-glossary-item-btn');
  const glossaryTableBody = document.getElementById('glossary-table-body');
  const glossaryEmptyState = document.getElementById('glossary-empty-state');
  const importGlossaryBtn = document.getElementById('import-glossary-btn');
  const exportGlossaryBtn = document.getElementById('export-glossary-btn');
  const glossaryFileInput = document.getElementById('glossary-file-input');

  // Selector Elements
  const newSelectorDomain = document.getElementById('new-selector-domain');
  const newSelectorCss = document.getElementById('new-selector-css');
  const addSelectorBtn = document.getElementById('add-selector-btn');
  const selectorTableBody = document.getElementById('selector-table-body');
  const selectorEmptyState = document.getElementById('selector-empty-state');

  // State
  let globalGlossary = [];
  let customSelectors = [];

  // ================= TAB MANAGEMENT =================
  navButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.getAttribute('data-tab');
      
      // Update active button
      navButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Show/Hide sections
      tabContents.forEach(content => {
        if (content.id === tabId) {
          content.classList.add('active');
        } else {
          content.classList.remove('active');
        }
      });
    });
  });

  // ================= TOAST NOTIFICATION =================
  function showToast(message, isSuccess = true) {
    toast.textContent = message;
    if (isSuccess) {
      toast.style.borderColor = 'var(--success)';
      toast.style.background = 'rgba(16, 185, 129, 0.2)';
      toast.style.color = '#a7f3d0';
    } else {
      toast.style.borderColor = 'var(--danger)';
      toast.style.background = 'rgba(239, 68, 68, 0.2)';
      toast.style.color = '#fca5a5';
    }
    toast.classList.remove('hide');
    setTimeout(() => {
      toast.classList.add('hide');
    }, 2500);
  }

  // ================= LOAD SETTINGS =================
  async function loadSettings() {
    const data = await chrome.storage.local.get({
      apiKey: '',
      model: 'gemini-2.0-flash',
      temperature: 0.3,
      globalGlossary: [],
      customInstruction: '',
      customSelectors: []
    });

    // Populate API Form
    apiKeyInput.value = data.apiKey;
    modelSelect.value = data.model;
    tempInput.value = data.temperature;
    tempVal.textContent = data.temperature;
    customInstructionInput.value = data.customInstruction;

    // Populate Lists
    globalGlossary = data.globalGlossary;
    customSelectors = data.customSelectors;

    renderGlossary();
    renderSelectors();
  }

  // Handle Temp Slider label
  tempInput.addEventListener('input', () => {
    tempVal.textContent = tempInput.value;
  });

  // Toggle API Key visibility
  toggleApiKeyBtn.addEventListener('click', () => {
    const isPassword = apiKeyInput.type === 'password';
    apiKeyInput.type = isPassword ? 'text' : 'password';
    
    // Change Icon SVG
    if (isPassword) {
      toggleApiKeyBtn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
    } else {
      toggleApiKeyBtn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
    }
  });

  // Save API configuration
  saveApiBtn.addEventListener('click', async () => {
    await chrome.storage.local.set({
      apiKey: apiKeyInput.value.trim(),
      model: modelSelect.value,
      temperature: parseFloat(tempInput.value),
      customInstruction: customInstructionInput.value.trim()
    });
    showToast('Đã lưu cấu hình API thành công!');
  });

  // ================= GLOSSARY MANAGEMENT =================
  function renderGlossary() {
    glossaryTableBody.innerHTML = '';
    
    if (globalGlossary.length === 0) {
      glossaryEmptyState.classList.remove('hide');
      return;
    }
    
    glossaryEmptyState.classList.add('hide');
    
    globalGlossary.forEach((item, index) => {
      const tr = document.createElement('tr');
      
      const tdSrc = document.createElement('td');
      tdSrc.textContent = item.src;
      
      const tdTarget = document.createElement('td');
      tdTarget.textContent = item.target;
      
      const tdAction = document.createElement('td');
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'btn-danger-link';
      deleteBtn.textContent = 'Xóa';
      deleteBtn.addEventListener('click', () => deleteGlossaryItem(index));
      
      tdAction.appendChild(deleteBtn);
      
      tr.appendChild(tdSrc);
      tr.appendChild(tdTarget);
      tr.appendChild(tdAction);
      
      glossaryTableBody.appendChild(tr);
    });
  }

  async function deleteGlossaryItem(index) {
    globalGlossary.splice(index, 1);
    await chrome.storage.local.set({ globalGlossary });
    renderGlossary();
    showToast('Đã xóa từ khóa khỏi từ điển.');
  }

  addGlossaryItemBtn.addEventListener('click', async () => {
    const src = newGlossarySrc.value.trim();
    const target = newGlossaryTarget.value.trim();

    if (!src || !target) {
      showToast('Vui lòng nhập đầy đủ từ gốc và nghĩa dịch.', false);
      return;
    }

    // Check if duplicate
    const exists = globalGlossary.some(item => item.src.toLowerCase() === src.toLowerCase());
    if (exists) {
      showToast('Từ khóa này đã tồn tại trong từ điển.', false);
      return;
    }

    globalGlossary.push({ src, target });
    await chrome.storage.local.set({ globalGlossary });
    
    // Clear inputs
    newGlossarySrc.value = '';
    newGlossaryTarget.value = '';
    
    renderGlossary();
    showToast('Đã thêm từ khóa mới.');
  });

  // Import Glossary
  importGlossaryBtn.addEventListener('click', () => {
    glossaryFileInput.click();
  });

  glossaryFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const imported = JSON.parse(event.target.result);
        if (Array.isArray(imported)) {
          // Validate structure
          const validItems = imported.filter(item => item && typeof item.src === 'string' && typeof item.target === 'string');
          
          if (validItems.length > 0) {
            // Merge with existing glossary (avoid duplicates)
            const map = new Map();
            globalGlossary.forEach(item => map.set(item.src.toLowerCase(), item));
            validItems.forEach(item => map.set(item.src.toLowerCase(), item));
            
            globalGlossary = Array.from(map.values());
            await chrome.storage.local.set({ globalGlossary });
            renderGlossary();
            showToast(`Đã nhập thành công ${validItems.length} từ khóa!`);
          } else {
            showToast('File JSON không chứa dữ liệu từ điển hợp lệ.', false);
          }
        } else {
          showToast('Định dạng file phải là mảng dữ liệu JSON.', false);
        }
      } catch (err) {
        showToast('Lỗi khi đọc file JSON.', false);
      }
      // Reset input
      glossaryFileInput.value = '';
    };
    reader.readAsText(file);
  });

  // Export Glossary
  exportGlossaryBtn.addEventListener('click', () => {
    if (globalGlossary.length === 0) {
      showToast('Từ điển trống, không có dữ liệu để xuất.', false);
      return;
    }

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(globalGlossary, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", "noveltrans-glossary.json");
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    showToast('Đã tải xuống file từ điển.');
  });


  // ================= SELECTORS MANAGEMENT =================
  function renderSelectors() {
    selectorTableBody.innerHTML = '';
    
    if (customSelectors.length === 0) {
      selectorEmptyState.classList.remove('hide');
      return;
    }
    
    selectorEmptyState.classList.add('hide');
    
    customSelectors.forEach((item, index) => {
      const tr = document.createElement('tr');
      
      const tdDomain = document.createElement('td');
      tdDomain.textContent = item.domain;
      
      const tdSelector = document.createElement('td');
      const code = document.createElement('code');
      code.textContent = item.selector;
      tdSelector.appendChild(code);
      
      const tdAction = document.createElement('td');
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'btn-danger-link';
      deleteBtn.textContent = 'Xóa';
      deleteBtn.addEventListener('click', () => deleteSelectorItem(index));
      
      tdAction.appendChild(deleteBtn);
      
      tr.appendChild(tdDomain);
      tr.appendChild(tdSelector);
      tr.appendChild(tdAction);
      
      selectorTableBody.appendChild(tr);
    });
  }

  async function deleteSelectorItem(index) {
    customSelectors.splice(index, 1);
    await chrome.storage.local.set({ customSelectors });
    renderSelectors();
    showToast('Đã xóa cấu hình tên miền.');
  }

  addSelectorBtn.addEventListener('click', async () => {
    const domain = newSelectorDomain.value.trim().toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, '');
    const selector = newSelectorCss.value.trim();

    if (!domain || !selector) {
      showToast('Vui lòng nhập đầy đủ tên miền và selector CSS.', false);
      return;
    }

    // Check if domain exists
    const existsIndex = customSelectors.findIndex(item => item.domain === domain);
    if (existsIndex > -1) {
      // Overwrite
      customSelectors[existsIndex].selector = selector;
    } else {
      customSelectors.push({ domain, selector });
    }

    await chrome.storage.local.set({ customSelectors });
    
    // Clear inputs
    newSelectorDomain.value = '';
    newSelectorCss.value = '';
    
    renderSelectors();
    showToast('Đã cập nhật CSS Selector cho tên miền.');
  });

  // Init
  loadSettings();
});
