// content.js - Tệp script chèn trực tiếp vào trang truyện để phân tích và hiển thị giao diện dịch

(async function () {
  const domain = window.location.hostname.replace('www.', '');

  // 1. Kiểm tra xem tên miền có nằm trong danh sách tạm dừng hoạt động không
  const settings = await chrome.storage.local.get({ disabledDomains: [] });
  if (settings.disabledDomains.includes(domain)) {
    console.log('[NovelTrans] Tạm dừng hoạt động tại tên miền:', domain);
    return;
  }

  // Khai báo State
  let novelContainer = null;
  let paragraphs = [];
  let currentBatchIndex = 0;
  const batchSize = 7;
  let isTranslating = false;
  let displayMode = 'bilingual'; // 'bilingual' | 'translation-only' | 'original'
  let pageGlossaryList = [];

  // DOM Elements
  let floatingWidget = null;
  let progressBarFill = null;
  let progressText = null;
  let statusText = null;
  let translateBtn = null;
  let modeToggleBtn = null;
  let glossaryModal = null;

  // Trạng thái của chức năng Picker Selector thủ công
  let isPickerActive = false;

  // Lắng nghe thay đổi trạng thái hoạt động từ Menu Popup nhanh
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'toggleSiteActive') {
      showOnPageToast('Cấu hình đã thay đổi. Đang tải lại trang...');
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    }
  });

  // Khởi động
  init();

  async function init() {
    // Tải cấu hình từ điển cho trang web hiện tại
    const glossaryData = await chrome.storage.local.get({ pageGlossaries: {} });
    pageGlossaryList = glossaryData.pageGlossaries[domain] || [];

    // Chèn Widget điều khiển nổi
    injectFloatingWidget();

    // Dò tìm container chứa nội dung tiểu thuyết
    detectNovelContent();
  }

  // ================= 2. BỘ DÒ TÌM NỘI DUNG TRUYỆN (HEURISTICS) =================
  async function detectNovelContent() {
    const { customSelectors } = await chrome.storage.local.get({ customSelectors: [] });
    const custom = customSelectors.find(item => item.domain === domain);
    
    if (custom && custom.selector) {
      novelContainer = document.querySelector(custom.selector);
    }

    if (!novelContainer) {
      novelContainer = findNovelContainerHeuristics();
    }

    if (novelContainer) {
      // Gán class để kiểm soát hiển thị
      novelContainer.classList.add('nt-content-container');
      
      // Trích xuất các đoạn văn bản
      paragraphs = Array.from(novelContainer.querySelectorAll(':scope > p'));
      if (paragraphs.length < 3) {
        paragraphs = Array.from(novelContainer.querySelectorAll('p'));
      }
      
      // Lọc bỏ đoạn văn trống hoặc quá ngắn (ví dụ: quảng cáo, link điều hướng)
      paragraphs = paragraphs.filter(p => p.textContent.trim().length > 4);

      // Đánh dấu ID cho từng đoạn
      paragraphs.forEach((p, idx) => {
        p.setAttribute('data-nt-para-id', idx);
      });

      updateStatus(`Đã tìm thấy ${paragraphs.length} đoạn văn.`);
      translateBtn.disabled = false;
    } else {
      updateStatus('Không tìm thấy nội dung truyện. Hãy tự chọn Selector.');
      translateBtn.disabled = true;
    }
  }

  function findNovelContainerHeuristics() {
    const candidates = [];
    const elements = document.querySelectorAll('div, article, section, main, [id*="content"], [class*="content"], [id*="chapter"], [class*="chapter"]');
    
    elements.forEach(el => {
      const tagName = el.tagName.toLowerCase();
      if (['script', 'style', 'nav', 'footer', 'header', 'noscript', 'aside', 'iframe'].includes(tagName)) return;
      
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      
      // Lấy các thẻ p con trực tiếp
      const pTags = el.querySelectorAll(':scope > p');
      if (pTags.length >= 4) {
        let textLength = 0;
        pTags.forEach(p => textLength += p.textContent.trim().length);
        
        // Trọng số tính điểm = số thẻ p * 30 + tổng ký tự
        const score = pTags.length * 30 + textLength;
        candidates.push({ el, score });
      }
    });

    if (candidates.length > 0) {
      // Sắp xếp tìm vùng có điểm cao nhất
      candidates.sort((a, b) => b.score - a.score);
      return candidates[0].el;
    }

    // Dự phòng 2: Tìm phần tử cha chứa nhiều thẻ p nhất trên trang
    const allP = document.querySelectorAll('p');
    if (allP.length > 10) {
      const parents = new Map();
      allP.forEach(p => {
        const parent = p.parentElement;
        if (parent && !['body', 'html'].includes(parent.tagName.toLowerCase())) {
          parents.set(parent, (parents.get(parent) || 0) + 1);
        }
      });
      
      let bestParent = null;
      let maxPCount = 0;
      for (const [parent, count] of parents.entries()) {
        if (count > maxPCount) {
          maxPCount = count;
          bestParent = parent;
        }
      }
      if (maxPCount >= 5) {
        return bestParent;
      }
    }
    return null;
  }

  // ================= 3. WIDGET NỔI ĐIỀU KHIỂN =================
  function injectFloatingWidget() {
    floatingWidget = document.createElement('div');
    floatingWidget.id = 'nt-floating-widget';

    floatingWidget.innerHTML = `
      <div class="nt-drag-handle">
        <div class="nt-brand">
          <div class="nt-logo">NT</div>
          <span>NovelTrans</span>
        </div>
        <div class="nt-drag-dots">
          <span></span><span></span><span></span>
        </div>
      </div>
      <div class="nt-widget-body">
        <div class="nt-progress-container">
          <div class="nt-progress-text-row">
            <span id="nt-progress-label">Tiến trình</span>
            <span id="nt-progress-text">0 / 0 (0%)</span>
          </div>
          <div class="nt-progress-bar-bg">
            <div id="nt-progress-bar-fill" class="nt-progress-bar-fill"></div>
          </div>
        </div>
        <div id="nt-status-text" class="nt-status-info">Đang khởi tạo...</div>
        <div class="nt-actions-grid">
          <button id="nt-translate-btn" class="nt-btn nt-btn-primary" disabled>Dịch trang</button>
          <button id="nt-mode-toggle-btn" class="nt-btn">Song ngữ</button>
          <button id="nt-glossary-btn" class="nt-btn">Từ điển</button>
          <button id="nt-picker-btn" class="nt-btn" style="grid-column: span 2;">Chọn vùng truyện thủ công</button>
        </div>
      </div>
    `;

    document.body.appendChild(floatingWidget);

    // Gán biến điều khiển
    progressBarFill = document.getElementById('nt-progress-bar-fill');
    progressText = document.getElementById('nt-progress-text');
    statusText = document.getElementById('nt-status-text');
    translateBtn = document.getElementById('nt-translate-btn');
    modeToggleBtn = document.getElementById('nt-mode-toggle-btn');
    const glossaryBtn = document.getElementById('nt-glossary-btn');
    const pickerBtn = document.getElementById('nt-picker-btn');

    // Drag and Drop logic
    makeWidgetDraggable(floatingWidget);

    // Event listeners
    translateBtn.addEventListener('click', toggleTranslationMode);
    modeToggleBtn.addEventListener('click', toggleDisplayMode);
    glossaryBtn.addEventListener('click', openGlossaryModal);
    pickerBtn.addEventListener('click', toggleSelectorPicker);
  }

  function makeWidgetDraggable(element) {
    const dragHandle = element.querySelector('.nt-drag-handle');
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;

    dragHandle.onmousedown = dragMouseDown;

    function dragMouseDown(e) {
      e = e || window.event;
      e.preventDefault();
      pos3 = e.clientX;
      pos4 = e.clientY;
      document.onmouseup = closeDragElement;
      document.onmousemove = elementDrag;
    }

    function elementDrag(e) {
      e = e || window.event;
      e.preventDefault();
      pos1 = pos3 - e.clientX;
      pos2 = pos4 - e.clientY;
      pos3 = e.clientX;
      pos4 = e.clientY;
      element.style.top = (element.offsetTop - pos2) + "px";
      element.style.left = (element.offsetLeft - pos1) + "px";
      element.style.bottom = "auto";
      element.style.right = "auto";
    }

    function closeDragElement() {
      document.onmouseup = null;
      document.onmousemove = null;
    }
  }

  function updateStatus(text) {
    if (statusText) statusText.textContent = text;
  }

  // ================= 4. QUẢN LÝ DỊCH THUẬT THEO CỤM (BATCH TRANSLATION) =================
  async function toggleTranslationMode() {
    if (isTranslating) {
      // Pause
      isTranslating = false;
      translateBtn.textContent = 'Tiếp tục dịch';
      updateStatus('Tạm dừng dịch.');
    } else {
      // Start/Resume
      isTranslating = true;
      translateBtn.textContent = 'Tạm dừng';
      updateStatus('Đang gọi API dịch thuật...');
      translateLoop();
    }
  }

  async function translateLoop() {
    while (isTranslating && currentBatchIndex < paragraphs.length) {
      const endIdx = Math.min(currentBatchIndex + batchSize, paragraphs.length);
      const batch = paragraphs.slice(currentBatchIndex, endIdx);
      
      const textList = batch.map(p => p.textContent.trim());

      // Lấy ngữ cảnh trượt (3 đoạn trước đó)
      const contextBefore = paragraphs
        .slice(Math.max(0, currentBatchIndex - 3), currentBatchIndex)
        .map(p => p.textContent.trim());

      updateStatus(`Đang dịch đoạn ${currentBatchIndex + 1} - ${endIdx}...`);

      try {
        const response = await sendTranslationRequest({
          textList,
          contextBefore,
          pageGlossary: pageGlossaryList
        });

        if (response.success && Array.isArray(response.translations)) {
          // Chèn nội dung dịch vào DOM
          batch.forEach((p, idx) => {
            const translatedText = response.translations[idx];
            insertTranslationDOM(p, translatedText);
          });

          currentBatchIndex = endIdx;
          updateProgressBar();
        } else {
          throw new Error(response.error || 'API trả về phản hồi không thành công.');
        }
      } catch (err) {
        console.error('[NovelTrans] Lỗi vòng dịch:', err);
        isTranslating = false;
        translateBtn.textContent = 'Thử lại';
        updateStatus(`Lỗi: ${err.message}`);
        break;
      }
    }

    if (currentBatchIndex >= paragraphs.length) {
      isTranslating = false;
      translateBtn.textContent = 'Hoàn thành';
      translateBtn.disabled = true;
      updateStatus('Bản dịch chương truyện hoàn tất!');
    }
  }

  function sendTranslationRequest(data) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'translate', data }, (res) => {
        resolve(res || { success: false, error: 'Không nhận được phản hồi từ background.' });
      });
    });
  }

  function insertTranslationDOM(originalElement, translatedText) {
    const paraId = originalElement.getAttribute('data-nt-para-id');
    
    // Check if translation element already exists (e.g. re-translating)
    let transDiv = novelContainer.querySelector(`.nt-translation-text[data-nt-ref-id="${paraId}"]`);
    
    if (!transDiv) {
      transDiv = document.createElement('div');
      transDiv.className = 'nt-translation-text';
      transDiv.setAttribute('data-nt-ref-id', paraId);
      originalElement.after(transDiv);
    }
    
    transDiv.textContent = translatedText;

    // Apply current display mode styling
    applyElementDisplayMode(originalElement, transDiv);
  }

  function updateProgressBar() {
    const total = paragraphs.length;
    const progress = currentBatchIndex;
    const percent = total > 0 ? Math.round((progress / total) * 100) : 0;

    progressBarFill.style.width = `${percent}%`;
    progressText.textContent = `${progress} / ${total} (${percent}%)`;
  }

  // ================= 5. CHẾ ĐỘ HIỂN THỊ SONG NGỮ / BẢN DỊCH =================
  function toggleDisplayMode() {
    if (displayMode === 'bilingual') {
      displayMode = 'translation-only';
      modeToggleBtn.textContent = 'Chỉ dịch';
      novelContainer.classList.add('nt-hide-original');
      novelContainer.classList.remove('nt-hide-translation');
    } else if (displayMode === 'translation-only') {
      displayMode = 'original';
      modeToggleBtn.textContent = 'Bản gốc';
      novelContainer.classList.remove('nt-hide-original');
      novelContainer.classList.add('nt-hide-translation');
    } else {
      displayMode = 'bilingual';
      modeToggleBtn.textContent = 'Song ngữ';
      novelContainer.classList.remove('nt-hide-original');
      novelContainer.classList.remove('nt-hide-translation');
    }

    // Re-apply to all currently translated elements
    paragraphs.forEach(p => {
      const paraId = p.getAttribute('data-nt-para-id');
      const transDiv = novelContainer.querySelector(`.nt-translation-text[data-nt-ref-id="${paraId}"]`);
      if (transDiv) {
        applyElementDisplayMode(p, transDiv);
      }
    });
  }

  function applyElementDisplayMode(originalElement, transElement) {
    if (displayMode === 'bilingual') {
      originalElement.style.display = '';
      transElement.style.display = '';
    } else if (displayMode === 'translation-only') {
      originalElement.style.display = 'none';
      transElement.style.display = '';
    } else if (displayMode === 'original') {
      originalElement.style.display = '';
      transElement.style.display = 'none';
    }
  }

  // ================= 6. BẢNG TỪ ĐIỂN TẠI TRANG (GLOSSARY MODAL) =================
  function openGlossaryModal() {
    // Check if modal exists
    if (glossaryModal) {
      glossaryModal.style.display = 'flex';
      renderModalGlossaryItems();
      return;
    }

    glossaryModal = document.createElement('div');
    glossaryModal.className = 'nt-modal-overlay';
    
    glossaryModal.innerHTML = `
      <div class="nt-modal">
        <div class="nt-modal-header">
          <h3>Từ điển cho trang này</h3>
          <button class="nt-modal-close">&times;</button>
        </div>
        <div class="nt-modal-body">
          <div class="nt-glossary-inputs">
            <input type="text" id="nt-new-src" class="nt-input" placeholder="Từ gốc (Harry)">
            <input type="text" id="nt-new-target" class="nt-input" placeholder="Dịch nghĩa (Hải Đăng)">
            <button id="nt-add-item-btn" class="nt-btn nt-btn-primary" style="margin: 0; width: 60px;">Thêm</button>
          </div>
          <div class="nt-glossary-list" id="nt-modal-list-body">
            <!-- Items list -->
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(glossaryModal);

    // Event listeners
    glossaryModal.querySelector('.nt-modal-close').addEventListener('click', () => {
      glossaryModal.style.display = 'none';
    });

    glossaryModal.addEventListener('click', (e) => {
      if (e.target === glossaryModal) {
        glossaryModal.style.display = 'none';
      }
    });

    document.getElementById('nt-add-item-btn').addEventListener('click', addPageGlossaryItem);

    renderModalGlossaryItems();
  }

  function renderModalGlossaryItems() {
    const listBody = document.getElementById('nt-modal-list-body');
    listBody.innerHTML = '';

    if (pageGlossaryList.length === 0) {
      listBody.innerHTML = '<div class="nt-glossary-empty">Từ điển trống. Hãy nhập từ khóa đầu tiên!</div>';
      return;
    }

    pageGlossaryList.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'nt-glossary-row';
      row.innerHTML = `
        <div>
          <strong>${item.src}</strong>
          <span>&rarr;</span>
          <strong>${item.target}</strong>
        </div>
        <button class="nt-btn-delete nt-btn-danger-link" style="color: #ef4444; border:none; background:none; cursor:pointer; font-size:12px;" data-index="${index}">Xóa</button>
      `;

      row.querySelector('.nt-btn-delete').addEventListener('click', () => deletePageGlossaryItem(index));
      listBody.appendChild(row);
    });
  }

  async function addPageGlossaryItem() {
    const srcInput = document.getElementById('nt-new-src');
    const targetInput = document.getElementById('nt-new-target');
    
    const src = srcInput.value.trim();
    const target = targetInput.value.trim();

    if (!src || !target) return;

    // Tránh trùng lặp
    if (pageGlossaryList.some(item => item.src.toLowerCase() === src.toLowerCase())) {
      showOnPageToast('Từ này đã có trong từ điển.');
      return;
    }

    pageGlossaryList.push({ src, target });

    // Lưu vào chrome storage
    const storageData = await chrome.storage.local.get({ pageGlossaries: {} });
    storageData.pageGlossaries[domain] = pageGlossaryList;
    await chrome.storage.local.set({ pageGlossaries: storageData.pageGlossaries });

    srcInput.value = '';
    targetInput.value = '';

    renderModalGlossaryItems();
    showOnPageToast('Đã cập nhật từ điển trang này.');

    // Hỏi có muốn dịch lại các cụm đã đi qua không
    if (currentBatchIndex > 0) {
      updateStatus('Hãy dịch lại từ đầu để áp dụng từ điển mới.');
    }
  }

  async function deletePageGlossaryItem(index) {
    pageGlossaryList.splice(index, 1);

    const storageData = await chrome.storage.local.get({ pageGlossaries: {} });
    storageData.pageGlossaries[domain] = pageGlossaryList;
    await chrome.storage.local.set({ pageGlossaries: storageData.pageGlossaries });

    renderModalGlossaryItems();
    showOnPageToast('Đã xóa thuật ngữ.');
  }

  // ================= 7. CHỌN SELECTOR THỦ CÔNG (VISUAL PICKER) =================
  function toggleSelectorPicker() {
    if (isPickerActive) {
      stopSelectorPicker();
    } else {
      startSelectorPicker();
    }
  }

  function startSelectorPicker() {
    isPickerActive = true;
    floatingWidget.style.display = 'none'; // Tạm ẩn widget để dễ thao tác
    showOnPageToast('Bật chế độ chọn vùng. Di chuột và click vào khu vực thân bài viết truyện.');

    // Tạo viền highlight khi hover
    document.addEventListener('mouseover', onPickerMouseOver);
    document.addEventListener('mouseout', onPickerMouseOut);
    document.addEventListener('click', onPickerClick, true); // Dùng capture phase để chặn click gốc
  }

  function stopSelectorPicker() {
    isPickerActive = false;
    floatingWidget.style.display = 'block';

    document.removeEventListener('mouseover', onPickerMouseOver);
    document.removeEventListener('mouseout', onPickerMouseOut);
    document.removeEventListener('click', onPickerClick, true);
  }

  function onPickerMouseOver(e) {
    e.target.style.outline = '2px dashed #7c3aed';
    e.target.style.cursor = 'pointer';
  }

  function onPickerMouseOut(e) {
    e.target.style.outline = '';
    e.target.style.cursor = '';
  }

  async function onPickerClick(e) {
    e.preventDefault();
    e.stopPropagation();

    const clickedEl = e.target;
    clickedEl.style.outline = '';
    clickedEl.style.cursor = '';

    stopSelectorPicker();

    // Tạo selector CSS duy nhất cho element này
    const computedSelector = generateUniqueCSSSelector(clickedEl);
    
    if (computedSelector) {
      // Lưu cấu hình selector mới cho domain
      const { customSelectors } = await chrome.storage.local.get({ customSelectors: [] });
      
      const existsIndex = customSelectors.findIndex(item => item.domain === domain);
      if (existsIndex > -1) {
        customSelectors[existsIndex].selector = computedSelector;
      } else {
        customSelectors.push({ domain, selector: computedSelector });
      }

      await chrome.storage.local.set({ customSelectors });
      showOnPageToast('Đã cấu hình CSS Selector mới!');

      // Reset và tải lại truyện
      resetTranslationState();
      detectNovelContent();
    }
  }

  function generateUniqueCSSSelector(el) {
    if (el.id) {
      return `#${el.id}`;
    }
    
    let path = [];
    while (el && el.nodeType === Node.ELEMENT_NODE) {
      let selector = el.nodeName.toLowerCase();
      
      if (el.id) {
        selector += `#${el.id}`;
        path.unshift(selector);
        break;
      } else {
        // Lấy class đầu tiên làm điểm phân biệt nếu có
        if (el.className && typeof el.className === 'string') {
          const firstClass = el.className.trim().split(/\s+/)[0];
          if (firstClass && !firstClass.startsWith('nt-')) {
            selector += `.${firstClass}`;
          }
        }
      }
      
      path.unshift(selector);
      el = el.parentElement;
    }
    return path.join(' > ');
  }

  function resetTranslationState() {
    // Xóa tất cả các đoạn dịch hiện tại
    const transDivs = novelContainer.querySelectorAll('.nt-translation-text');
    transDivs.forEach(div => div.remove());

    // Reset variables
    currentBatchIndex = 0;
    isTranslating = false;
    translateBtn.textContent = 'Dịch trang';
    translateBtn.disabled = false;
    updateProgressBar();
  }

  // ================= 8. TIỆN ÍCH PHỤ TRỢ =================
  function showOnPageToast(message) {
    const toast = document.createElement('div');
    toast.className = 'nt-toast';
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.remove();
    }, 2500);
  }
})();
