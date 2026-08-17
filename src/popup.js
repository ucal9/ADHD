// Copyright (c) 2026 Insta360. All rights reserved.
// INS_Reader · 弹出页脚本
// 职责：点击弹出页按钮时，向当前 tab 的 content script 发 INS_READER_TOGGLE_PANEL
// 消息，由 content.js 的 onMessage 监听器接住并触发 applyAll() + panelUI.toggle()。
// 若当前页面未注入 content script（如 chrome:// 内置页面），sendMessage 会抛异常，
// 这里捕获后展示 #unsupported-hint 提示，而不是让弹出页崩溃或静默失败。

document.getElementById('toggle-btn').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'INS_READER_TOGGLE_PANEL' });
    window.close();
  } catch (e) {
    document.getElementById('unsupported-hint').style.display = 'block';
  }
});
