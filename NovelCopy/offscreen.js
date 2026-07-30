const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_STYLE_PIXELS = 12_000_000;
const ITALIC_SLOPE = 0.125;
const ITALIC_GAIN = 1.05;
const ITALIC_MIN_LETTERS = 12;
let workerPromise = null;
let activeJobId = null;
let stoppedJobId = null;

async function getWorker() {
  if (!workerPromise) {
    workerPromise = Tesseract.createWorker('eng', 1, {
      workerPath: chrome.runtime.getURL('lib/tesseract/worker.min.js'),
      corePath: chrome.runtime.getURL('lib/tesseract/tesseract-core.wasm.js'),
      langPath: chrome.runtime.getURL('lib/tesseract/lang/'),
      workerBlobURL: false
    });
  }
  return workerPromise;
}

async function fetchImage(url) {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('URL ảnh không hợp lệ.');
  }

  const response = await fetch(parsed.href, {
    credentials: 'omit',
    redirect: 'follow'
  });
  if (!response.ok) throw new Error(`Không tải được ảnh (${response.status}).`);

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.startsWith('image/')) {
    throw new Error(`Phản hồi không phải ảnh (${contentType || 'không rõ'}).`);
  }

  const contentLength = Number(response.headers.get('content-length'));
  if (contentLength > MAX_IMAGE_BYTES) {
    throw new Error('Ảnh vượt quá 15 MB.');
  }

  const blob = await response.blob();
  if (!blob.size || blob.size > MAX_IMAGE_BYTES) {
    throw new Error('Ảnh rỗng hoặc vượt quá 15 MB.');
  }
  return blob;
}

function italicProjectionGain(image, bbox) {
  if (!image?.data || !bbox) return 0;
  const width = Math.max(0, Math.floor(bbox.x1 - bbox.x0));
  const height = Math.max(0, Math.floor(bbox.y1 - bbox.y0));
  if (width < 20 || height < 10) return 0;

  let background = 0;
  let samples = 0;
  for (let y = 0; y < height; y += 4) {
    for (let x = 0; x < width; x += 4) {
      const index = ((bbox.y0 + y) * image.width + bbox.x0 + x) * 4;
      background += image.data[index] + image.data[index + 1] + image.data[index + 2];
      samples++;
    }
  }

  const lightText = background / Math.max(samples * 3, 1) < 128;
  const margin = Math.ceil(height * ITALIC_SLOPE / 2) + 2;
  const straight = new Float64Array(width + margin * 2);
  const slanted = new Float64Array(width + margin * 2);
  let ink = 0;

  for (let y = 0; y < height; y++) {
    const shift = Math.round(ITALIC_SLOPE * (y - height / 2));
    for (let x = 0; x < width; x++) {
      const index = ((bbox.y0 + y) * image.width + bbox.x0 + x) * 4;
      const luminance = (image.data[index] + image.data[index + 1] + image.data[index + 2]) / 3;
      const weight = lightText ? Math.max(0, luminance - 96) : Math.max(0, 159 - luminance);
      if (!weight) continue;
      straight[x + margin] += weight;
      slanted[x + margin + shift] += weight;
      ink += weight;
    }
  }

  if (!ink) return 0;
  const score = columns => columns.reduce((sum, value) => sum + value * value, 0) / ink;
  return score(slanted) / Math.max(score(straight), 1);
}

function isLikelyItalicParagraph(paragraph, image) {
  const words = (paragraph.lines || []).flatMap(line => line.words || []);
  if (words.length && words.filter(word => word.is_italic).length / words.length >= 0.6) {
    return true;
  }

  let checkedLetters = 0;
  let italicLetters = 0;
  for (const line of paragraph.lines || []) {
    const letters = (line.text?.match(/[A-Za-z]/g) || []).length;
    if (letters < ITALIC_MIN_LETTERS) continue;
    checkedLetters += letters;
    if (italicProjectionGain(image, line.bbox) >= ITALIC_GAIN) {
      italicLetters += letters;
    }
  }
  return checkedLetters >= ITALIC_MIN_LETTERS && italicLetters / checkedLetters >= 0.6;
}

async function readImagePixels(blob) {
  const bitmap = await createImageBitmap(blob);
  try {
    if (bitmap.width * bitmap.height > MAX_STYLE_PIXELS) {
      return { width: bitmap.width, height: bitmap.height, data: null };
    }
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0);
    return {
      width: bitmap.width,
      height: bitmap.height,
      data: context.getImageData(0, 0, bitmap.width, bitmap.height).data
    };
  } finally {
    bitmap.close();
  }
}

async function compactOcrResult(data, blob) {
  if (!Array.isArray(data.blocks)) return { paragraphs: null, width: 0, height: 0 };

  let image = null;
  try {
    image = await readImagePixels(blob);
  } catch {
    // Text still works if this browser cannot expose pixels for style detection.
  }

  const paragraphs = data.blocks.flatMap(block => block.paragraphs || []).map(paragraph => ({
    text: paragraph.text || '',
    confidence: paragraph.confidence,
    bbox: paragraph.bbox,
    lineCount: paragraph.lines?.length || 0,
    // ponytail: conservative slant heuristic; replace with a font model only if another site needs it.
    italic: !!image && Number(paragraph.confidence) >= 50 && isLikelyItalicParagraph(paragraph, image)
  }));

  return {
    paragraphs,
    width: image?.width || 0,
    height: image?.height || 0
  };
}

async function recognize(jobId, url) {
  if (stoppedJobId === jobId) {
    const error = new Error('OCR đã bị hủy.');
    error.code = 'OCR_CANCELLED';
    throw error;
  }
  if (activeJobId && activeJobId !== jobId) {
    const error = new Error('OCR đang bận.');
    error.code = 'OCR_BUSY';
    throw error;
  }
  activeJobId = jobId;

  const [worker, blob] = await Promise.all([getWorker(), fetchImage(url)]);
  const { data } = await worker.recognize(blob);
  const layout = await compactOcrResult(data, blob);
  return {
    success: true,
    jobId,
    text: data.text || '',
    confidence: data.confidence,
    ...layout
  };
}

async function stopWorker(jobId) {
  if (activeJobId && activeJobId !== jobId) {
    return {
      success: false,
      code: 'STALE_JOB',
      jobId,
      activeJobId
    };
  }
  stoppedJobId = jobId;
  activeJobId = null;
  const pendingWorker = workerPromise;
  workerPromise = null;
  if (pendingWorker) {
    const worker = await pendingWorker;
    await worker.terminate();
  }
  return { success: true, jobId };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.target !== 'offscreen') return false;

  if (message.action === 'ocr-recognize') {
    recognize(message.jobId, message.url)
      .then(sendResponse)
      .catch(error => sendResponse({
        success: false,
        code: error.code,
        jobId: message.jobId,
        activeJobId,
        cancelled: activeJobId !== message.jobId,
        error: error.message
      }));
    return true;
  }

  if (message.action === 'ocr-stop') {
    stopWorker(message.jobId)
      .then(sendResponse)
      .catch(error => sendResponse({ success: false, jobId: message.jobId, error: error.message }));
    return true;
  }

  return false;
});
