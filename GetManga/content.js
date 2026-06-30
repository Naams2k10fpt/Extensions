let currentChapterId = null;
let statusInterval = null;
let urlCheckInterval = null;

// Hàm trích xuất Chapter ID từ URL
function getChapterIdFromUrl() {
  const match = window.location.pathname.match(/\/chapter\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/);
  return match ? match[1] : null;
}

// Bắt đầu khởi động content script
function init() {
  // Kiểm tra định kỳ thay đổi URL (do MangaDex là Single Page App)
  urlCheckInterval = setInterval(checkUrlChange, 1000);
  checkUrlChange();

  // Đăng ký nhận cập nhật trạng thái từ background script
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === "progress_update" && message.chapterId === currentChapterId) {
      updateUI(message.state);
    }
  });
}

// Kiểm tra sự thay đổi URL
function checkUrlChange() {
  const chapterId = getChapterIdFromUrl();
  if (chapterId !== currentChapterId) {
    currentChapterId = chapterId;
    if (currentChapterId) {
      injectButton();
      requestStatus();
    } else {
      removeButton();
    }
  }
}

// Gửi yêu cầu lấy trạng thái tải hiện tại của chapter
function requestStatus() {
  if (!currentChapterId) return;
  chrome.runtime.sendMessage({ action: "get_status", chapterId: currentChapterId }, (response) => {
    if (response && response.state) {
      updateUI(response.state);
    }
  });
}

// Tạo và chèn nút Floating vào trang web
function injectButton() {
  if (document.getElementById("mangadex-zip-downloader-fab")) return;

  const fab = document.createElement("button");
  fab.id = "mangadex-zip-downloader-fab";
  fab.className = "mdz-fab idle";
  
  // HTML nội dung nút: Icon + Text
  fab.innerHTML = `
    <span class="mdz-icon">📥</span>
    <span class="mdz-text">Tải Chapter (ZIP)</span>
  `;

  // Sự kiện click
  fab.addEventListener("click", () => {
    const status = fab.dataset.status;
    
    if (!status || ["idle", "done", "error"].includes(status)) {
      // Bắt đầu tải
      chrome.runtime.sendMessage({
        action: "start_download",
        chapterId: currentChapterId,
        quality: "original" // Mặc định từ nút chèn trang là chất lượng gốc
      });
    } else if (["fetching", "downloading", "zipping"].includes(status)) {
      // Xác nhận hủy tải
      if (confirm("Bạn có muốn hủy quá trình tải chapter này không?")) {
        chrome.runtime.sendMessage({
          action: "cancel_download",
          chapterId: currentChapterId
        });
      }
    }
  });

  document.body.appendChild(fab);
}

// Xóa nút Floating khỏi trang web
function removeButton() {
  const fab = document.getElementById("mangadex-zip-downloader-fab");
  if (fab) {
    fab.remove();
  }
}

// Cập nhật giao diện nút dựa trên trạng thái
function updateUI(state) {
  const fab = document.getElementById("mangadex-zip-downloader-fab");
  if (!fab) return;

  const { status, progress, current, total, errorMsg } = state;
  fab.dataset.status = status;
  
  // Reset các class cũ
  fab.className = "mdz-fab " + status;

  const iconSpan = fab.querySelector(".mdz-icon");
  const textSpan = fab.querySelector(".mdz-text");

  switch (status) {
    case "fetching":
      iconSpan.innerHTML = "🔍";
      textSpan.innerHTML = "Đang kết nối...";
      fab.title = "Đang lấy thông tin chương truyện từ API...";
      break;

    case "downloading":
      iconSpan.innerHTML = "⏳";
      textSpan.innerHTML = `Đang tải: ${progress}% (${current}/${total})`;
      fab.title = "Click để hủy tải xuống";
      break;

    case "zipping":
      iconSpan.innerHTML = "⚡";
      textSpan.innerHTML = "Đang nén ZIP...";
      fab.title = "Đang nén các file ảnh, vui lòng chờ...";
      break;

    case "done":
      iconSpan.innerHTML = "✅";
      textSpan.innerHTML = "Hoàn tất!";
      fab.title = "Tải thành công! File ZIP đã lưu.";
      // Quay lại trạng thái idle sau 3 giây
      setTimeout(() => {
        if (fab.dataset.status === "done") {
          updateUI({ status: "idle" });
        }
      }, 3000);
      break;

    case "error":
      iconSpan.innerHTML = "❌";
      textSpan.innerHTML = `Lỗi: ${errorMsg || "Thất bại"}`;
      fab.title = `Lỗi xảy ra: ${errorMsg || "Không rõ nguyên nhân"}. Click để thử lại.`;
      break;

    case "idle":
    default:
      iconSpan.innerHTML = "📥";
      textSpan.innerHTML = "Tải Chapter (ZIP)";
      fab.title = "Tải toàn bộ chapter này về máy dưới dạng file ZIP";
      break;
  }
}

// Khởi chạy khi DOM sẵn sàng
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
