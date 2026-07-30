const DEFAULT_SETTINGS = {
  imageFormat: 'markdown',
  includeSource: true,
  includeTitle: true,
  cleanText: true,
  ocrEnabled: false
};

const GLUCOSE_IMAGE_SELECTOR = 'img[alt="Image"][src*="drive.google.com/thumbnail"]';
const OCR_MIN_CONFIDENCE = 60;
const OCR_PARAGRAPH_MIN_CONFIDENCE = 50;
// ponytail: confidence bands replace a page-type classifier; add one only if real mixed pages escape 60-70.
const OCR_MIXED_PAGE_CONFIDENCE = 70;
let activeOcrJob = null;
let copyInProgress = false;
let toastTimer = null;

function isHako() {
  const host = window.location.hostname;
  return host.includes('ln.hako.vn') || host.includes('docln.net') || host.includes('docln.sbs');
}

function isBlogger() {
  return !!(
    document.querySelector('meta[name="generator"][content*="Blogger"]') ||
    document.querySelector('body.blogger, .post-body') ||
    window.location.hostname.includes('blogspot.')
  );
}

function isGlucose() {
  return window.location.hostname === 'glucosetl.xyz' ||
    window.location.hostname.endsWith('.glucosetl.xyz');
}

function findGlucoseContainer() {
  if (!isGlucose()) return null;
  return document.querySelector(GLUCOSE_IMAGE_SELECTOR)?.parentElement || null;
}

function isAntiScrape(element) {
  if (!element) return false;
  if (element.classList?.contains('anti-scrape') || element.classList?.contains('anti-copy')) {
    return true;
  }
  const text = element.innerText || '';
  return text.length < 150 && (
    text.includes('Stop stealing from me') ||
    text.includes('create your own stuff') ||
    text.includes('Visit:')
  );
}

function isNavigationElement(element) {
  if (!element) return false;
  const text = (element.innerText || '').toUpperCase().trim();
  const isNavigation = [
    'PREV', 'NEXT', 'TOC', 'INDEX',
    'CHƯƠNG TRƯỚC', 'CHƯƠNG SAU', 'MỤC LỤC'
  ].some(marker => text.includes(marker)) || ['<<', '>>', '<', '>'].includes(text);
  return isNavigation && (element.tagName === 'A' || !!element.querySelector?.('a'));
}

function isDonationOrSpam(url) {
  const value = String(url || '').toLowerCase();
  return value.includes('ko-fi.com') ||
    value.includes('paypal') ||
    value.includes('patreon') ||
    value.includes('subscribestar');
}

function isSpamWidget(element) {
  if (!element?.classList) return false;
  return Array.from(element.classList).some(name => {
    const value = name.toLowerCase();
    return value.includes('related') ||
      value.includes('share-') ||
      value.includes('adsbygoogle') ||
      value.includes('comentario');
  });
}

