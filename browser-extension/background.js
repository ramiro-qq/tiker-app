import { buildClipLink } from './clip-link.js';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'ai-reader-clip', title: '一键剪藏',
      contexts: ['page', 'selection', 'link', 'image', 'video', 'audio', 'frame', 'action'],
      documentUrlPatterns: ['http://*/*', 'https://*/*'],
    });
  });
});

async function clip(tab, pageUrl) {
  const tabId = tab?.id;
  if (typeof tabId !== 'number' || tabId < 0) return;
  try {
    const link = buildClipLink(pageUrl || tab.url, tab.title || '');
    // External protocols hand off to the OS without committing a new page.
    // Use the source tab so repeated clips never create helper tabs.
    await chrome.tabs.update(tabId, { url: link });
    await chrome.action.setBadgeText({ tabId, text: '' });
    await chrome.action.setTitle({ tabId, title: '一键剪藏到 Tiker' });
  } catch (error) {
    const message = error instanceof Error ? error.message : '无法唤起 Tiker，请确认客户端已安装后重试。';
    // Keep failures in the toolbar instead of opening an error page.
    await Promise.allSettled([
      chrome.action.setBadgeText({ tabId, text: '!' }),
      chrome.action.setBadgeBackgroundColor({ tabId, color: '#D14343' }),
      chrome.action.setTitle({ tabId, title: message }),
    ]);
  }
}

chrome.action.onClicked.addListener(tab => clip(tab));
chrome.contextMenus.onClicked.addListener((info, tab) => {
  // 右键链接或图片仍剪藏所在的顶层网页。
  if (info.menuItemId === 'ai-reader-clip') return clip(tab, info.pageUrl);
});
