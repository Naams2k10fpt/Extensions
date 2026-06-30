// Lắng nghe phím tắt từ người dùng
chrome.commands.onCommand.addListener((command) => {
  if (command === "activate-translation") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { action: "start-capture" });
      }
    });
  }
});

// Lắng nghe tin nhắn từ content script và popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "capture-tab") {
    // Chụp ảnh màn hình visible của tab hiện tại
    chrome.tabs.captureVisibleTab(null, { format: "png" }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ success: true, dataUrl: dataUrl });
      }
    });
    return true; // Giữ kết nối async cho sendResponse
  }

  if (request.action === "translate-image") {
    // Gọi API dịch bằng Gemini
    handleGeminiTranslation(request.imageData, request.options)
      .then((data) => sendResponse({ success: true, data: data }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true; // Giữ kết nối async
  }
});

// Hàm gọi API Gemini
async function handleGeminiTranslation(base64Image, options) {
  // Lấy API key và cấu hình từ storage
  const config = await new Promise((resolve) => {
    chrome.storage.sync.get(
      {
        apiKey: "",
        model: "gemini-2.5-flash",
        sourceLang: "Auto",
        targetLang: "Vietnamese",
      },
      (items) => resolve(items)
    );
  });

  const apiKey = config.apiKey;
  const model = config.model || "gemini-2.5-flash";
  const sourceLang = options.sourceLang || config.sourceLang;
  const targetLang = options.targetLang || config.targetLang;

  if (!apiKey) {
    throw new Error("API Key chưa được cài đặt. Hãy mở Extension Popup để cài đặt API Key.");
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  // Chuẩn bị system instruction dựa trên ngôn ngữ nguồn và đích
  const systemInstruction = `You are a professional Manga Translator.
Your task is to analyze the provided cropped image from a manga panel, perform OCR to detect all text blocks (like speech bubbles, narrations, sound effects, or background text), and translate them.
Source Language: ${sourceLang}
Target Language: ${targetLang}

For each text block detected:
1. Locate its bounding box relative to the image. Provide the coordinates normalized on a scale from 0 to 1000 (y_min, x_min, y_max, x_max, where 0 is top/left, and 1000 is bottom/right of the cropped image).
2. Extract the original text in the source language.
3. Translate the text into natural, contextual, and flowing ${targetLang} suitable for a manga translation.
Return the result strictly as a JSON object matching this schema:
{
  "blocks": [
    {
      "boundingBox": [y_min, x_min, y_max, x_max],
      "originalText": "...",
      "translatedText": "..."
    }
  ]
}
Do not include any markdown formatting (like \`\`\`json ... \`\`\`), HTML or conversational text. Return ONLY the raw JSON string.`;

  // Loại bỏ tiền tố "data:image/png;base64," nếu có
  const cleanBase64 = base64Image.replace(/^data:image\/\w+;base64,/, "");

  const requestBody = {
    systemInstruction: {
      parts: [
        {
          text: systemInstruction,
        },
      ],
    },
    contents: [
      {
        parts: [
          {
            inlineData: {
              mimeType: "image/png",
              data: cleanBase64,
            },
          },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          blocks: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                boundingBox: {
                  type: "ARRAY",
                  items: {
                    type: "INTEGER",
                  },
                  description: "Normalized coordinates [y_min, x_min, y_max, x_max] from 0 to 1000",
                },
                originalText: {
                  type: "STRING",
                  description: "Original text in source language",
                },
                translatedText: {
                  type: "STRING",
                  description: "Translated text in target language",
                },
              },
              required: ["boundingBox", "originalText", "translatedText"],
            },
          },
        },
        required: ["blocks"],
      },
    },
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const message = errorData?.error?.message || `HTTP error! status: ${response.status}`;
    throw new Error(`Lỗi kết nối Gemini API: ${message}`);
  }

  const result = await response.json();
  
  if (!result.candidates || result.candidates.length === 0) {
    throw new Error("Không nhận được câu trả lời từ Gemini API.");
  }

  const textResponse = result.candidates[0].content.parts[0].text;
  
  try {
    const parsedData = JSON.parse(textResponse);
    return parsedData;
  } catch (e) {
    console.error("Failed to parse JSON response:", textResponse);
    throw new Error("Phản hồi từ AI không đúng định dạng JSON yêu cầu.");
  }
}
