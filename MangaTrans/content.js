(function () {
  // Tránh khai báo lại các biến toàn cục nếu file này bị injected nhiều lần
  if (window.MangaTranslatorInjected) {
    return;
  }
  window.MangaTranslatorInjected = true;

  // Lắng nghe tin nhắn từ background script
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "start-capture") {
      activateCaptureMode();
      sendResponse({ status: "activated" });
    }
  });

  // Kích hoạt chế độ chụp màn hình kéo thả vùng chọn
  function activateCaptureMode() {
    // Nếu đã có lớp phủ rồi thì không tạo thêm
    if (document.querySelector(".manga-trans-screen-overlay")) {
      return;
    }

    const overlay = document.createElement("div");
    overlay.className = "manga-trans-screen-overlay";

    // Thanh hướng dẫn ở trên cùng
    const instruction = document.createElement("div");
    instruction.className = "manga-trans-instruction";
    instruction.innerHTML = `
      <span>Kéo thả chuột để khoanh vùng Manga cần dịch</span>
      <span class="manga-trans-instruction-key">ESC</span>
      <span>để hủy</span>
    `;
    overlay.appendChild(instruction);

    // Hộp hiển thị vùng chọn trong quá trình kéo
    const selectorBox = document.createElement("div");
    selectorBox.className = "manga-trans-selector-box";
    selectorBox.style.display = "none";
    overlay.appendChild(selectorBox);

    // Nhãn kích thước
    const sizeBadge = document.createElement("div");
    sizeBadge.className = "manga-trans-size-badge";
    selectorBox.appendChild(sizeBadge);

    let startX = 0;
    let startY = 0;
    let isDrawing = false;

    // Sự kiện mousedown
    overlay.addEventListener("mousedown", (e) => {
      // Chỉ vẽ bằng chuột trái
      if (e.button !== 0) return;
      isDrawing = true;
      startX = e.clientX;
      startY = e.clientY;

      selectorBox.style.left = startX + "px";
      selectorBox.style.top = startY + "px";
      selectorBox.style.width = "0px";
      selectorBox.style.height = "0px";
      selectorBox.style.display = "block";
    });

    // Sự kiện mousemove
    overlay.addEventListener("mousemove", (e) => {
      if (!isDrawing) return;

      const currentX = e.clientX;
      const currentY = e.clientY;

      const x = Math.min(startX, currentX);
      const y = Math.min(startY, currentY);
      const w = Math.abs(startX - currentX);
      const h = Math.abs(startY - currentY);

      selectorBox.style.left = x + "px";
      selectorBox.style.top = y + "px";
      selectorBox.style.width = w + "px";
      selectorBox.style.height = h + "px";

      sizeBadge.textContent = `${w} x ${h}px`;
    });

    // Sự kiện mouseup
    overlay.addEventListener("mouseup", (e) => {
      if (!isDrawing) return;
      isDrawing = false;

      const endX = e.clientX;
      const endY = e.clientY;

      const x = Math.min(startX, endX);
      const y = Math.min(startY, endY);
      const w = Math.abs(startX - endX);
      const h = Math.abs(startY - endY);

      // Gỡ bỏ lớp phủ vẽ chọn vùng ngay lập tức
      overlay.remove();
      document.removeEventListener("keydown", handleEscKey);

      // Nếu vùng chọn quá nhỏ, hủy bỏ
      if (w < 15 || h < 15) {
        return;
      }

      // Bắt đầu quá trình dịch
      processTranslation(x, y, w, h);
    });

    // Sự kiện ESC để hủy
    function handleEscKey(e) {
      if (e.key === "Escape") {
        overlay.remove();
        document.removeEventListener("keydown", handleEscKey);
      }
    }
    document.addEventListener("keydown", handleEscKey);

    // Gắn lớp phủ vào body
    document.body.appendChild(overlay);
  }

  // Quá trình chụp màn hình, cắt ảnh, gọi API dịch và vẽ kết quả
  function processTranslation(x, y, w, h) {
    const dpr = window.devicePixelRatio || 1;
    
    // Tạo container kết quả dịch nổi trên trang web (đặt tọa độ tuyệt đối theo trang)
    const resultContainer = document.createElement("div");
    resultContainer.className = "manga-trans-result-container";
    resultContainer.style.left = (window.scrollX + x) + "px";
    resultContainer.style.top = (window.scrollY + y) + "px";
    resultContainer.style.width = w + "px";
    resultContainer.style.height = h + "px";

    // Lớp phủ loading bên trong vùng được chọn
    const loadingOverlay = document.createElement("div");
    loadingOverlay.className = "manga-trans-loading-overlay";
    loadingOverlay.innerHTML = `
      <div class="manga-trans-spinner"></div>
      <div>AI đang dịch...</div>
    `;
    resultContainer.appendChild(loadingOverlay);
    document.body.appendChild(resultContainer);

    // Gửi yêu cầu chụp màn hình đến background.js
    chrome.runtime.sendMessage({ action: "capture-tab" }, (response) => {
      if (!response || !response.success) {
        showError(resultContainer, response?.error || "Không thể chụp màn hình tab hiện tại.");
        return;
      }

      const img = new Image();
      img.src = response.dataUrl;
      img.onload = () => {
        try {
          // Tạo canvas để cắt vùng ảnh đã chọn
          const canvas = document.createElement("canvas");
          canvas.width = w * dpr;
          canvas.height = h * dpr;
          const ctx = canvas.getContext("2d");

          // Chụp từ captureVisibleTab là viewport-based nên dùng client x, y trực tiếp
          ctx.drawImage(
            img,
            x * dpr,
            y * dpr,
            w * dpr,
            h * dpr,
            0,
            0,
            w * dpr,
            h * dpr
          );

          const croppedBase64 = canvas.toDataURL("image/png");

          // Lấy các tùy chọn dịch thuật
          chrome.storage.sync.get({ sourceLang: "Auto", targetLang: "Vietnamese" }, (settings) => {
            // Gửi dữ liệu ảnh đã cắt cho background.js để dịch bằng Gemini
            chrome.runtime.sendMessage(
              {
                action: "translate-image",
                imageData: croppedBase64,
                options: {
                  sourceLang: settings.sourceLang,
                  targetLang: settings.targetLang
                }
              },
              (translateResponse) => {
                if (!translateResponse || !translateResponse.success) {
                  showError(resultContainer, translateResponse?.error || "Lỗi không xác định khi gọi API dịch.");
                  return;
                }
                
                // Vẽ bản dịch
                renderTranslationResults(resultContainer, translateResponse.data, w, h);
              }
            );
          });
        } catch (err) {
          showError(resultContainer, "Lỗi cắt ảnh: " + err.message);
        }
      };
      
      img.onerror = () => {
        showError(resultContainer, "Không thể tải ảnh chụp màn hình.");
      };
    });
  }

  // Hiển thị thông báo lỗi trên vùng chọn
  function showError(container, message) {
    const loading = container.querySelector(".manga-trans-loading-overlay");
    if (loading) loading.remove();

    const errorEl = document.createElement("div");
    errorEl.className = "manga-trans-loading-overlay";
    errorEl.style.border = "2px solid #ef4444";
    errorEl.style.background = "rgba(30, 41, 59, 0.95)";
    errorEl.innerHTML = `
      <div style="color: #ef4444; font-size: 20px; font-weight: bold; margin-bottom: 8px;">Lỗi xảy ra</div>
      <div style="padding: 0 16px; text-align: center; font-size: 12px; line-height: 1.4; color: #cbd5e1; word-break: break-word;">${message}</div>
      <button class="manga-trans-control-btn close-btn" style="margin-top: 12px; padding: 6px 12px; background: #ef4444; color: white; border-radius: 4px;">Đóng</button>
    `;
    
    errorEl.querySelector(".close-btn").addEventListener("click", () => {
      container.remove();
    });

    container.appendChild(errorEl);
  }

  // Dựng bản dịch đè lên vị trí chữ cũ
  function renderTranslationResults(container, apiData, w, h) {
    const loading = container.querySelector(".manga-trans-loading-overlay");
    if (loading) loading.remove();

    // Tạo thanh điều khiển trên đầu vùng dịch
    const controls = document.createElement("div");
    controls.className = "manga-trans-result-controls";

    const toggleBtn = document.createElement("button");
    toggleBtn.className = "manga-trans-control-btn";
    toggleBtn.textContent = "Ẩn bản dịch";
    let isShowingTranslation = true;

    toggleBtn.addEventListener("click", () => {
      isShowingTranslation = !isShowingTranslation;
      const bubbles = container.querySelectorAll(".manga-trans-bubble");
      bubbles.forEach(bubble => {
        bubble.style.display = isShowingTranslation ? "flex" : "none";
      });
      toggleBtn.textContent = isShowingTranslation ? "Ẩn bản dịch" : "Hiện bản dịch";
    });

    const closeBtn = document.createElement("button");
    closeBtn.className = "manga-trans-control-btn close-btn";
    closeBtn.textContent = "Xóa";
    closeBtn.addEventListener("click", () => {
      container.remove();
    });

    controls.appendChild(toggleBtn);
    controls.appendChild(closeBtn);
    container.appendChild(controls);

    // Lấy phông chữ, màu sắc cấu hình từ bộ nhớ
    chrome.storage.sync.get(
      {
        fontFamily: "Comic Sans MS, sans-serif",
        bubbleColor: "#ffffff",
        bubbleOpacity: 1.0,
        textColor: "#1f2937"
      },
      (styles) => {
        const blocks = apiData.blocks || [];
        
        blocks.forEach((block, index) => {
          const coords = block.boundingBox;
          if (!coords || coords.length !== 4) return;

          // Giải mã tọa độ [y_min, x_min, y_max, x_max] (từ 0 đến 1000)
          const yMin = coords[0];
          const xMin = coords[1];
          const yMax = coords[2];
          const xMax = coords[3];

          // Chuyển đổi về pixel thực tế trong vùng crop
          const left = (xMin / 1000) * w;
          const top = (yMin / 1000) * h;
          const width = ((xMax - xMin) / 1000) * w;
          const height = ((yMax - yMin) / 1000) * h;

          // Bỏ qua nếu kích thước quá bé
          if (width < 5 || height < 5) return;

          // Tạo phần tử bong bóng chữ dịch
          const bubble = document.createElement("div");
          bubble.className = "manga-trans-bubble";
          bubble.style.left = left + "px";
          bubble.style.top = top + "px";
          bubble.style.width = width + "px";
          bubble.style.height = height + "px";
          bubble.style.backgroundColor = styles.bubbleColor;
          bubble.style.opacity = styles.bubbleOpacity;
          bubble.style.border = `1px solid rgba(0, 0, 0, 0.15)`;
          bubble.style.borderRadius = "6px";
          bubble.dataset.original = block.originalText;
          bubble.dataset.translated = block.translatedText;

          // Phần tử hiển thị chữ dịch
          const textEl = document.createElement("div");
          textEl.className = "manga-trans-text-content";
          textEl.style.fontFamily = styles.fontFamily;
          textEl.style.color = styles.textColor;
          textEl.textContent = block.translatedText;

          bubble.appendChild(textEl);
          container.appendChild(bubble);

          // Tự động căn chỉnh font chữ cho vừa bong bóng thoại
          adjustFontSize(textEl, width, height);

          // Tạo tooltip tương tác hiển thị chữ gốc và cho phép sao chép/chỉnh sửa
          setupBubbleInteractions(bubble, container);
        });
      }
    );
  }

  // Tự động căn chỉnh font-size từ lớn đến nhỏ sao cho vừa vặn bounding box
  function adjustFontSize(textEl, maxWidth, maxHeight) {
    let size = 20; // Cỡ chữ lớn nhất bắt đầu thử
    const minSize = 8; // Cỡ chữ nhỏ nhất có thể đọc được

    textEl.style.fontSize = size + "px";

    // Lặp giảm dần cỡ chữ cho đến khi vừa khít trong box (có tính padding biên)
    while (
      size > minSize &&
      (textEl.scrollHeight > maxHeight || textEl.scrollWidth > maxWidth)
    ) {
      size--;
      textEl.style.fontSize = size + "px";
    }
  }

  // Cấu hình sự kiện hover, click, copy và edit bản dịch
  function setupBubbleInteractions(bubble, container) {
    let tooltip = null;

    bubble.addEventListener("mouseenter", () => {
      // Xóa các tooltip cũ trong container nếu có
      const existingTooltip = container.querySelector(".manga-trans-tooltip");
      if (existingTooltip) existingTooltip.remove();

      // Tạo tooltip mới
      tooltip = document.createElement("div");
      tooltip.className = "manga-trans-tooltip";
      tooltip.innerHTML = `
        <div class="manga-trans-tooltip-title">
          <span>CHỮ GỐC (JAP/ENG)</span>
          <span style="color: #6366f1; font-weight: bold;">Gemini AI</span>
        </div>
        <div class="manga-trans-tooltip-original">${bubble.dataset.original || "(Trống)"}</div>
        <div class="manga-trans-tooltip-actions">
          <button class="manga-trans-tooltip-btn copy-orig-btn">Sao chép gốc</button>
          <button class="manga-trans-tooltip-btn copy-trans-btn">Sao chép dịch</button>
          <button class="manga-trans-tooltip-btn edit-btn">Sửa</button>
        </div>
      `;

      // Định vị trí tooltip
      // Mặc định hiển thị bên dưới bong bóng dịch, nếu sát mép dưới thì cho lên trên
      const bubbleRect = bubble.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      
      const leftPos = parseFloat(bubble.style.left);
      const topPos = parseFloat(bubble.style.top) + parseFloat(bubble.style.height) + 6;

      tooltip.style.left = leftPos + "px";
      tooltip.style.top = topPos + "px";

      container.appendChild(tooltip);

      // Thêm class show để tạo hiệu ứng animation mượt mà
      setTimeout(() => {
        if (tooltip) tooltip.classList.add("show");
      }, 50);

      // Gắn sự kiện copy và edit
      tooltip.querySelector(".copy-orig-btn").addEventListener("click", () => {
        navigator.clipboard.writeText(bubble.dataset.original);
        showTemporaryButtonText(tooltip.querySelector(".copy-orig-btn"), "Đã chép!");
      });

      tooltip.querySelector(".copy-trans-btn").addEventListener("click", () => {
        navigator.clipboard.writeText(bubble.dataset.translated);
        showTemporaryButtonText(tooltip.querySelector(".copy-trans-btn"), "Đã chép!");
      });

      tooltip.querySelector(".edit-btn").addEventListener("click", () => {
        openEditModal(bubble);
        if (tooltip) tooltip.remove();
      });
    });

    // Ẩn tooltip khi di chuột ra khỏi bóng thoại (trừ khi di chuột vào chính tooltip)
    bubble.addEventListener("mouseleave", (e) => {
      setTimeout(() => {
        if (tooltip && !tooltip.matches(":hover")) {
          tooltip.remove();
          tooltip = null;
        }
      }, 300);
    });

    // Khi di chuột ra khỏi tooltip thì xóa nó đi
    container.addEventListener("mouseleave", () => {
      if (tooltip) {
        tooltip.remove();
        tooltip = null;
      }
    });
  }

  // Đổi nhãn nút tạm thời khi copy
  function showTemporaryButtonText(btn, text) {
    const originalText = btn.textContent;
    btn.textContent = text;
    btn.style.backgroundColor = "#22c55e";
    btn.style.borderColor = "#22c55e";
    btn.style.color = "#ffffff";
    setTimeout(() => {
      btn.textContent = originalText;
      btn.style.backgroundColor = "";
      btn.style.borderColor = "";
      btn.style.color = "";
    }, 1200);
  }

  // Mở modal cho phép người dùng chỉnh sửa bản dịch thủ công
  function openEditModal(bubble) {
    // Xóa modal cũ nếu có
    const existingModal = document.querySelector(".manga-trans-edit-modal");
    if (existingModal) existingModal.remove();

    const modal = document.createElement("div");
    modal.className = "manga-trans-edit-modal";
    modal.innerHTML = `
      <div class="manga-trans-edit-title">Chỉnh sửa bản dịch</div>
      <textarea class="manga-trans-edit-textarea">${bubble.dataset.translated}</textarea>
      <div class="manga-trans-edit-actions">
        <button class="manga-trans-tooltip-btn cancel-edit-btn" style="border-color: rgba(255,255,255,0.1)">Hủy</button>
        <button class="manga-trans-tooltip-btn save-edit-btn" style="background: #6366f1; color: white; border-color: #6366f1;">Lưu</button>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector(".cancel-edit-btn").addEventListener("click", () => {
      modal.remove();
    });

    modal.querySelector(".save-edit-btn").addEventListener("click", () => {
      const newText = modal.querySelector(".manga-trans-edit-textarea").value;
      bubble.dataset.translated = newText;
      
      const textContent = bubble.querySelector(".manga-trans-text-content");
      if (textContent) {
        textContent.textContent = newText;
        adjustFontSize(textContent, parseFloat(bubble.style.width), parseFloat(bubble.style.height));
      }
      modal.remove();
    });
  }

})();
