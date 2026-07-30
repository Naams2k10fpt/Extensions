const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const context = {
  URL,
  console,
  clearTimeout,
  setTimeout,
  requestAnimationFrame() {},
  crypto: { randomUUID: () => 'test-job' },
  Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
  chrome: {
    runtime: {
      lastError: null,
      onMessage: { addListener() {} },
      sendMessage() {}
    },
    storage: {
      local: { get() {}, set() {} },
      sync: { get() {} }
    }
  },
  document: {
    readyState: 'loading',
    addEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; }
  },
  window: {
    addEventListener() {},
    location: {
      hostname: 'glucosetl.xyz',
      href: 'https://glucosetl.xyz/translations/tenkosaki/volume-1/chapter-2'
    },
    self: null,
    top: null
  }
};
context.window.self = context.window.top = context.window;

vm.runInNewContext(fs.readFileSync(__dirname + '/content.js', 'utf8'), context);

assert.strictEqual(
  context.formatOcrText('Promise\n\nHello from\nGlucose TL.\n\n1\n'),
  'Promise\n\nHello from Glucose TL.'
);
assert.strictEqual(
  context.renderLayoutBlocksToMarkdown(
    { text: 'Recognized\ntext' },
    { imageFormat: 'markdown' },
    'https://example.com/page.png'
  ),
  'Recognized text'
);
assert.strictEqual(
  context.renderLayoutBlocksToMarkdown(
    { text: '' },
    { imageFormat: 'markdown' },
    'https://example.com/page.png'
  ),
  '![Illustration](https://example.com/page.png)'
);
assert.strictEqual(
  context.renderLayoutBlocksToMarkdown(
    { text: 'f- b hy ie', confidence: 39 },
    { imageFormat: 'markdown' },
    'https://example.com/manga.png'
  ),
  '![Illustration](https://example.com/manga.png)'
);
assert.strictEqual(
  context.renderLayoutBlocksToMarkdown(
    { text: 'Story text', confidence: 60 },
    { imageFormat: 'markdown' },
    'https://example.com/mixed.png'
  ),
  'Story text\n\n![Illustration](https://example.com/mixed.png)'
);
assert.strictEqual(
  context.renderLayoutBlocksToMarkdown(
    {
      text: 'flat OCR is intentionally ignored',
      confidence: 60,
      width: 1000,
      height: 1647,
      paragraphs: [
        {
          text: 'Story text',
          confidence: 96,
          bbox: { x0: 12, y0: 20, x1: 900, y1: 90 },
          lineCount: 2,
          italic: false
        },
        {
          text: '/ \\\\ Beery Wren',
          confidence: 45,
          bbox: { x0: 96, y0: 377, x1: 951, y1: 1518 },
          lineCount: 21,
          italic: false
        },
        {
          text: '..Eh?',
          confidence: 54,
          bbox: { x0: 71, y0: 1552, x1: 142, y1: 1577 },
          lineCount: 1,
          italic: false
        },
        {
          text: 'K}',
          confidence: 66,
          bbox: { x0: 979, y0: 1627, x1: 987, y1: 1641 },
          lineCount: 1,
          italic: false
        }
      ]
    },
    { imageFormat: 'markdown' },
    'https://example.com/mixed.png'
  ),
  'Story text\n\n...Eh?\n\n![Illustration](https://example.com/mixed.png)'
);
assert.strictEqual(
  context.renderLayoutBlocksToMarkdown(
    {
      confidence: 93,
      width: 1000,
      height: 1647,
      paragraphs: [
        {
          text: 'As Hayato replied, she turned away.',
          confidence: 95,
          bbox: { x0: 14, y0: 20, x1: 937, y1: 93 },
          lineCount: 2
        },
        {
          text: 'wpe',
          confidence: 0,
          bbox: { x0: 452, y0: 181, x1: 548, y1: 207 },
          lineCount: 1
        },
        {
          text: 'Apparently, his response was inadequate.',
          confidence: 96,
          bbox: { x0: 71, y0: 301, x1: 754, y1: 331 },
          lineCount: 1
        },
        {
          text: 'What should | do...',
          confidence: 94,
          bbox: { x0: 73, y0: 609, x1: 318, y1: 633 },
          lineCount: 1,
          italic: true
        }
      ]
    },
    { imageFormat: 'markdown' },
    'https://example.com/text.png'
  ),
  'As Hayato replied, she turned away.\n\n***\n\nApparently, his response was inadequate.\n\n*What should I do...*'
);
assert.strictEqual(
  context.renderLayoutBlocksToMarkdown(
    {
      confidence: 93,
      width: 1000,
      height: 1647,
      paragraphs: [
        { text: 'Clear prose.', confidence: 95, lineCount: 1 },
        { text: 'uncertain fragment', confidence: 40, lineCount: 1 }
      ]
    },
    { imageFormat: 'markdown' },
    'https://example.com/uncertain.png'
  ),
  'Clear prose.\n\n![Illustration](https://example.com/uncertain.png)'
);
assert.strictEqual(
  context.formatOcrParagraphs({
    paragraphs: [{ text: '⋆⋅☆⋅⋆', confidence: 90, lineCount: 1 }]
  }).text,
  '***'
);
assert.strictEqual(
  context.isOcrSceneBreak(
    {
      text: 'Phew',
      confidence: 0,
      bbox: { x0: 460, y0: 181, x1: 540, y1: 207 },
      lineCount: 1
    },
    1,
    {
      width: 1000,
      paragraphs: [
        { text: 'A sufficiently long paragraph before it.', confidence: 95, bbox: { y1: 93 } },
        {},
        { text: 'A sufficiently long paragraph after it.', confidence: 95, bbox: { y0: 301 } }
      ]
    },
    'Phew'
  ),
  false
);
assert.strictEqual(
  context.imageToMarkdown('https://example.com/page.png', { imageFormat: 'hidden' }),
  ''
);
assert.strictEqual(
  context.getOcrLayout({ 'https://example.com/page.png': { text: 'ok' } }, 'https://example.com/page.png').text,
  'ok'
);

