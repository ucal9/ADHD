// Copyright (c) 2026 Insta360. All rights reserved.
// INS_Reader · 内容脚本入口
// 职责：组合各功能模块（偏好存取/正文定位/降噪/阅读层/面板 UI），
// 提供顶层 applyAll/restoreOriginalPage 编排逻辑，并处理插件消息与初始化。
// 各模块本身互不直接调用，只通过本文件和 INS_Reader.appController 串联。
// 调用者：popup.js 通过 chrome.tabs.sendMessage 发 INS_READER_TOGGLE_PANEL 消息触发；
// panel-ui.js 通过 appController.applyAll()/restoreOriginalPage() 回调本文件的编排逻辑。

(function () {
  const { prefsStore, readerLayer, panelUI } = window.INS_Reader;

  function INS_applyAll() {
    const prefs = prefsStore.get();
    if (!prefs.enabled) {
      readerLayer.remove();
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
    readerLayer.unlockOriginalPage();
    readerLayer.setSummary('');
    prefsStore.save();
    panelUI.render();
  }

  readerLayer.setOnHiddenCountChange(panelUI.updateNoiseCount);

  window.INS_Reader.appController = { applyAll: INS_applyAll, restoreOriginalPage: INS_restoreOriginalPage };

  // ---- 初始化 ----
  prefsStore.load().then((prefs) => {
    if (prefs.enabled) INS_applyAll();
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'INS_READER_TOGGLE_PANEL') {
      const prefs = prefsStore.get();
      if (!prefs.enabled) {
        prefs.enabled = true;
        prefsStore.save();
        INS_applyAll();
      }
      panelUI.toggle();
    }
  });
})();
