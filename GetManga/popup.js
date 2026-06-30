let currentChapterId = null;

document.addEventListener("DOMContentLoaded", async () => {
  const stateNotSupported = document.getElementById("state-not-supported");
  const stateSupported = document.getElementById("state-supported");
  const mangaTitleEl = document.getElementById("manga-title");
  const chapterTitleEl = document.getElementById("chapter-title");
  const btnDownload = document.getElementById("btn-download");
  const btnCancel = document.getElementById("btn-cancel");
  
  const progressContainer = document.getElementById("progress-container");
  const progressStatus = document.getElementById("progress-status");
  const progressPercent = document.getElementById("progress-percent");
  const progressBarFill = document.getElementById("progress-bar-fill");
  const progressDetail = document.getElementById("progress-detail");
  
  const errorContainer = document.getElementById("error-container");
  const errorMessage = document.getElementById("error-message");
  const downloadSettings = document.getElementById("download-settings");

  // 1. Kiểm tra tab hiện tại
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs.length === 0) return;
    const activeTab = tabs[0];
    const url = activeTab.url || "";
    
    // Parse chapter ID từ URL
    const match = url.match(/\/chapter\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/);
    
    if (match) {
      currentChapterId = match[1];
      stateNotSupported.classList.add("hidden");
      stateSupported.classList.remove("hidden");
      
      // Khôi phục tùy chọn chất lượng đã lưu
      chrome.storage.local.get(["preferredQuality"], (res) => {
        if (res.preferredQuality) {
          const radio = document.querySelector(`input[name="quality"][value="${res.preferredQuality}"]`);
          if (radio) radio.checked = true;
        }
      });
      
      // Lấy trạng thái hiện tại từ Background
      requestStatusAndInit();
    } else {
      stateSupported.classList.add("hidden");
      stateNotSupported.classList.remove("hidden");
    }
  });

  // 2. Lưu cấu hình khi thay đổi chất lượng ảnh
  document.querySelectorAll('input[name="quality"]').forEach(radio => {
    radio.addEventListener("change", (e) => {
      chrome.storage.local.set({ preferredQuality: e.target.value });
    });
  });

  // 3. Sự kiện Click nút Tải xuống
  btnDownload.addEventListener("click", () => {
    if (!currentChapterId) return;
    
    const quality = document.querySelector('input[name="quality"]:checked').value;
    
    // Ẩn bảng lỗi cũ nếu có
    errorContainer.classList.add("hidden");
    
    chrome.runtime.sendMessage({
      action: "start_download",
      chapterId: currentChapterId,
      quality: quality
    }, () => {
      // Chuyển UI sang trạng thái chuẩn bị tải
      updatePopupUI({
        status: "fetching",
        progress: 0,
        current: 0,
        total: 0
      });
    });
  });

  // 4. Sự kiện Click nút Hủy tải
  btnCancel.addEventListener("click", () => {
    if (!currentChapterId) return;
    
    if (confirm("Bạn có muốn hủy quá trình tải chương này không?")) {
      chrome.runtime.sendMessage({
        action: "cancel_download",
        chapterId: currentChapterId
      });
    }
  });

  // 5. Đăng ký lắng nghe thông báo tiến độ từ background script
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === "progress_update" && message.chapterId === currentChapterId) {
      updatePopupUI(message.state);
    }
  });

  // Yêu cầu lấy trạng thái và khởi tạo thông tin hiển thị
  function requestStatusAndInit() {
    chrome.runtime.sendMessage({ action: "get_status", chapterId: currentChapterId }, (response) => {
      if (response && response.state) {
        const state = response.state;
        updatePopupUI(state);
        
        // Nếu ở trạng thái idle (chưa tải), gọi API lấy thông tin Manga/Chapter để hiển thị
        if (state.status === "idle") {
          fetchChapterInfo(currentChapterId);
        } else {
          // Lấy thông tin đã được background lưu trữ
          if (state.mangaTitle) {
            mangaTitleEl.textContent = state.mangaTitle;
            let chapterNumStr = state.title ? ` - ${state.title}` : "";
            chapterTitleEl.textContent = `Chương hiện tại${chapterNumStr}`;
          } else {
            fetchChapterInfo(currentChapterId);
          }
        }
      }
    });
  }

  // Gọi trực tiếp API MangaDex từ popup để lấy thông tin text
  async function fetchChapterInfo(chapterId) {
    try {
      const res = await fetch(`https://api.mangadex.org/chapter/${chapterId}?includes[]=manga`);
      if (!res.ok) throw new Error();
      const json = await res.json();
      
      const chapterAttrs = json.data.attributes;
      const chapterNum = chapterAttrs.chapter || "";
      const chapterTitle = chapterAttrs.title || "";
      
      let mangaTitle = "Manga";
      if (json.included) {
        const mangaData = json.included.find(item => item.type === "manga");
        if (mangaData && mangaData.attributes && mangaData.attributes.title) {
          const titleObj = mangaData.attributes.title;
          mangaTitle = titleObj.en || Object.values(titleObj)[0] || "Manga";
        }
      }
      
      mangaTitleEl.textContent = mangaTitle;
      mangaTitleEl.title = mangaTitle;
      chapterTitleEl.textContent = `Chapter ${chapterNum}${chapterTitle ? ` - ${chapterTitle}` : ""}`;
    } catch (err) {
      console.error(err);
      mangaTitleEl.textContent = "Không tìm thấy tên truyện";
      chapterTitleEl.textContent = "Nhấp nút tải để tự động nhận dạng";
    }
  }

  // Hàm cập nhật trạng thái giao diện Popup
  function updatePopupUI(state) {
    const { status, progress, current, total, errorMsg } = state;

    switch (status) {
      case "fetching":
        // Đang lấy API
        downloadSettings.classList.add("hidden");
        progressContainer.classList.remove("hidden");
        errorContainer.classList.add("hidden");
        
        progressStatus.textContent = "Đang kết nối API...";
        progressPercent.textContent = "0%";
        progressBarFill.style.width = "0%";
        progressDetail.textContent = "Đang quét danh sách ảnh...";
        
        btnDownload.classList.add("hidden");
        btnCancel.classList.remove("hidden");
        break;

      case "downloading":
        // Đang tải ảnh
        downloadSettings.classList.add("hidden");
        progressContainer.classList.remove("hidden");
        errorContainer.classList.add("hidden");
        
        progressStatus.textContent = "Đang tải ảnh...";
        progressPercent.textContent = `${progress}%`;
        progressBarFill.style.width = `${progress}%`;
        progressDetail.textContent = `Trang ${current}/${total}`;
        
        btnDownload.classList.add("hidden");
        btnCancel.classList.remove("hidden");
        break;

      case "zipping":
        // Đang nén file
        downloadSettings.classList.add("hidden");
        progressContainer.classList.remove("hidden");
        errorContainer.classList.add("hidden");
        
        progressStatus.textContent = "Đang nén file ZIP...";
        progressPercent.textContent = "98%";
        progressBarFill.style.width = "98%";
        progressDetail.textContent = "Đang đóng gói hình ảnh...";
        
        btnDownload.classList.add("hidden");
        btnCancel.classList.remove("hidden");
        break;

      case "done":
        // Hoàn tất tải
        downloadSettings.classList.remove("hidden");
        progressContainer.classList.remove("hidden");
        errorContainer.classList.add("hidden");
        
        progressStatus.textContent = "Tải thành công!";
        progressPercent.textContent = "100%";
        progressBarFill.style.width = "100%";
        progressDetail.textContent = "Kiểm tra file đã tải về.";
        
        btnDownload.classList.remove("hidden");
        btnDownload.textContent = "Tải lại Chapter (ZIP)";
        btnCancel.classList.add("hidden");
        break;

      case "error":
        // Bị lỗi
        downloadSettings.classList.remove("hidden");
        progressContainer.classList.add("hidden");
        errorContainer.classList.remove("hidden");
        
        errorMessage.textContent = `Lỗi: ${errorMsg || "Không tải được truyện."}`;
        
        btnDownload.classList.remove("hidden");
        btnDownload.textContent = "Thử tải lại (ZIP)";
        btnCancel.classList.add("hidden");
        break;

      case "idle":
      default:
        // Sẵn sàng tải
        downloadSettings.classList.remove("hidden");
        progressContainer.classList.add("hidden");
        errorContainer.classList.add("hidden");
        
        btnDownload.classList.remove("hidden");
        btnDownload.textContent = "Tải Chapter (ZIP)";
        btnCancel.classList.add("hidden");
        break;
    }
  }
});
