// Copyright (c) 2026 Insta360. All rights reserved.
// INS_Reader · 内容脚本入口
// 职责：组合各功能模块（偏好存取/正文定位/降噪/阅读层/AI 增强/面板 UI），
// 提供顶层 applyAll/restoreOriginalPage 编排逻辑，并处理插件消息与初始化。
// 各模块本身互不直接调用，只通过本文件和 INS_Reader.appController 串联。
// 调用者：background.js 通过 chrome.tabs.sendMessage 发 INS_READER_TOGGLE_PANEL（打开
// 入口面板）消息；
// panel-ui.js 通过 appController.applyAll()/restoreOriginalPage() 回调本文件的编排逻辑。

(function () {
  const { prefsStore, readerLayer, panelUI, aiEnhance, aiCard } = window.INS_Reader;

  function INS_applyAll() {
    const prefs = prefsStore.get();
    if (!prefs.enabled) {
      readerLayer.remove();
      readerLayer.clearFeasibilityReason();
      readerLayer.unlockOriginalPage();
      // 退出阅读模式后正文重新落在真实页面上：已生成的 AI 改写/高亮要跟着搬过去，
      // 否则用户看到开关是开的但页面上没有效果。走缓存，不重复请求。
      aiEnhance.reapply();
      return;
    }
    const rendered = readerLayer.render();
    if (rendered) {
      readerLayer.lockOriginalPage();
    } else {
      readerLayer.unlockOriginalPage();
      aiEnhance.reapply();
    }
  }

  // 所有“关闭阅读模式”的入口都走同一状态转换。总开关关闭期间，一级模块
  // 保持默认开启态但不可操作；重新开启总开关即可一次恢复三项一级功能。
  function INS_deactivateReadingMode() {
    const prefs = prefsStore.get();
    prefs.enabled = false;
    prefs.activePreset = '';
    prefs.typographyEnabled = true;
    prefs.aiEnabled = true;
    prefs.noiseReduction = true;
    readerLayer.remove();
    readerLayer.clearFeasibilityReason();
    readerLayer.unlockOriginalPage();
    readerLayer.setSummary('');
    // 恢复原网页要求页面回到零改动状态：撤销 AI 段落改写与高亮，并收起浮层卡片。
    aiEnhance.clearAll();
    aiCard.dismiss();
    prefsStore.save();
    panelUI.render();
  }

  function INS_restoreOriginalPage() {
    INS_deactivateReadingMode();
  }

  readerLayer.setOnHiddenCountChange(panelUI.updateNoiseCount);
  // 浮层卡片上的"撤销"要同时改 prefs 和重绘面板，这些都在 panel-ui 里，
  // 因此由本文件把两个模块接起来，卡片本身不反向依赖面板。
  aiCard.setOnUndo(panelUI.handleAiUndo);

  window.INS_Reader.appController = {
    applyAll: INS_applyAll,
    deactivateReadingMode: INS_deactivateReadingMode,
    restoreOriginalPage: INS_restoreOriginalPage,
  };

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
