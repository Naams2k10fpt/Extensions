importScripts('jszip.min.js');

// Trạng thái các chương đang tải
// Cấu trúc: { [chapterId]: { status, progress, current, total, title, mangaTitle, errorMsg, quality, abortController } }
const activeDownloads = {};

// Hằng số giới hạn tải song song
const CONCURRENT_LIMIT = 3;

// Đăng ký nhận message từ Popup và Content Script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { action, chapterId, quality } = message;

  if (action === "get_status") {
    // Trả về trạng thái hiện tại của chapter
    if (activeDownloads[chapterId]) {
      const state = { ...activeDownloads[chapterId] };
      delete state.abortController; // Không gửi abortController qua message
      sendResponse({ status: "success", state });
    } else {
      sendResponse({ status: "success", state: { status: "idle" } });
    }
    return true;
  }

  if (action === "start_download") {
    startDownload(chapterId, quality || "original");
    sendResponse({ status: "initiated" });
    return true;
  }

  if (action === "cancel_download") {
    cancelDownload(chapterId);
    sendResponse({ status: "cancelled" });
    return true;
  }
});

// Hàm phát sóng tiến độ tới các Popup hoặc Content Script đang mở
function broadcastProgress(chapterId) {
  if (!activeDownloads[chapterId]) return;

  const state = { ...activeDownloads[chapterId] };
  delete state.abortController; // Tránh lỗi cấu trúc tuần tự hóa (serialization)

  const payload = {
    action: "progress_update",
    chapterId: chapterId,
    state: state
  };

  // Gửi tới popup (nếu đang mở)
  chrome.runtime.sendMessage(payload).catch(() => {
    // Lờ đi nếu không có popup nào mở
  });

  // Gửi tới tất cả các tab MangaDex đang mở
  chrome.tabs.query({ url: "*://*.mangadex.org/chapter/*" }, (tabs) => {
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, payload).catch(() => {
        // Lờ đi nếu tab không có content script lắng nghe
      });
    }
  });
}

