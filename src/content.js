// Copyright (c) 2026 Insta360. All rights reserved.
// INS_Reader · 内容脚本入口
// 职责：组合各功能模块（偏好存取/正文定位/降噪/阅读层/面板 UI），
// 提供顶层 applyAll/restoreOriginalPage 编排逻辑，并处理插件消息与初始化。
// 各模块本身互不直接调用，只通过本文件和 INS_Reader.appController 串联。
// 调用者：background.js 通过 chrome.tabs.sendMessage 发 INS_READER_TOGGLE_PANEL（打开
// 入口面板）消息；
// panel-ui.js 通过 appController.applyAll()/restoreOriginalPage() 回调本文件的编排逻辑。

(function () {
  const { prefsStore, readerLayer, panelUI } = window.INS_Reader;

  function INS_applyAll() {
    const prefs = prefsStore.get();
    if (!prefs.enabled) {
      readerLayer.remove();
      readerLayer.clearFeasibilityReason();
      readerLayer.unlockOriginalPage();
      return;
    }
    const rendered = readerLayer.render();
    if (rendered) {
      readerLayer.lockOriginalPage();
    } else {
      readerLayer.unlockOriginalPage();
    }
  }

  function INS_restoreOriginalPage() {
    const prefs = prefsStore.get();
    prefs.enabled = false;
    readerLayer.remove();
    readerLayer.clearFeasibilityReason();
    readerLayer.unlockOriginalPage();
    readerLayer.setSummary('');
    prefsStore.save();
    panelUI.render();
  }

  readerLayer.setOnHiddenCountChange(panelUI.updateNoiseCount);

  window.INS_Reader.appController = { applyAll: INS_applyAll, restoreOriginalPage: INS_restoreOriginalPage };

  // ---- 初始化 ----
  // 工具栏可能在按需注入脚本后立刻发消息，因此打开面板前必须等待偏好加载完成。
  const readyPromise = prefsStore.load().then((prefs) => {
    if (prefs.enabled) INS_applyAll();
    return prefs;
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === 'INS_READER_TOGGLE_PANEL') {
      // 打开详细配置不等于启用阅读模式；只有用户明确点击总开关才改变 enabled。
      readyPromise
        .then(() => {
          panelUI.openQuick();
          sendResponse({ ok: true });
        })
        .catch((err) => {
          console.error('[INS_Reader][content] 初始化失败，无法打开面板', err);
          sendResponse({ ok: false });
        });
      return true;
    } else if (msg?.type === 'INS_READER_SYNC_PREFS') {
      prefsStore.load().then(() => {
        INS_applyAll();
        if (panelUI.isOpen()) panelUI.render();
      });
    }
  });
})();