const glucoseTitles = {
  '.text-4xl.font-bold': { innerText: 'Novel' },
  '.font-serif.text-3xl': { innerText: 'Volume 1' },
  '.text-3xl.font-bold:not(.font-serif)': { innerText: 'Chapter 3' }
};
context.document.querySelector = selector => glucoseTitles[selector] || null;
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(context.getGlucoseTitles())),
  { novelTitle: 'Novel', volumeTitle: 'Volume 1', chapterTitle: 'Chapter 3' }
);

const offscreenContext = {
  URL,
  console,
  chrome: {
    runtime: {
      getURL() { return ''; },
      onMessage: { addListener() {} }
    }
  }
};
vm.runInNewContext(fs.readFileSync(__dirname + '/offscreen.js', 'utf8'), offscreenContext);

function syntheticTextImage(slope) {
  const width = 80;
  const height = 30;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 3; index < data.length; index += 4) data[index] = 255;
  for (const base of [10, 24, 38, 52, 66]) {
    for (let y = 2; y < height - 2; y++) {
      const x = base - Math.round(slope * (y - height / 2));
      for (let stroke = 0; stroke < 2; stroke++) {
        const index = (y * width + x + stroke) * 4;
        data[index] = data[index + 1] = data[index + 2] = 255;
      }
    }
  }
  return { width, height, data };
}

const syntheticBox = { x0: 0, y0: 0, x1: 80, y1: 30 };
assert(offscreenContext.italicProjectionGain(syntheticTextImage(0.125), syntheticBox) >= 1.05);
assert(offscreenContext.italicProjectionGain(syntheticTextImage(0), syntheticBox) < 1.05);

console.log('content.selftest.js ok');
