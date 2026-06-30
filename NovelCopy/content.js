// Default Settings
const DEFAULT_SETTINGS = {
  imageFormat: 'markdown',
  includeSource: true,
  includeTitle: true,
  cleanText: true
};

// Check page types
function isHako() {
  const host = window.location.hostname;
  return host.includes('ln.hako.vn') || host.includes('docln.net') || host.includes('docln.sbs');
}

function isBlogger() {
  const hasBloggerMeta = document.querySelector('meta[name="generator"][content*="Blogger"]');
  const hasBloggerBody = document.querySelector('body.blogger') || document.querySelector('.post-body');
  const isBlogspotUrl = window.location.hostname.includes('blogspot.com');
  return !!(hasBloggerMeta || hasBloggerBody || isBlogspotUrl);
}

// Helper to filter out anti-scrape elements
function isAntiScrape(el) {
  if (!el) return false;
  if (el.classList && (el.classList.contains('anti-scrape') || el.classList.contains('anti-copy'))) {
    return true;
  }
  const text = el.innerText || '';
  // Check for common warning phrases from typical translation blogs
  if (
    text.includes("Stop stealing from me") || 
    text.includes("create your own stuff") || 
    text.includes("Visit:")
  ) {
    if (text.length < 150) {
      return true;
    }
  }
  return false;
}

// Helper to filter out navigation links
function isNavigationElement(el) {
  if (!el) return false;
  const text = (el.innerText || '').toUpperCase().trim();
  
  // Look for nav markers
  const isNavText = 
    text.includes("PREV") || 
    text.includes("NEXT") || 
    text.includes("TOC") || 
    text.includes("INDEX") ||
    text.includes("CHƯƠNG TRƯỚC") || 
    text.includes("CHƯƠNG SAU") || 
    text.includes("MỤC LỤC") ||
    text === "<<" || text === ">>" || text === "<" || text === ">";

  if (isNavText) {
    // If the element itself is a link or contains links, it's likely a nav block
    if (el.tagName === 'A' || el.querySelector('a')) {
      return true;
    }
  }
  return false;
}

// Helper to filter out donation links (Ko-fi, Patreon, PayPal...)
function isDonationOrSpam(url) {
  if (!url) return false;
  const lowerUrl = url.toLowerCase();
  return lowerUrl.includes('ko-fi.com') || 
         lowerUrl.includes('paypal') || 
         lowerUrl.includes('patreon') ||
         lowerUrl.includes('subscribestar');
}

// Clean and convert DOM to Markdown
function convertNodeToMarkdown(node, settings) {
  let markdown = '';
  
  // Traverse nodes
  const children = Array.from(node.childNodes);
  
  for (let child of children) {
    // Skip scripts, styles, inputs, etc.
    if (child.nodeType === Node.ELEMENT_NODE) {
      const tagName = child.tagName;
      if (['SCRIPT', 'STYLE', 'INPUT', 'BUTTON', 'NOSCRIPT', 'IFRAME'].includes(tagName)) {
        continue;
      }
      
      // Filter out anti-scrape and navigation
      if (isAntiScrape(child) || isNavigationElement(child)) {
        continue;
      }
      
      // If it's a heading
      if (/^H[1-6]$/.test(tagName)) {
        const level = tagName[1];
        const text = child.innerText.trim();
        if (text) {
          markdown += '\n\n' + '#'.repeat(level) + ' ' + text + '\n\n';
        }
        continue;
      }
      
      // If it's an image
      if (tagName === 'IMG') {
        const url = child.dataset.src || child.src;
        if (isDonationOrSpam(url)) {
          continue;
        }
        if (url && !url.includes('responsive/sprite_v1_6.css.svg')) { // Ignore Blogger icons
          const cleanedUrl = cleanImageUrl(url);
          if (settings.imageFormat === 'markdown') {
            markdown += `\n\n![Illustration](${cleanedUrl})\n\n`;
          } else if (settings.imageFormat === 'text') {
            markdown += `\n\n[Ảnh minh họa: ${cleanedUrl}]\n\n`;
          }
        }
        continue;
      }
      
      // If it's an anchor wrapped image (Blogger style)
      if (tagName === 'A' && child.querySelector('img')) {
        const img = child.querySelector('img');
        const url = child.href || img.dataset.src || img.src;
        const imgSrc = img.dataset.src || img.src;
        if (isDonationOrSpam(url) || isDonationOrSpam(imgSrc)) {
          continue;
        }
        if (url) {
          const cleanedUrl = cleanImageUrl(url);
          if (settings.imageFormat === 'markdown') {
            markdown += `\n\n![Illustration](${cleanedUrl})\n\n`;
          } else if (settings.imageFormat === 'text') {
            markdown += `\n\n[Ảnh minh họa: ${cleanedUrl}]\n\n`;
          }
        }
        continue;
      }
      
      // Block level elements (div, p)
      if (tagName === 'P' || tagName === 'DIV') {
        // Double check inner content for image
        if (child.tagName === 'DIV' && child.querySelector('img')) {
          markdown += convertNodeToMarkdown(child, settings);
          continue;
        }
        
        let pText = parseFormattedText(child, settings);
        if (pText) {
          markdown += pText + '\n\n';
        }
        continue;
      }
      
      // For spans or custom tags containing inline nodes
      let text = parseFormattedText(child, settings);
      if (text) {
        markdown += text + ' ';
      }
      
    } else if (child.nodeType === Node.TEXT_NODE) {
      let text = child.nodeValue.replace(/\s+/g, ' ');
      if (text && text !== ' ') {
        markdown += text;
      }
    }
  }
  
  return markdown;
}

