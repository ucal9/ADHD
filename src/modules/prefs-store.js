// 缓读 · 偏好存取模块
// 职责：定义默认偏好结构、从 chrome.storage.sync 加载/保存用户设置。
// 不依赖其他缓读模块，是最底层的模块。

window.Huandu = window.Huandu || {};

(function () {
  const STORAGE_KEY = 'huandu_prefs_v1';

  const DEFAULT_PREFS = {
    enabled: false,
    theme: 'gentle', // gentle | focus | custom
    fontSize: 18,
    lineHeight: 1.8,
    letterSpacing: 0,
    contentWidth: 'wide', // wide | narrow
    noiseReduction: true,
    noiseOptions: { ads: true, sidebar: true, comments: true, banners: true, marketing: true },
    customColors: { bg: '#fbfcfa', text: '#3b4540' },
    aiEnabled: false,
    deviceId: '', // 首次 load() 时生成并持久化，用于后端限流，不含任何身份信息
  };

  const state = { prefs: { ...DEFAULT_PREFS } };

  function load() {
    return new Promise((resolve) => {
      chrome.storage.sync.get([STORAGE_KEY], (result) => {
        const stored = result[STORAGE_KEY] || {};
        state.prefs = {
          ...DEFAULT_PREFS,
          ...stored,
          noiseOptions: { ...DEFAULT_PREFS.noiseOptions, ...(stored.noiseOptions || {}) },
          customColors: { ...DEFAULT_PREFS.customColors, ...(stored.customColors || {}) },
        };
        if (!state.prefs.deviceId) {
          state.prefs.deviceId = crypto.randomUUID();
          save();
        }
        resolve(state.prefs);
      });
    });
  }

  function save() {
    chrome.storage.sync.set({ [STORAGE_KEY]: state.prefs });
  }

  function get() {
    return state.prefs;
  }

  window.Huandu.prefsStore = {
    DEFAULT_PREFS,
    load,
    save,
    get,
  };
})();
