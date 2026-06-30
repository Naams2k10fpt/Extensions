// background.js - Xử lý gọi Gemini API và quản lý dịch thuật ngầm

// Lắng nghe thông điệp gửi từ content script hoặc popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'translate') {
    handleTranslation(message.data)
      .then(result => sendResponse({ success: true, translations: result }))
      .catch(error => {
        console.error('Translation error:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Giữ cổng kết nối mở cho phản hồi bất đồng bộ (async)
  }
});

// Hàm chính xử lý dịch thuật
async function handleTranslation(data) {
  const { textList, contextBefore, sourceLang, targetLang, pageGlossary } = data;

  // 1. Đọc cấu hình từ bộ nhớ chrome.storage
  const settings = await chrome.storage.local.get({
    apiKey: '',
    model: 'gemini-2.0-flash',
    temperature: 0.3,
    globalGlossary: [],
    customInstruction: ''
  });

  if (!settings.apiKey) {
    throw new Error('Chưa cấu hình API Key. Vui lòng mở cài đặt Extension để thiết lập.');
  }

  // 2. Gộp từ điển toàn cục (global) và từ điển riêng của trang (page)
  const combinedGlossary = [...settings.globalGlossary, ...(pageGlossary || [])];
  
  // Loại bỏ các bản ghi trùng lặp (ưu tiên cài đặt của trang)
  const uniqueGlossary = [];
  const keysSeen = new Set();
  for (const item of combinedGlossary) {
    if (item.src && item.target && !keysSeen.has(item.src.toLowerCase())) {
      keysSeen.add(item.src.toLowerCase());
      uniqueGlossary.push(item);
    }
  }

  // 3. Xây dựng prompt kèm ngữ cảnh và từ điển
  const prompt = buildTranslationPrompt({
    textList,
    contextBefore,
    sourceLang: sourceLang || 'Tự động phát hiện',
    targetLang: targetLang || 'Tiếng Việt (Vietnamese)',
    glossary: uniqueGlossary,
    customInstruction: settings.customInstruction
  });

  // 4. Gọi API Gemini
  const modelName = settings.model || 'gemini-2.0-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${settings.apiKey}`;

  const requestBody = {
    contents: [{
      parts: [{ text: prompt }]
    }],
    generationConfig: {
      temperature: settings.temperature,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          translations: {
            type: 'ARRAY',
            items: { type: 'STRING' },
            description: 'Mảng chứa các bản dịch tương ứng chính xác với thứ tự các đoạn văn cần dịch.'
          }
        },
        required: ['translations']
      }
    }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorJson = await response.json().catch(() => ({}));
    const errorMsg = errorJson.error?.message || `HTTP error! status: ${response.status}`;
    throw new Error(errorMsg);
  }

  const jsonResult = await response.json();
  const textResponse = jsonResult.candidates?.[0]?.content?.parts?.[0]?.text;
  
  if (!textResponse) {
    throw new Error('Gemini API không trả về nội dung hợp lệ.');
  }

  try {
    const parsed = JSON.parse(textResponse);
    if (parsed && Array.isArray(parsed.translations)) {
      // Đảm bảo số lượng phần tử trả về bằng với số lượng gốc
      const results = parsed.translations;
      while (results.length < textList.length) {
        results.push('[Lỗi dịch: Thiếu dòng dịch từ API]');
      }
      return results.slice(0, textList.length);
    } else {
      throw new Error('Dữ liệu JSON không chứa mảng translations.');
    }
  } catch (parseError) {
    console.error('JSON Parse error on response:', textResponse);
    throw new Error('Mô hình không trả về đúng định dạng JSON yêu cầu.');
  }
}

// Xây dựng prompt tối ưu ngữ cảnh dịch thuật
function buildTranslationPrompt({ textList, contextBefore, sourceLang, targetLang, glossary, customInstruction }) {
  let prompt = `Bạn là một dịch giả tiểu thuyết chuyên nghiệp có kinh nghiệm lâu năm. Hãy dịch danh sách các đoạn văn dưới đây từ ngôn ngữ gốc [${sourceLang}] sang [${targetLang}].

YÊU CẦU:
1. Dịch văn phong tiểu thuyết mượt mà, tự nhiên, thuần Việt, không dịch thô cứng theo từng chữ (Word-by-word).
2. Chú ý ngữ cảnh để lựa chọn đại từ nhân xưng phù hợp (anh, cô, hắn, ta, nàng, ngươi, nó...) dựa vào mạch truyện.
3. KHÔNG dịch các từ nằm trong thẻ HTML hoặc các ký hiệu đặc biệt nếu có.
4. Trả về kết quả khớp chính xác số lượng đoạn văn cần dịch dưới dạng mảng JSON 'translations'.
${customInstruction ? `\nYÊU CẦU RIÊNG CỦA NGƯỜI DÙNG:\n${customInstruction}\n` : ''}`;

  // Bổ sung từ điển thuật ngữ
  if (glossary && glossary.length > 0) {
    prompt += `\nQUY TẮC DỊCH TÊN/THUẬT NGỮ (Ưu tiên áp dụng tuyệt đối):`;
    glossary.forEach(item => {
      prompt += `\n- "${item.src}" -> "${item.target}"`;
    });
    prompt += `\n`;
  }

  // Bổ sung ngữ cảnh trượt phía trước
  if (contextBefore && contextBefore.length > 0) {
    prompt += `\nNGỮ CẢNH TRƯỚC ĐÓ (Chỉ dùng làm tham chiếu để hiểu mạch truyện, KHÔNG dịch các câu này):\n`;
    contextBefore.forEach((text, i) => {
      prompt += `[Ngữ cảnh ${i + 1}]: ${text}\n`;
    });
  }

  // Bổ sung danh sách các đoạn cần dịch
  prompt += `\nDANH SÁCH CÁC ĐOẠN VĂN CẦN DỊCH (Hãy dịch từng đoạn tương ứng và điền vào mảng 'translations'):\n`;
  textList.forEach((text, i) => {
    prompt += `[Đoạn ${i + 1}]: ${text}\n`;
  });

  return prompt;
}