// Clean Blogger/Google image URLs to get high res or original if possible
function cleanImageUrl(url) {
  // E.g. Blogger image URLs might have sizes like /w1200-h630-p-k-no-nu/ or /s16000/
  // Resolving to /s1600/ or /s0/ gives original resolution
  if (url.includes('blogger.googleusercontent.com/img') || url.includes('blogspot.com')) {
    return url.replace(/\/w\d+-h\d+[^/]*\//, '/s0/').replace(/\/s\d+\//, '/s0/');
  }
  return url;
}

// Parse inline elements (b, i, strong, em, span) to Markdown formatted text
function parseFormattedText(element, settings) {
  if (isAntiScrape(element) || isNavigationElement(element)) {
    return '';
  }
  
  let html = element.innerHTML || '';
  if (!html.trim()) return '';
  
  // Create a temporary element to manipulate
  let temp = document.createElement('div');
  temp.innerHTML = html;
  
  // Recursively process formats
  function process(node) {
    let result = '';
    const children = Array.from(node.childNodes);
    for (let child of children) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const tag = child.tagName;
        if (tag === 'BR') {
          result += '\n';
        } else if (tag === 'STRONG' || tag === 'B') {
          const inner = process(child).trim();
          result += inner ? `**${inner}**` : '';
        } else if (tag === 'EM' || tag === 'I') {
          const inner = process(child).trim();
          result += inner ? `*${inner}*` : '';
        } else if (tag === 'SPAN' || tag === 'FONT') {
          result += process(child);
        } else if (tag === 'A') {
          const href = child.href || '';
          if (isDonationOrSpam(href)) {
            continue;
          }
          // Check if this anchor wraps an image
          const img = child.querySelector('img');
          if (img) {
            const url = child.href || img.dataset.src || img.src;
            const imgSrc = img.dataset.src || img.src;
            if (!isDonationOrSpam(url) && !isDonationOrSpam(imgSrc)) {
              const cleanedUrl = cleanImageUrl(url);
              if (settings.imageFormat === 'markdown') {
                result += `\n\n![Illustration](${cleanedUrl})\n\n`;
              } else if (settings.imageFormat === 'text') {
                result += `\n\n[Ảnh minh họa: ${cleanedUrl}]\n\n`;
              }
            }
            continue;
          }
          const inner = process(child).trim();
          if (inner) {
            result += `[${inner}](${href})`;
          }
        } else if (tag === 'IMG') {
          const url = child.dataset.src || child.src;
          if (url && !isDonationOrSpam(url) && !url.includes('responsive/sprite_v1_6.css.svg')) {
            const cleanedUrl = cleanImageUrl(url);
            if (settings.imageFormat === 'markdown') {
              result += `\n\n![Illustration](${cleanedUrl})\n\n`;
            } else if (settings.imageFormat === 'text') {
              result += `\n\n[Ảnh minh họa: ${cleanedUrl}]\n\n`;
            }
          }
        } else {
          result += process(child);
        }
      } else if (child.nodeType === Node.TEXT_NODE) {
        result += child.nodeValue;
      }
    }
    return result;
  }
  
  let parsed = process(temp).trim();
  
  // Handle empty paragraphs or non-breaking spaces
  if (parsed.replace(/&nbsp;/g, '').trim() === '') {
    return '';
  }
  
  return parsed;
}

