document.addEventListener("DOMContentLoaded", () => {
  const apiKeyInput = document.getElementById("apiKey");
  const toggleApiKeyBtn = document.getElementById("toggleApiKey");
  const modelSelect = document.getElementById("model");
  const sourceLangSelect = document.getElementById("sourceLang");
  const targetLangSelect = document.getElementById("targetLang");
  const fontFamilySelect = document.getElementById("fontFamily");
  const bubbleOpacitySlider = document.getElementById("bubbleOpacity");
  const bubbleOpacityVal = document.getElementById("bubbleOpacityVal");
  const startCaptureBtn = document.getElementById("startCapture");
  const statusMsg = document.getElementById("statusMsg");

  let isInitialized = false;

  // 1. Tải cấu hình từ bộ nhớ chrome.storage
  chrome.storage.sync.get(
    {
      apiKey: "",
      model: "gemini-2.5-flash",
      sourceLang: "Auto",
      targetLang: "Vietnamese",
      fontFamily: "Comic Sans MS, sans-serif",
      bubbleOpacity: 1.0,
    },
    (items) => {
      apiKeyInput.value = items.apiKey;
      modelSelect.value = items.model;
      sourceLangSelect.value = items.sourceLang;
      targetLangSelect.value = items.targetLang;
      fontFamilySelect.value = items.fontFamily;
      bubbleOpacitySlider.value = items.bubbleOpacity;
      
      updateOpacityLabel(items.bubbleOpacity);
      isInitialized = true;
    }
  );

  // 2. Tự động lưu cấu hình khi bất kỳ giá trị nào thay đổi
  const saveSettings = () => {
    if (!isInitialized) return;

    const config = {
      apiKey: apiKeyInput.value.trim(),
      model: modelSelect.value,
      sourceLang: sourceLangSelect.value,
      targetLang: targetLangSelect.value,
      fontFamily: fontFamilySelect.value,
      bubbleOpacity: parseFloat(bubbleOpacitySlider.value),
    };

    chrome.storage.sync.set(config, () => {
      showToast();
    });
  };

  // Lắng nghe sự kiện để lưu cấu hình
  apiKeyInput.addEventListener("input", saveSettings);
  modelSelect.addEventListener("change", saveSettings);
  sourceLangSelect.addEventListener("change", saveSettings);
  targetLangSelect.addEventListener("change", saveSettings);
  fontFamilySelect.addEventListener("change", saveSettings);
  
  bubbleOpacitySlider.addEventListener("input", (e) => {
    updateOpacityLabel(e.target.value);
    saveSettings();
  });

  // Cập nhật hiển thị % độ mờ
  function updateOpacityLabel(value) {
    bubbleOpacityVal.textContent = Math.round(value * 100) + "%";
  }

  // 3. Ẩn/Hiện API Key
  toggleApiKeyBtn.addEventListener("click", () => {
    const type = apiKeyInput.type === "password" ? "text" : "password";
    apiKeyInput.type = type;
    
    // Đổi màu sắc icon hiển thị khi đang hiện key
    if (type === "text") {
      toggleApiKeyBtn.style.color = "var(--primary)";
    } else {
      toggleApiKeyBtn.style.color = "";
    }
  });

  // 4. Kích hoạt chế độ vẽ vùng chọn để dịch
  startCaptureBtn.addEventListener("click", () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { action: "start-capture" }, (response) => {
          // Bỏ qua lỗi kết nối (nếu script chưa load trên tab hệ thống)
          if (chrome.runtime.lastError) {
            alert("Không thể chạy extension trên trang web này (Trang hệ thống Chrome hoặc chưa tải lại trang).");
          } else {
            // Đóng popup sau khi đã kích hoạt thành công chế độ vẽ chọn
            window.close();
          }
        });
      }
    });
  });

  // 5. Hiển thị thông báo Toast lưu thành công
  let toastTimeout;
  function showToast() {
    statusMsg.classList.add("show");
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      statusMsg.classList.remove("show");
    }, 1500);
  }
});
