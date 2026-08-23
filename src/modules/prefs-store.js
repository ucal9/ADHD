// Copyright (c) 2026 Insta360. All rights reserved.
// INS_Reader · 偏好存取模块
// 职责：定义默认偏好结构、从 chrome.storage.sync 加载/保存用户设置。
// 不依赖其他 INS_Reader 模块，是最底层的模块。

window.INS_Reader = window.INS_Reader || {};

(function () {
  const STORAGE_KEY = 'ins_reader_prefs_v1';

  const DEFAULT_PREFS = {
    enabled: false,
    fontSize: 18,
    lineHeight: 1.8,
    paragraphSpacing: 1.2, // 新增：段落间距倍数 (1.0–2.0)
    letterSpacing: 0,
    fontFamily: 'default', // 新增：default | serif | sans-serif | monospace
    contentWidth: 'wide', // wide | narrow
    typographyEnabled: true, // 舒适排版一级模块开关
    noiseReduction: true,
    noiseOptions: {
      ads: true,
      sidebar: true,
      comments: true,
      banners: true,
      marketing: true,
      pauseAutoplay: true, // 视频动画：暂停自动播放（作用于原页面媒体元素，不删节点）
      blockAllVideos: true, // 智能屏蔽：视频/动画全藏，图片只藏无意义的
    },
    customColors: { bg: '#fbfcfa', text: '#3b4540' },
    aiEnabled: true, // 严格默认模式开启 AI 内容助手，但不会自动发送正文
    aiSummary: true, // 二级细分开关：AI 摘要
    aiHighlight: { // 二级细分开关：高亮，及其三个子功能
      enabled: true,
      breakLongParagraphs: true,
      simplifySentences: true,
      markKeyInfo: true,
    },
    presets: [], // 新增：预设数组，每项 { name, timestamp, prefs }
    activePreset: '', // 当前激活的预设名称，默认模式使用“默认模式”
    hasCustomized: false, // 用户改过设置后，入口/详细配置显示“默认模式”选中态
    hasActivated: false, // 已走过默认模式或详细配置；未激活时进详细配置才套全关模板
    defaultModeBackup: null, // 点选默认模式前的设置快照，取消选中时还原
    deviceId: '', // 首次 load() 时生成并持久化，用于后端限流，不含任何身份信息
  };

  const UI_NOISE_KEYS = ['sidebar', 'comments', 'banners', 'blockAllVideos'];

  const state = { prefs: { ...DEFAULT_PREFS } };

  function INS_syncEnabled(prefs) {
    prefs.enabled = Boolean(prefs.typographyEnabled) || Boolean(prefs.aiEnabled) || Boolean(prefs.noiseReduction);
    return prefs.enabled;
  }

  function INS_isUnactivated(prefs) {
    return !prefs.hasActivated && !prefs.hasCustomized;
  }

  function INS_anyNoiseUiOn(prefs) {
    const groups = prefs.noiseOptions || {};
    return UI_NOISE_KEYS.some((key) => groups[key]);
  }

  function INS_anyAiFeatureOn(prefs) {
    const highlight = prefs.aiHighlight || {};
    return Boolean(highlight.breakLongParagraphs || highlight.simplifySentences || highlight.markKeyInfo);
  }

  // 详细配置在从未激活时使用：一级、二级全关，排版数值仍用默认，页面保持原网页。
  function INS_applyAllOffModules(prefs) {
    prefs.typographyEnabled = false;
    prefs.aiEnabled = false;
    prefs.noiseReduction = false;
    prefs.noiseOptions = {
      ...prefs.noiseOptions,
      ads: false,
      sidebar: false,
      comments: false,
      banners: false,
      marketing: false,
      pauseAutoplay: false,
      blockAllVideos: false,
    };
    prefs.aiSummary = false;
    prefs.aiHighlight = {
      ...prefs.aiHighlight,
      enabled: false,
      breakLongParagraphs: false,
      simplifySentences: false,
      markKeyInfo: false,
    };
    prefs.activePreset = '';
    INS_syncEnabled(prefs);
  }

  function INS_load() {
    return new Promise((resolve) => {
      chrome.storage.sync.get([STORAGE_KEY], (result) => {
        const stored = result[STORAGE_KEY] || {};
        state.prefs = {
          ...DEFAULT_PREFS,
          ...stored,
          noiseOptions: { ...DEFAULT_PREFS.noiseOptions, ...(stored.noiseOptions || {}) },
          customColors: { ...DEFAULT_PREFS.customColors, ...(stored.customColors || {}) },
          aiHighlight: { ...DEFAULT_PREFS.aiHighlight, ...(stored.aiHighlight || {}) },
        };
        if (!state.prefs.deviceId) {
          state.prefs.deviceId = crypto.randomUUID();
          INS_save();
        }
        // 旧版本没有 hasActivated：曾经启用过或改过设置，不算「从未激活」，
        // 再进详细配置时保留当前开关，而不是套全关模板。
        if (!Object.prototype.hasOwnProperty.call(stored, 'hasActivated')) {
          state.prefs.hasActivated = Boolean(stored.enabled || stored.hasCustomized || stored.activePreset);
        }
        resolve(state.prefs);
      });
    });
  }

  function INS_save() {
    chrome.storage.sync.set({ [STORAGE_KEY]: state.prefs });
  }

  function INS_get() {
    return state.prefs;
  }

  window.INS_Reader.prefsStore = {
    DEFAULT_PREFS,
    UI_NOISE_KEYS,
    load: INS_load,
    save: INS_save,
    get: INS_get,
    syncEnabled: INS_syncEnabled,
    isUnactivated: INS_isUnactivated,
    anyNoiseUiOn: INS_anyNoiseUiOn,
    anyAiFeatureOn: INS_anyAiFeatureOn,
    applyAllOffModules: INS_applyAllOffModules,
  };
})();