// Core Parsers
const Parsers = {
  hako: {
    detect: isHako,
    parse: function(settings) {
      const container = document.getElementById('chapter-content');
      if (!container) return null;
      
      let titleInfo = {
        novelTitle: '',
        volumeTitle: '',
        chapterTitle: ''
      };
      
      // Attempt to read NovelTitle, VolumeTitle, ChapterTitle on Hako
      const breadcrumb = document.querySelector('.rd_sdc_breadcrumb') || document.querySelector('.breadcrumb');
      if (breadcrumb) {
        const items = breadcrumb.querySelectorAll('li, a');
        if (items.length >= 3) {
          titleInfo.novelTitle = items[items.length - 3].innerText.trim();
          titleInfo.volumeTitle = items[items.length - 2].innerText.trim();
          titleInfo.chapterTitle = items[items.length - 1].innerText.trim();
        }
      }
      
      // Fallbacks
      if (!titleInfo.chapterTitle) {
        const chapTitleEl = document.querySelector('.chapter-name') || document.querySelector('.title-top h2');
        if (chapTitleEl) titleInfo.chapterTitle = chapTitleEl.innerText.trim();
      }
      if (!titleInfo.novelTitle) {
        const seriesTitleEl = document.querySelector('.series-name a') || document.querySelector('.series-name');
        if (seriesTitleEl) titleInfo.novelTitle = seriesTitleEl.innerText.trim();
      }
      
      let contentMarkdown = convertNodeToMarkdown(container, settings);
      return { titleInfo, contentMarkdown };
    }
  },
  
  blogger: {
    detect: isBlogger,
    parse: function(settings) {
      // Find blogger post body
      const container = document.querySelector('.post-body') || document.querySelector('.entry-content');
      if (!container) return null;
      
      let titleInfo = {
        novelTitle: '',
        volumeTitle: '',
        chapterTitle: ''
      };
      
      // Find chapter title
      const postTitleEl = document.querySelector('.post-title') || document.querySelector('.entry-title');
      if (postTitleEl) {
        titleInfo.chapterTitle = postTitleEl.innerText.trim();
      } else {
        const pageTitle = document.title;
        titleInfo.chapterTitle = pageTitle.split('-')[0].trim();
      }
      
      let contentMarkdown = convertNodeToMarkdown(container, settings);
      return { titleInfo, contentMarkdown };
    }
  },
  
  generic: {
    detect: () => true, // Fallback
    parse: function(settings) {
      // Find container with highest P-tag density
      const containers = document.querySelectorAll('article, .entry-content, .post-content, #chapter-content, .chapter-content, .chapter-c, main, div');
      let bestContainer = null;
      let maxParagraphs = 0;
      
      for (let container of containers) {
        const pCount = container.querySelectorAll('p').length;
        if (pCount > maxParagraphs) {
          maxParagraphs = pCount;
          bestContainer = container;
        }
      }
      
      // Fallback to body
      if (!bestContainer || maxParagraphs < 3) {
        bestContainer = document.body;
      }
      
      let titleInfo = {
        novelTitle: '',
        volumeTitle: '',
        chapterTitle: document.title.trim()
      };
      
      // Try to find a header element inside or near
      const headerEl = document.querySelector('h1, h2.chapter-title, .entry-title, .post-title');
      if (headerEl) {
        titleInfo.chapterTitle = headerEl.innerText.trim();
      }
      
      let contentMarkdown = convertNodeToMarkdown(bestContainer, settings);
      return { titleInfo, contentMarkdown };
    }
  }
};

