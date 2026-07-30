chrome.runtime.onInstalled.addListener(() => {
  console.log('NovelCopy installed.');
});

let creatingOffscreen = null;
let stoppingJob = null;
// ponytail: one global OCR job; use per-tab queues only if concurrent copies become necessary.
let activeJob = null;

async function ensureOffscreen() {
  if (stoppingJob) await stoppingJob.promise;

  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT']
  });
  if (contexts.length) return;
  if (creatingOffscreen) return creatingOffscreen;

  creatingOffscreen = chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['WORKERS', 'BLOBS'],
    justification: 'Fetch image blobs and run the local Tesseract OCR worker.'
  });

  try {
    await creatingOffscreen;
  } finally {
    creatingOffscreen = null;
  }
}

async function sendToOffscreen(message) {
  await ensureOffscreen();
  let lastError = null;

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await chrome.runtime.sendMessage({ ...message, target: 'offscreen' });
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  throw lastError || new Error('Không thể kết nối OCR offscreen.');
}

function stopOcrJob(jobId) {
  if (stoppingJob) {
    return stoppingJob.jobId === jobId
      ? stoppingJob.promise
      : Promise.resolve({ success: false, code: 'OCR_BUSY', jobId });
  }
  if (activeJob && activeJob.jobId !== jobId) {
    return Promise.resolve({ success: false, code: 'STALE_JOB', jobId });
  }

  const shouldSignalOffscreen = activeJob?.jobId === jobId || !!creatingOffscreen;
  const promise = (async () => {
    if (creatingOffscreen) {
      try {
        await creatingOffscreen;
      } catch {
        // Creation failed; context check below resolves the final state.
      }
    }

    let contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT']
    });

    let response = null;
    if (shouldSignalOffscreen || contexts.length) {
      for (let attempt = 0; attempt < 10 && !response; attempt++) {
        try {
          response = await chrome.runtime.sendMessage({
            target: 'offscreen',
            action: 'ocr-stop',
            jobId
          });
        } catch {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }
      if (response?.code === 'STALE_JOB') {
        if (response.activeJobId) {
          activeJob = { jobId: response.activeJobId, tabId: null };
        }
        return response;
      }
    }

    contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT']
    });
    if (contexts.length) {
      try {
        await chrome.offscreen.closeDocument();
      } catch {
        // Already closed.
      }
    }

    if (!activeJob || activeJob.jobId === jobId) activeJob = null;
    return { success: true, jobId };
  })().finally(() => {
    if (stoppingJob?.jobId === jobId) stoppingJob = null;
  });

  stoppingJob = { jobId, promise };
  return promise;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'background') return false;

  if (message.action === 'ocr-recognize') {
    const tabId = sender.tab?.id ?? null;
    if (stoppingJob || (activeJob &&
      (activeJob.jobId !== message.jobId ||
        (activeJob.tabId !== null && activeJob.tabId !== tabId)))) {
      sendResponse({
        success: false,
        code: 'OCR_BUSY',
        jobId: message.jobId,
        error: 'OCR đang chạy ở tab khác.'
      });
      return false;
    }

    activeJob = { jobId: message.jobId, tabId };
    sendToOffscreen({
      action: 'ocr-recognize',
      jobId: message.jobId,
      url: message.url
    })
      .then(sendResponse)
      .catch(error => sendResponse({
        success: false,
        jobId: message.jobId,
        error: error.message
      }));
    return true;
  }

  if (message.action === 'ocr-cancel' || message.action === 'ocr-finish') {
    stopOcrJob(message.jobId)
      .then(sendResponse)
      .catch(error => sendResponse({
        success: false,
        jobId: message.jobId,
        error: error.message
      }));
    return true;
  }

  return false;
});

chrome.tabs.onRemoved.addListener(tabId => {
  if (activeJob?.tabId !== tabId) return;
  stopOcrJob(activeJob.jobId).catch(error => {
    console.warn('NovelCopy OCR tab cleanup failed:', error);
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== 'loading' || activeJob?.tabId !== tabId) return;
  stopOcrJob(activeJob.jobId).catch(error => {
    console.warn('NovelCopy OCR navigation cleanup failed:', error);
  });
});