function cleanImageUrl(url) {
  if (url.includes('blogger.googleusercontent.com/img') || url.includes('blogspot.com')) {
    return url.replace(/\/w\d+-h\d+[^/]*\//, '/s0/').replace(/\/s\d+\//, '/s0/');
  }
  return url;
}

function getImageSrc(image) {
  if (!image) return '';
  for (const attribute of [
    'data-original',
    'data-src',
    'data-lazy-src',
    'data-src-retina',
    'data-original-src',
    'data-srcset'
  ]) {
    const value = image.getAttribute(attribute)?.trim();
    if (!value || value.startsWith('data:image')) continue;
    return attribute === 'data-srcset' ? value.split(/\s+/)[0] : value;
  }
  return image.currentSrc || image.src || image.getAttribute('src') || '';
}

function absoluteImageUrl(url) {
  try {
    return new URL(url, window.location.href).href;
  } catch {
    return '';
  }
}

function imageToMarkdown(url, settings) {
  if (!url || settings.imageFormat === 'hidden') return '';
  const cleaned = cleanImageUrl(url);
  return settings.imageFormat === 'text'
    ? `[Ảnh minh họa: ${cleaned}]`
    : `![Illustration](${cleaned})`;
}

function formatOcrText(value) {
  return String(value || '')
    .replace(/\r/g, '')
    .split(/\n\s*\n/)
    .map(paragraph => paragraph.replace(/\n/g, ' ').replace(/[ \t]+/g, ' ').trim())
    .filter(paragraph => paragraph && !/^\d{1,3}$/.test(paragraph))
    .join('\n\n');
}

function cleanOcrParagraph(value) {
  return formatOcrText(value)
    .replace(/(^|\s)\|(?=\s|$)/g, '$1I')
    .replace(/^\.{2}(?=[A-Za-z])/u, '...');
}

function isOcrOrnament(value) {
  const compact = String(value || '').replace(/\s/g, '');
  return compact.length >= 3 && (
    (/^[*★☆⋆✦✧◆◇·⋅•—–_=~.-]+$/u.test(compact) &&
      /[*★☆⋆✦✧◆◇·⋅•_=~]/u.test(compact)) ||
    /^-{3,}$/.test(compact)
  );
}

function isOcrFooterNoise(paragraph, result, text) {
  const { bbox } = paragraph || {};
  return !!(
    isGlucose() &&
    bbox &&
    result.width &&
    result.height &&
    paragraph.lineCount === 1 &&
    text.replace(/\s/g, '').length <= 4 &&
    bbox.x1 - bbox.x0 <= result.width * 0.05 &&
    bbox.y1 - bbox.y0 <= result.height * 0.05 &&
    bbox.x0 > result.width * 0.9 &&
    bbox.y0 > result.height * 0.9
  );
}

function isOcrSceneBreak(paragraph, index, result, text) {
  if (isOcrOrnament(text)) return true;

  const paragraphs = result.paragraphs;
  const confidence = Number(paragraph.confidence);
  const { bbox } = paragraph;
  const compact = text.replace(/\s/g, '');
  if (
    !bbox ||
    !result.width ||
    paragraph.lineCount !== 1 ||
    !Number.isFinite(confidence) ||
    confidence > 25 ||
    !/^wpe$/i.test(compact)
  ) {
    return false;
  }

  const previous = paragraphs[index - 1];
  const next = paragraphs[index + 1];
  const lineHeight = Math.max(1, bbox.y1 - bbox.y0);
  return !!(
    previous?.bbox &&
    next?.bbox &&
    Number(previous.confidence) >= 80 &&
    Number(next.confidence) >= 80 &&
    cleanOcrParagraph(previous.text).length >= 20 &&
    cleanOcrParagraph(next.text).length >= 20 &&
    Math.abs((bbox.x0 + bbox.x1) / 2 - result.width / 2) <= result.width * 0.15 &&
    bbox.y0 - previous.bbox.y1 >= lineHeight * 2 &&
    next.bbox.y0 - bbox.y1 >= lineHeight * 2
  );
}

function formatOcrParagraphs(result) {
  const output = [];
  let dropped = false;
  for (let index = 0; index < result.paragraphs.length; index++) {
    const paragraph = result.paragraphs[index];
    const text = cleanOcrParagraph(paragraph.text);
    if (!text || isOcrFooterNoise(paragraph, result, text)) continue;
    if (isOcrSceneBreak(paragraph, index, result, text)) {
      output.push('***');
      continue;
    }
    const confidence = Number(paragraph.confidence);
    if (Number.isFinite(confidence) && confidence < OCR_PARAGRAPH_MIN_CONFIDENCE) {
      dropped = true;
      continue;
    }
    output.push(paragraph.italic ? `*${text}*` : text);
  }
  return { text: output.join('\n\n'), dropped };
}

function renderLayoutBlocksToMarkdown(result, settings, url) {
  const confidence = Number(result?.confidence);
  const image = imageToMarkdown(url, settings);
  if (Number.isFinite(confidence) && confidence < OCR_MIN_CONFIDENCE) return image;

  const formatted = Array.isArray(result?.paragraphs)
    ? formatOcrParagraphs(result)
    : { text: formatOcrText(result?.text), dropped: false };
  const { text } = formatted;
  if (!text) return image;
  if (
    image &&
    (formatted.dropped ||
      (Number.isFinite(confidence) && confidence < OCR_MIXED_PAGE_CONFIDENCE))
  ) {
    return `${text}\n\n${image}`;
  }
  return text;
}

function getOcrLayout(ocrMap, ...urls) {
  for (const url of urls) {
    if (!url) continue;
    const absolute = absoluteImageUrl(url);
    if (ocrMap[url]) return ocrMap[url];
    if (absolute && ocrMap[absolute]) return ocrMap[absolute];
  }
  return null;
}

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, response => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

function requestOcrCancel(job = activeOcrJob) {
  if (!job) return Promise.resolve();
  job.cancelled = true;
  if (!job.cleanupPromise) {
    job.cleanupPromise = sendRuntimeMessage({
      target: 'background',
      action: 'ocr-cancel',
      jobId: job.id
    });
  }
  return job.cleanupPromise;
}

function collectImageUrls(container) {
  if (!container) return [];
  const images = [];
  if (container.matches?.('img')) images.push(container);
  images.push(...container.querySelectorAll('img'));

  const urls = images
    .filter(image => !image.closest('.related, .share-, .adsbygoogle, [class*="spam"]'))
    .filter(image => !isAntiScrape(image.parentElement))
    .map(getImageSrc)
    .map(absoluteImageUrl)
    .filter(url => url &&
      !isDonationOrSpam(url) &&
      !url.includes('responsive/sprite_v1_6.css.svg'));

  return [...new Set(urls)];
}

async function runOcrForImages(urls) {
  const job = {
    id: crypto.randomUUID(),
    cancelled: false,
    cleanupPromise: null,
    fatalError: '',
    errors: []
  };
  activeOcrJob = job;
  const results = {};
  showProgressOverlay(urls.length);

  try {
    for (let index = 0; index < urls.length; index++) {
      if (job.cancelled) break;
      const sourceUrl = urls[index];

      try {
        const response = await sendRuntimeMessage({
          target: 'background',
          action: 'ocr-recognize',
          jobId: job.id,
          url: sourceUrl
        });

        if (job.cancelled) break;
        if (response?.jobId && response.jobId !== job.id) {
          job.fatalError = 'Phản hồi OCR không khớp phiên làm việc.';
          break;
        }
        if (['OCR_BUSY', 'OCR_CANCELLED', 'STALE_JOB'].includes(response?.code)) {
          job.fatalError = response.error || 'OCR đang bận ở tab khác.';
          break;
        }
        if (response?.cancelled) {
          job.fatalError = response.error || 'OCR đã bị dừng ngoài ý muốn.';
          break;
        }
        if (!response?.success) {
          throw new Error(response?.error || 'OCR thất bại');
        }
        results[sourceUrl] = {
          text: response.text || '',
          confidence: response.confidence,
          paragraphs: response.paragraphs,
          width: response.width,
          height: response.height
        };
      } catch (error) {
        if (job.cancelled) break;
        job.errors.push({ url: sourceUrl, error: error.message || String(error) });
        results[sourceUrl] = { text: '', error: error.message || String(error) };
      }

      updateProgressOverlay(index + 1, urls.length, job.errors.length);
    }
  } finally {
    try {
      if (job.cleanupPromise) {
        await job.cleanupPromise;
      } else {
        await sendRuntimeMessage({
          target: 'background',
          action: 'ocr-finish',
          jobId: job.id
        });
      }
    } catch (error) {
      console.warn('NovelCopy OCR cleanup failed:', error);
    }
    hideProgressOverlay();
    activeOcrJob = null;
  }

  return {
    cancelled: job.cancelled,
    fatalError: job.fatalError,
    errors: job.errors,
    results
  };
}

async function renderChildren(element, settings, ocrMap) {
  let output = '';
  for (const child of element.childNodes) {
    output += await renderNode(child, settings, ocrMap);
  }
  return output;
}

async function renderNode(node, settings, ocrMap) {
  if (node.nodeType === Node.TEXT_NODE) {
    return (node.nodeValue || '').replace(/\s+/g, ' ');
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return '';

  const tag = node.tagName;
  if (['SCRIPT', 'STYLE', 'INPUT', 'BUTTON', 'NOSCRIPT', 'IFRAME'].includes(tag)) return '';
  if (isAntiScrape(node) || isNavigationElement(node) || isSpamWidget(node)) return '';

  if (tag === 'IMG') {
    const url = absoluteImageUrl(getImageSrc(node));
    if (!url || isDonationOrSpam(url) || url.includes('responsive/sprite_v1_6.css.svg')) return '';
    if (!settings.ocrEnabled) return `\n\n${imageToMarkdown(url, settings)}\n\n`;
    return `\n\n${renderLayoutBlocksToMarkdown(getOcrLayout(ocrMap, url), settings, url)}\n\n`;
  }

  if (tag === 'BR') return '\n';
  if (tag === 'HR') return '\n\n---\n\n';

  const inner = await renderChildren(node, settings, ocrMap);
  const trimmed = inner.trim();
  if (!trimmed) return '';

  if (/^H[1-6]$/.test(tag)) {
    return `\n\n${'#'.repeat(Number(tag[1]))} ${trimmed}\n\n`;
  }
  if (tag === 'STRONG' || tag === 'B') return `**${trimmed}**`;
  if (tag === 'EM' || tag === 'I') return `*${trimmed}*`;

  if (tag === 'A') {
    if (node.querySelector('img')) return inner;
    const href = node.href || '';
    return href && !isDonationOrSpam(href) ? `[${trimmed}](${href})` : trimmed;
  }

  if (['P', 'DIV', 'SECTION', 'ARTICLE', 'LI', 'BLOCKQUOTE'].includes(tag)) {
    return `\n\n${trimmed}\n\n`;
  }

  const isBold = node.style?.fontWeight === 'bold' || Number.parseInt(node.style?.fontWeight, 10) >= 600;
  const isItalic = node.style?.fontStyle === 'italic';
  let formatted = inner;
  if (isBold) formatted = `**${formatted.trim()}**`;
  if (isItalic) formatted = `*${formatted.trim()}*`;
  return formatted;
}

async function convertNodeToMarkdown(node, settings, ocrMap = {}) {
  return (await renderNode(node, settings, ocrMap))
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function getGlucoseTitles() {
  return {
    novelTitle: document.querySelector('.text-4xl.font-bold')?.innerText.trim() || '',
    volumeTitle: document.querySelector('.font-serif.text-3xl')?.innerText.trim() || '',
    chapterTitle: document.querySelector('.text-3xl.font-bold:not(.font-serif)')?.innerText.trim() ||
      document.title.split('-')[0].trim()
  };
}

const Parsers = {
  glucose: {
    detect: () => !!findGlucoseContainer(),
    getContainer: findGlucoseContainer,
    parse: async (settings, ocrMap) => ({
      titleInfo: getGlucoseTitles(),
      contentMarkdown: await convertNodeToMarkdown(findGlucoseContainer(), settings, ocrMap)
    })
  },

  hako: {
    detect: isHako,
    getContainer: () => document.getElementById('chapter-content'),
    parse: async (settings, ocrMap) => {
      const container = document.getElementById('chapter-content');
      if (!container) return null;
      const titleInfo = { novelTitle: '', volumeTitle: '', chapterTitle: '' };
      const breadcrumb = document.querySelector('.rd_sdc_breadcrumb, .breadcrumb');
      const items = breadcrumb?.querySelectorAll('li, a') || [];
      if (items.length >= 3) {
        titleInfo.novelTitle = items[items.length - 3].innerText.trim();
        titleInfo.volumeTitle = items[items.length - 2].innerText.trim();
        titleInfo.chapterTitle = items[items.length - 1].innerText.trim();
      }
      titleInfo.chapterTitle ||= document.querySelector('.chapter-name, .title-top h2')?.innerText.trim() || '';
      titleInfo.novelTitle ||= document.querySelector('.series-name a, .series-name')?.innerText.trim() || '';
      return {
        titleInfo,
        contentMarkdown: await convertNodeToMarkdown(container, settings, ocrMap)
      };
    }
  },

  blogger: {
    detect: isBlogger,
    getContainer: () => document.querySelector('.post-body, .entry-content'),
    parse: async (settings, ocrMap) => {
      const container = document.querySelector('.post-body, .entry-content');
      if (!container) return null;
      const parent = container.closest('article, .post, .blog-post, #main') || document;
      const title = parent.querySelector('.entry-title, .post-title')?.innerText.trim() ||
        document.title.split('-')[0].trim();
      return {
        titleInfo: { novelTitle: '', volumeTitle: '', chapterTitle: title },
        contentMarkdown: await convertNodeToMarkdown(container, settings, ocrMap)
      };
    }
  },

  generic: {
    detect: () => true,
    getContainer: () => {
      const containers = document.querySelectorAll(
        'article, .entry-content, .post-content, #chapter-content, .chapter-content, .chapter-c, main, div'
      );
      let best = null;
      let highestParagraphCount = 0;
      for (const container of containers) {
        const count = container.querySelectorAll('p').length;
        if (count > highestParagraphCount) {
          best = container;
          highestParagraphCount = count;
        }
      }
      return best && highestParagraphCount >= 3 ? best : document.body;
    },
    parse: async (settings, ocrMap) => {
      const container = Parsers.generic.getContainer();
      const parent = container.closest('article, .post, .blog-post, #main') || document;
      const title = parent.querySelector('h1, h2.chapter-title, .entry-title, .post-title')?.innerText.trim() ||
        document.title.trim();
      return {
        titleInfo: { novelTitle: '', volumeTitle: '', chapterTitle: title },
        contentMarkdown: await convertNodeToMarkdown(container, settings, ocrMap)
      };
    }
  }
};

function selectParser() {
  if (Parsers.glucose.detect()) return Parsers.glucose;
  if (Parsers.hako.detect()) return Parsers.hako;
  if (Parsers.blogger.detect()) return Parsers.blogger;
  return Parsers.generic;
}

async function loadSettings() {
  return new Promise(resolve => chrome.storage.sync.get(DEFAULT_SETTINGS, resolve));
}

async function copyNovelContent(customContainer = null) {
  if (copyInProgress) {
    showToast('Đang xử lý, hãy chờ hoặc bấm Hủy OCR.', true);
    return;
  }

  copyInProgress = true;
  try {
    const settings = await loadSettings();
    const parser = selectParser();
    const container = customContainer || parser.getContainer();
    if (!container) {
      showToast('Không tìm thấy vùng nội dung truyện.', true);
      return;
    }

    let ocrMap = {};
    let ocrErrors = [];

    if (settings.ocrEnabled) {
      const urls = collectImageUrls(container);
      if (urls.length) {
        const ocr = await runOcrForImages(urls);
        if (ocr.fatalError) {
          showToast(ocr.fatalError, true);
          return;
        }
        if (ocr.cancelled) {
          showToast('Đã hủy OCR.', true);
          return;
        }
        ocrMap = ocr.results;
        ocrErrors = ocr.errors;
      }
    }

    const parsed = customContainer
      ? {
          titleInfo: { novelTitle: '', volumeTitle: '', chapterTitle: document.title.split('-')[0].trim() },
          contentMarkdown: await convertNodeToMarkdown(customContainer, settings, ocrMap)
        }
      : await parser.parse(settings, ocrMap);

    if (!parsed) {
      showToast('Không tìm thấy vùng nội dung truyện.', true);
      return;
    }

    const titleInfo = parsed.titleInfo;
    titleInfo.chapterTitle = titleInfo.chapterTitle
      .replace(/^\[\s*(ENG|VIET|RAW|TL|LN|WN|ENGLISH|ENG[- ]TL)\s*\]\s*/i, '')
      .trim();

    let markdown = '';
    if (settings.includeSource) markdown += `Nguồn: ${window.location.href}\n\n`;
    if (settings.includeTitle) {
      if (titleInfo.novelTitle) markdown += `# ${titleInfo.novelTitle}\n`;
      if (titleInfo.volumeTitle) markdown += `## ${titleInfo.volumeTitle}\n`;
      if (titleInfo.chapterTitle) markdown += `### ${titleInfo.chapterTitle}\n`;
      markdown += '\n---\n\n';
    }
    markdown += parsed.contentMarkdown;

    if (settings.cleanText) {
      markdown = markdown.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    }

    try {
      await navigator.clipboard.writeText(markdown);
      saveToHistory(titleInfo, markdown);
      showToast(ocrErrors.length
        ? `Đã copy; ${ocrErrors.length} ảnh OCR lỗi đã dùng phương án dự phòng.`
        : 'Sao chép nội dung thành công!', ocrErrors.length > 0);
    } catch (error) {
      console.error('NovelCopy clipboard error:', error);
      showToast('Không thể ghi vào clipboard.', true);
    }
  } catch (error) {
    console.error('NovelCopy copy error:', error);
    showToast('Không thể xử lý nội dung trang.', true);
  } finally {
    copyInProgress = false;
  }
}

function saveToHistory(titleInfo, markdown) {
  const title = [
    titleInfo.novelTitle,
    titleInfo.volumeTitle,
    titleInfo.chapterTitle
  ].filter(Boolean).join(' - ') || document.title || 'Chương truyện không tên';

  const entry = {
    id: Date.now().toString(),
    title,
    markdown,
    url: window.location.href,
    time: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
  };

  chrome.storage.local.get({ copyHistory: [] }, result => {
    chrome.storage.local.set({ copyHistory: [entry, ...(result.copyHistory || [])].slice(0, 5) });
  });
}

function showProgressOverlay(total) {
  hideProgressOverlay(true);
  const overlay = document.createElement('div');
  overlay.className = 'novelcopy-progress-overlay';
  overlay.innerHTML = `
    <div class="novelcopy-progress-card">
      <div class="novelcopy-progress-title">Đang quét chữ OCR...</div>
      <div class="novelcopy-progress-bar-container">
        <div class="novelcopy-progress-bar-fill"></div>
      </div>
      <div class="novelcopy-progress-stats">
        <span class="novelcopy-progress-percent">0%</span>
        <span class="novelcopy-progress-count">0/${total} ảnh</span>
      </div>
      <button class="novelcopy-progress-cancel-btn" type="button">Hủy</button>
    </div>
  `;

  overlay.querySelector('.novelcopy-progress-cancel-btn').addEventListener('click', () => {
    if (!activeOcrJob || activeOcrJob.cancelled) return;
    const button = overlay.querySelector('.novelcopy-progress-cancel-btn');
    button.disabled = true;
    button.textContent = 'Đang hủy...';
    requestOcrCancel().catch(() => {});
  });

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('show'));
}

function updateProgressOverlay(completed, total, errorCount) {
  const overlay = document.querySelector('.novelcopy-progress-overlay');
  if (!overlay) return;
  const percent = Math.round((completed / total) * 100);
  overlay.querySelector('.novelcopy-progress-bar-fill').style.width = `${percent}%`;
  overlay.querySelector('.novelcopy-progress-percent').textContent = `${percent}%`;
  overlay.querySelector('.novelcopy-progress-count').textContent =
    `${completed}/${total} ảnh${errorCount ? ` · ${errorCount} lỗi` : ''}`;
}

function hideProgressOverlay(immediate = false) {
  const overlay = document.querySelector('.novelcopy-progress-overlay');
  if (!overlay) return;
  if (immediate) {
    overlay.remove();
    return;
  }
  overlay.classList.remove('show');
  setTimeout(() => overlay.remove(), 300);
}

function showToast(message, isError = false) {
  document.querySelector('.novelcopy-toast')?.remove();
  if (toastTimer) clearTimeout(toastTimer);

  const toast = document.createElement('div');
  toast.className = 'novelcopy-toast';
  if (isError) {
    toast.style.borderColor = 'rgba(239, 68, 68, 0.4)';
    toast.style.background = 'rgba(28, 10, 10, 0.95)';
  }
  const icon = document.createElement('span');
  icon.className = 'novelcopy-toast-icon';
  icon.textContent = isError ? '⚠' : '✓';
  toast.append(icon, document.createTextNode(` ${message}`));
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));

  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 400);
  }, 3000);
}