// Main execution logic
async function copyNovelContent(customContainer = null) {
  // Load settings
  const settings = await new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULT_SETTINGS, (loaded) => {
      resolve(loaded);
    });
  });
  
  let titleInfo = { novelTitle: '', volumeTitle: '', chapterTitle: '' };
  let contentMarkdown = '';
  
  if (customContainer) {
    // User manual selection
    titleInfo.chapterTitle = document.title.split('-')[0].trim();
    contentMarkdown = convertNodeToMarkdown(customContainer, settings);
  } else {
    // Automatic parsing
    let parser = Parsers.generic;
    if (Parsers.hako.detect()) {
      parser = Parsers.hako;
    } else if (Parsers.blogger.detect()) {
      parser = Parsers.blogger;
    }
    
    const result = parser.parse(settings);
    if (!result) {
      showToast("Không tìm thấy vùng nội dung truyện. Thử 'Chọn vùng thủ công' nhé!", true);
      return;
    }
    titleInfo = result.titleInfo;
    contentMarkdown = result.contentMarkdown;
  }
  
  // Format clean Markdown output
  let finalMarkdown = '';
  
  // Add source link
  if (settings.includeSource) {
    finalMarkdown += `Nguồn: ${window.location.href}\n\n`;
  }
  
  // Add titles
  if (settings.includeTitle) {
    if (titleInfo.novelTitle) {
      finalMarkdown += `# ${titleInfo.novelTitle}\n`;
    }
    if (titleInfo.volumeTitle) {
      finalMarkdown += `## ${titleInfo.volumeTitle}\n`;
    }
    if (titleInfo.chapterTitle) {
      finalMarkdown += `### ${titleInfo.chapterTitle}\n`;
    }
    finalMarkdown += `\n---\n\n`;
  }
  
  // Append content
  finalMarkdown += contentMarkdown;
  
  // Post process cleaning (remove empty lines, clean up space)
  if (settings.cleanText) {
    finalMarkdown = finalMarkdown
      .replace(/\n{3,}/g, '\n\n')  // Clean multiple line breaks
      .trim();
  }
  
  // Write to clipboard
  try {
    await navigator.clipboard.writeText(finalMarkdown);
    showToast("Sao chép nội dung thành công!");
  } catch (err) {
    console.error("Clipboard copy failed:", err);
    showToast("Lỗi sao chép! Hãy cấp quyền truy cập clipboard cho trang web.", true);
  }
}

// Toast notification injector
function showToast(message, isError = false) {
  // Remove existing
  const existing = document.querySelector('.novelcopy-toast');
  if (existing) existing.remove();
  
  const toast = document.createElement('div');
  toast.className = 'novelcopy-toast';
  if (isError) {
    toast.style.borderColor = 'rgba(239, 68, 68, 0.4)';
    toast.style.background = 'rgba(28, 10, 10, 0.95)';
    toast.innerHTML = `<span class="novelcopy-toast-icon" style="color: #ef4444 !important;">⚠️</span> ${message}`;
  } else {
    toast.innerHTML = `<span class="novelcopy-toast-icon">✓</span> ${message}`;
  }
  
  document.body.appendChild(toast);
  
  // Trigger animation
  setTimeout(() => toast.classList.add('show'), 10);
  
  // Remove after 3s
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 400);
  }, 2500);
}

// Whitelist of domains where the copy button should appear
const WHITELISTED_DOMAINS = [
  'ln.hako.vn',
  'docln.net',
  'docln.sbs',
  'novelupdates.com',
  'blogspot.com'
];

function isWhitelisted() {
  const host = window.location.hostname;
  return WHITELISTED_DOMAINS.some(domain => host === domain || host.endsWith('.' + domain));
}

// Check if the page is a reading page and we should show the FAB
function shouldShowFAB() {
  // 0. Only show on whitelisted domains
  if (!isWhitelisted()) {
    return false;
  }

  // 1. If it is Hako / Docln, only show on reading pages (which have #chapter-content)
  if (isHako()) {
    return !!document.getElementById('chapter-content');
  }
  
  // 2. If it is Blogger/Blogspot, check if it's a post page (has post body & not homepage)
  if (isBlogger()) {
    const hasContent = document.querySelector('.post-body') || document.querySelector('.entry-content');
    const isNotHome = window.location.pathname.length > 5;
    return !!(hasContent && isNotHome);
  }
  
  // 3. For NovelUpdates, we show the FAB on the site
  if (window.location.hostname.includes('novelupdates.com')) {
    return true;
  }
  
  return true;
}

