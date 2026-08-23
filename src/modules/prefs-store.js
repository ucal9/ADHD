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
    typographyEnabled: true, // 排版模块总开关（展示在排版栏目标题行），关闭后阅读层改用系统默认外观
    noiseReduction: true,
    noiseOptions: {
      ads: true,
      sidebar: true,
      comments: true,
      banners: true,
      marketing: true,
      video: false, // 视频（暂停播放并隐藏）：合并开关，同时暂停原页面自动播放 + 从克隆体里摘掉视频容器；
      // 默认关闭——部分站点正文本身就是视频，摘掉视频容器可能让阅读层空掉
    },
    customColors: { bg: '#fbfcfa', text: '#3b4540' },
    aiEnabled: false, // AI 内容助手模块总开关（展示在一级入口界面）
    aiSummary: true, // 二级细分开关：AI 摘要
    aiHighlight: { // 二级细分开关：高亮，及其三个子功能
      enabled: false,
      breakLongParagraphs: false,
      simplifySentences: false,
      markKeyInfo: false,
    },
    presets: [], // 新增：预设数组，每项 { name, timestamp, prefs }
    deviceId: '', // 首次 load() 时生成并持久化，用于后端限流，不含任何身份信息
  };

  const state = { prefs: { ...DEFAULT_PREFS } };

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
    load: INS_load,
    save: INS_save,
    get: INS_get,
  };
})();