const WHITELISTED_DOMAINS = [
  'ln.hako.vn',
  'docln.net',
  'docln.sbs',
  'novelupdates.com',
  'blogspot.com',
  'glucosetl.xyz'
];

function isWhitelisted() {
  const host = window.location.hostname;
  return WHITELISTED_DOMAINS.some(domain => {
    if (domain === 'blogspot.com') return host.includes('blogspot.');
    return host === domain || host.endsWith(`.${domain}`);
  });
}

function shouldShowFAB() {
  if (!isWhitelisted()) return false;
  if (isGlucose()) return !!findGlucoseContainer();
  if (isHako()) return !!document.getElementById('chapter-content');
  if (isBlogger()) {
    return !!document.querySelector('.post-body, .entry-content') && window.location.pathname.length > 5;
  }
  return true;
}

function injectFAB() {
  if (window.self !== window.top || document.querySelector('.novelcopy-fab') || !shouldShowFAB()) return;
  const button = document.createElement('button');
  button.className = 'novelcopy-fab';
  button.type = 'button';
  button.title = 'Copy nội dung truyện';
  button.innerHTML = '<span class="novelcopy-fab-icon">📋</span>';
  button.addEventListener('click', event => {
    event.stopPropagation();
    copyNovelContent();
  });
  document.body.appendChild(button);
}