// Làm sạch tên file để tránh ký tự đặc biệt gây lỗi hệ thống
function sanitizeFilename(name) {
  return name.replace(/[\\/:*?"<>|]/g, "_").trim();
}

// Bắt đầu tải chương
async function startDownload(chapterId, quality) {
  // Nếu đã tồn tại tiến trình tải và không ở trạng thái lỗi/xong, bỏ qua
  if (activeDownloads[chapterId] && 
      !["idle", "done", "error"].includes(activeDownloads[chapterId].status)) {
    return;
  }

  const controller = new AbortController();
  activeDownloads[chapterId] = {
    status: "fetching",
    progress: 0,
    current: 0,
    total: 0,
    title: "",
    mangaTitle: "",
    errorMsg: "",
    quality: quality,
    abortController: controller
  };

  broadcastProgress(chapterId);

  try {
    const signal = controller.signal;

    // 1. Fetch thông tin Chapter và Manga liên kết
    const chapterUrl = `https://api.mangadex.org/chapter/${chapterId}?includes[]=manga`;
    let chapterRes;
    try {
      chapterRes = await fetch(chapterUrl, { signal });
    } catch (err) {
      throw new Error(`Lỗi kết nối API thông tin Chapter: ${err.message}`);
    }
    
    if (!chapterRes.ok) {
      throw new Error(`API thông tin Chapter trả về lỗi: HTTP ${chapterRes.status}`);
    }
    
    const chapterJson = await chapterRes.json();
    const chapterAttrs = chapterJson.data.attributes;
    const chapterNum = chapterAttrs.chapter || "";
    const chapterTitle = chapterAttrs.title || "";
    
    // Tìm tên manga trong mảng included
    let mangaTitle = "Manga";
    if (chapterJson.included) {
      const mangaData = chapterJson.included.find(item => item.type === "manga");
      if (mangaData && mangaData.attributes && mangaData.attributes.title) {
        // Lấy tên tiếng Anh hoặc tên đầu tiên khả dụng
        const titleObj = mangaData.attributes.title;
        mangaTitle = titleObj.en || Object.values(titleObj)[0] || "Manga";
      }
    }

    activeDownloads[chapterId].title = chapterTitle;
    activeDownloads[chapterId].mangaTitle = mangaTitle;
    activeDownloads[chapterId].status = "downloading";
    broadcastProgress(chapterId);

    // 2. Fetch danh sách ảnh từ MangaDex@Home
    const atHomeUrl = `https://api.mangadex.org/at-home/server/${chapterId}`;
    let atHomeRes;
    try {
      atHomeRes = await fetch(atHomeUrl, { signal });
    } catch (err) {
      throw new Error(`Lỗi kết nối API máy chủ ảnh MangaDex@Home: ${err.message}`);
    }
    
    if (!atHomeRes.ok) {
      throw new Error(`API máy chủ ảnh MangaDex@Home trả về lỗi: HTTP ${atHomeRes.status}`);
    }
    
    const atHomeJson = await atHomeRes.json();
    const baseUrl = atHomeJson.baseUrl;
    const hash = atHomeJson.chapter.hash;
    
    // Lựa chọn chất lượng ảnh
    const files = quality === "saver" ? atHomeJson.chapter.dataSaver : atHomeJson.chapter.data;
    if (!files || files.length === 0) throw new Error("Không tìm thấy ảnh nào trong chapter này.");

    const totalPages = files.length;
    activeDownloads[chapterId].total = totalPages;
    broadcastProgress(chapterId);

    // 3. Tải các ảnh một cách song song có giới hạn (CONCURRENT_LIMIT)
    const imagesData = new Array(totalPages);
    let downloadedCount = 0;
    
    // Hàm tải một ảnh theo vị trí index
    const downloadPage = async (index) => {
      const filename = files[index];
      const ext = filename.split(".").pop() || "png";
      const pathType = quality === "saver" ? "data-saver" : "data";

      // URL chính từ node MangaDex@Home
      const primaryUrl = `${baseUrl}/${pathType}/${hash}/${filename}`;
      // URL dự phòng từ máy chủ trung tâm của MangaDex
      const fallbackUrl = `https://uploads.mangadex.org/${pathType}/${hash}/${filename}`;

      let attempts = 0;
      const maxAttempts = 3;
      
      while (attempts < maxAttempts) {
        try {
          if (signal.aborted) throw new Error("Aborted");
          
          let response;
          let currentUrl = primaryUrl;
          
          try {
            // Thử tải bằng URL của node chính
            response = await fetch(currentUrl, { signal });
            
            // Nếu node trả về lỗi (ví dụ: 404, 502, 504), chuyển sang tải từ máy chủ trung tâm
            if (!response.ok) {
              console.warn(`Node trả về HTTP ${response.status} cho trang ${index + 1}. Thử tải từ máy chủ trung tâm...`);
              currentUrl = fallbackUrl;
              response = await fetch(currentUrl, { signal });
            }
          } catch (err) {
            // Nếu lỗi kết nối (mạng lỗi, timeout), chuyển sang tải từ máy chủ trung tâm
            console.warn(`Lỗi kết nối node ở trang ${index + 1}: ${err.message}. Thử tải từ máy chủ trung tâm...`);
            currentUrl = fallbackUrl;
            try {
              response = await fetch(currentUrl, { signal });
            } catch (fallbackErr) {
              throw new Error(`Lỗi kết nối mạng: ${fallbackErr.message}`);
            }
          }
          
          if (!response.ok) {
            throw new Error(`Lỗi máy chủ ảnh (cả node và máy chủ chính đều lỗi): HTTP ${response.status}`);
          }
          
          const arrayBuffer = await response.arrayBuffer();
          
          imagesData[index] = {
            index: index,
            ext: ext,
            data: arrayBuffer
          };
          
          downloadedCount++;
          activeDownloads[chapterId].current = downloadedCount;
          activeDownloads[chapterId].progress = Math.round((downloadedCount / totalPages) * 100);
          broadcastProgress(chapterId);
          break; // Tải thành công, thoát khỏi vòng lặp thử lại
        } catch (err) {
          attempts++;
          if (signal.aborted) throw err;
          if (attempts >= maxAttempts) {
            throw new Error(`Không thể tải ảnh trang ${index + 1}: ${err.message}`);
          }
          // Chờ một chút trước khi thử lại (exponential backoff)
          await new Promise(resolve => setTimeout(resolve, attempts * 1000));
        }
      }
    };

    // Chạy hàng đợi tải song song
    const queue = [...Array(totalPages).keys()]; // Mảng chứa chỉ mục [0, 1, 2, ...]
    const workers = Array(Math.min(CONCURRENT_LIMIT, totalPages)).fill(null).map(async () => {
      while (queue.length > 0) {
        if (signal.aborted) break;
        const index = queue.shift();
        await downloadPage(index);
      }
    });

    await Promise.all(workers);

    if (signal.aborted) throw new Error("Tiến trình tải bị người dùng hủy.");

    // 4. Tạo file ZIP bằng JSZip
    activeDownloads[chapterId].status = "zipping";
    activeDownloads[chapterId].progress = 98; // Tạm thời set 98% trong lúc nén
    broadcastProgress(chapterId);

    const zip = new JSZip();
    for (let i = 0; i < totalPages; i++) {
      const img = imagesData[i];
      if (img && img.data) {
        // Đặt tên trang chuẩn hóa: 001.png, 002.jpg...
        const pageNumStr = String(img.index + 1).padStart(3, "0");
        const zipFilename = `${pageNumStr}.${img.ext}`;
        zip.file(zipFilename, img.data);
      }
    }

    const base64Zip = await zip.generateAsync({ type: "base64" });
    const dataUrl = `data:application/zip;base64,${base64Zip}`;

    // Tạo tên file zip hoàn chỉnh
    let chapterDisplay = chapterNum ? `Ch.${chapterNum}` : "Ch.Unknown";
    let titleDisplay = chapterTitle ? ` - ${chapterTitle}` : "";
    let zipName = sanitizeFilename(`${mangaTitle} [${chapterDisplay}${titleDisplay}].zip`);

    // 5. Kích hoạt tải về trình duyệt
    chrome.downloads.download({
      url: dataUrl,
      filename: zipName,
      saveAs: true
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.error(chrome.runtime.lastError);
        activeDownloads[chapterId].status = "error";
        activeDownloads[chapterId].errorMsg = chrome.runtime.lastError.message;
      } else {
        activeDownloads[chapterId].status = "done";
        activeDownloads[chapterId].progress = 100;
      }
      broadcastProgress(chapterId);
    });

  } catch (error) {
    console.error("Lỗi trong quá trình xử lý:", error);
    if (activeDownloads[chapterId]) {
      activeDownloads[chapterId].status = "error";
      activeDownloads[chapterId].errorMsg = error.message || "Lỗi không xác định.";
      broadcastProgress(chapterId);
    }
  }
}

// Hàm hủy tải chương
function cancelDownload(chapterId) {
  const download = activeDownloads[chapterId];
  if (download) {
    if (download.abortController) {
      download.abortController.abort();
    }
    activeDownloads[chapterId].status = "error";
    activeDownloads[chapterId].errorMsg = "Đã hủy tải xuống.";
    broadcastProgress(chapterId);
  }
}
