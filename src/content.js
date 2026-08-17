// 缓读 · 内容脚本入口
// 职责：组合各功能模块（偏好存取/正文定位/降噪/阅读层/面板 UI），
// 提供顶层 applyAll/restoreOriginalPage 编排逻辑，并处理插件消息与初始化。
// 各模块本身互不直接调用，只通过本文件和 Huandu.appController 串联。

(function () {
  const { prefsStore, readerLayer, panelUI } = window.Huandu;

  function applyAll() {
    const prefs = prefsStore.get();
    if (!prefs.enabled) {
      readerLayer.remove();
      readerLayer.unlockOriginalPage();
      return;
    }
    readerLayer.lockOriginalPage();
    readerLayer.render();
  }

  function restoreOriginalPage() {
    const prefs = prefsStore.get();
    prefs.enabled = false;
    readerLayer.remove();
    readerLayer.unlockOriginalPage();
    readerLayer.setSummary('');
    prefsStore.save();
    panelUI.render();
  }

  readerLayer.setOnHiddenCountChange(panelUI.updateNoiseCount);

  window.Huandu.appController = { applyAll, restoreOriginalPage };

  // ---- 初始化 ----
  prefsStore.load().then((prefs) => {
    if (prefs.enabled) applyAll();
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'HUANDU_TOGGLE_PANEL') {
      const prefs = prefsStore.get();
      if (!prefs.enabled) {
        prefs.enabled = true;
        prefsStore.save();
        applyAll();
      }
      panelUI.toggle();
    }
  });
})();