let manualSelectActive = false;
let highlightedElement = null;
let manualSelectBanner = null;

function startManualSelect() {
  if (manualSelectActive) return;
  manualSelectActive = true;
  document.querySelector('.novelcopy-fab')?.style.setProperty('display', 'none');

  manualSelectBanner = document.createElement('div');
  manualSelectBanner.className = 'novelcopy-banner';
  manualSelectBanner.innerHTML = `
    <span>🎯 Rê chuột và click vào vùng nội dung cần copy.</span>
    <button class="novelcopy-banner-btn" type="button">Hủy (ESC)</button>
  `;
  manualSelectBanner.querySelector('button').addEventListener('click', stopManualSelect);
  document.body.appendChild(manualSelectBanner);

  document.addEventListener('mouseover', handleMouseOver);
  document.addEventListener('mouseout', handleMouseOut);
  document.addEventListener('click', handleSelectClick, true);
  document.addEventListener('keyup', handleEscapeKey);
}

function stopManualSelect() {
  if (!manualSelectActive) return;
  manualSelectActive = false;
  const fab = document.querySelector('.novelcopy-fab');
  if (fab) fab.style.display = 'flex';
  manualSelectBanner?.remove();
  manualSelectBanner = null;
  highlightedElement?.classList.remove('novelcopy-highlight');
  highlightedElement = null;
  document.removeEventListener('mouseover', handleMouseOver);
  document.removeEventListener('mouseout', handleMouseOut);
  document.removeEventListener('click', handleSelectClick, true);
  document.removeEventListener('keyup', handleEscapeKey);
}

function isNovelCopyUi(element) {
  return !!element.closest('.novelcopy-banner, .novelcopy-fab, .novelcopy-toast, .novelcopy-progress-overlay');
}

function handleMouseOver(event) {
  if (isNovelCopyUi(event.target)) return;
  highlightedElement?.classList.remove('novelcopy-highlight');
  highlightedElement = event.target;
  highlightedElement.classList.add('novelcopy-highlight');
}

function handleMouseOut(event) {
  if (highlightedElement !== event.target) return;
  highlightedElement.classList.remove('novelcopy-highlight');
  highlightedElement = null;
}

function handleSelectClick(event) {
  event.preventDefault();
  event.stopPropagation();
  if (isNovelCopyUi(event.target)) return;
  const target = event.target;
  stopManualSelect();
  copyNovelContent(target);
}

function handleEscapeKey(event) {
  if (event.key === 'Escape') stopManualSelect();
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.target === 'content' && message.action === 'start-manual-select') {
    startManualSelect();
    sendResponse({ success: true });
  }
  return false;
});

window.addEventListener('pagehide', () => {
  if (activeOcrJob) requestOcrCancel().catch(() => {});
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectFAB);
} else {
  injectFAB();
}
