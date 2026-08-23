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
    prefsStore.syncEnabled(prefs);
    if (!prefs.enabled) {
      readerLayer.remove();
      readerLayer.clearFeasibilityReason();
      readerLayer.unlockOriginalPage();
      // 三个一级都关时卸掉 AI 落地效果；aiEnabled 仍开时才把缓存搬回真实页面。
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

  // 恢复原网页：关掉三个一级（二级保留），派生 enabled=false，页面回到未处理状态。
  function INS_deactivateReadingMode() {
    const prefs = prefsStore.get();
    prefs.activePreset = '';
    prefs.typographyEnabled = false;
    prefs.aiEnabled = false;
    prefs.noiseReduction = false;
    prefsStore.syncEnabled(prefs);
    readerLayer.remove();
    readerLayer.clearFeasibilityReason();
    readerLayer.unlockOriginalPage();
    readerLayer.setSummary('');
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
      // 打开入口面板不改变开关；默认模式全开，详细配置仅在从未激活时套全关模板。
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