// Injected Floating Copy Button (FAB)
function injectFAB() {
  // Only inject if not already present
  if (document.querySelector('.novelcopy-fab')) return;
  
  // Don't inject on iframe pages or extension popup pages
  if (window.self !== window.top) return;
  
  // Check if we should show the FAB on this page
  if (!shouldShowFAB()) return;
  
  // On reading pages, display the button
  const fab = document.createElement('button');
  fab.className = 'novelcopy-fab';
  fab.innerHTML = `<span class="novelcopy-fab-icon">📋</span>`;
  
  fab.addEventListener('click', (e) => {
    e.stopPropagation();
    copyNovelContent();
  });
  
  document.body.appendChild(fab);
}

// --- Click-to-Select Manual Mode ---
let isManualSelectActive = false;
let currentHighlightedElement = null;
let manualSelectBanner = null;

function startManualSelect() {
  if (isManualSelectActive) return;
  isManualSelectActive = true;
  
  // Hide FAB if present
  const fab = document.querySelector('.novelcopy-fab');
  if (fab) fab.style.display = 'none';
  
  // Inject instructions banner
  manualSelectBanner = document.createElement('div');
  manualSelectBanner.className = 'novelcopy-banner';
  manualSelectBanner.innerHTML = `
    <span>🎯 Chế độ chọn vùng thủ công: Rê chuột và Click vào nội dung truyện cần copy.</span>
    <button class="novelcopy-banner-btn" id="novelcopy-cancel-select">Hủy bỏ (ESC)</button>
  `;
  document.body.appendChild(manualSelectBanner);
  
  // Register cancel click
  document.getElementById('novelcopy-cancel-select').addEventListener('click', stopManualSelect);
  
  // Register mouse events
  document.addEventListener('mouseover', handleMouseOver);
  document.addEventListener('mouseout', handleMouseOut);
  document.addEventListener('click', handleSelectClick, true);
  document.addEventListener('keyup', handleEscapeKey);
}

function stopManualSelect() {
  if (!isManualSelectActive) return;
  isManualSelectActive = false;
  
  // Show FAB again
  const fab = document.querySelector('.novelcopy-fab');
  if (fab) fab.style.display = 'flex';
  
  // Remove banner
  if (manualSelectBanner) {
    manualSelectBanner.remove();
    manualSelectBanner = null;
  }
  
  // Remove highlights
  if (currentHighlightedElement) {
    currentHighlightedElement.classList.remove('novelcopy-highlight');
    currentHighlightedElement = null;
  }
  
  // Remove event listeners
  document.removeEventListener('mouseover', handleMouseOver);
  document.removeEventListener('mouseout', handleMouseOut);
  document.removeEventListener('click', handleSelectClick, true);
  document.removeEventListener('keyup', handleEscapeKey);
}

function handleMouseOver(e) {
  // Avoid highlighting our own UI
  if (e.target.closest('.novelcopy-banner') || e.target.closest('.novelcopy-fab') || e.target.closest('.novelcopy-toast')) {
    return;
  }
  
  if (currentHighlightedElement) {
    currentHighlightedElement.classList.remove('novelcopy-highlight');
  }
  
  currentHighlightedElement = e.target;
  currentHighlightedElement.classList.add('novelcopy-highlight');
}

function handleMouseOut(e) {
  if (currentHighlightedElement === e.target) {
    currentHighlightedElement.classList.remove('novelcopy-highlight');
    currentHighlightedElement = null;
  }
}

function handleSelectClick(e) {
  // Stop redirection and propagation
  e.preventDefault();
  e.stopPropagation();
  
  // Avoid selecting our own UI
  if (e.target.closest('.novelcopy-banner') || e.target.closest('.novelcopy-fab') || e.target.closest('.novelcopy-toast')) {
    return;
  }
  
  const targetElement = e.target;
  
  // Perform copy on selected container
  copyNovelContent(targetElement);
  
  // Disable selection mode
  stopManualSelect();
}

function handleEscapeKey(e) {
  if (e.key === 'Escape') {
    stopManualSelect();
  }
}

// Listen for messages from settings popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "start-manual-select") {
    startManualSelect();
    sendResponse({ status: "started" });
  }
  return true;
});

// Initialize extension elements
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectFAB);
} else {
  injectFAB();
}
