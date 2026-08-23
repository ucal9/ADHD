// Copyright (c) 2026 Insta360. All rights reserved.
// INS_Reader · 真实页面降噪模块
// 职责：把降噪效果直接、可逆地作用于用户正在浏览的真实页面（与缓读模式解耦，
// 不要求 prefs.enabled 为 true 也能生效）。全模块唯一被允许改动真实页面 DOM/
// 播放状态的地方——noiseFilter/articleLocator 仍然保持只读/只操作克隆体不变。
// 依赖 INS_Reader.noiseFilter（复用其 NOISE_GROUPS 作为唯一选择器数据源）和
// INS_Reader.prefsStore（读取当前开启的降噪类别）。
// 调用者：content.js 的 INS_applyAll() 及初始化流程调用 sync()。

window.INS_Reader = window.INS_Reader || {};

(function () {
  const LIVE_HIDDEN_CLASS = 'ins-reader-live-hidden';
  const LIVE_STYLE_ID = 'ins-reader-live-style';
  const MUTATION_DEBOUNCE_MS = 300;

  const state = {
    hiddenEls: new Map(), // Element -> 分类 key，用于精确按类别复原
    pausedMedia: [], // 因"暂停自动播放"被我们暂停的真实媒体元素，降噪关闭时原样还原
    observer: null,
    debounceTimer: null,
  };

  function INS_ensureStyleInjected() {
    if (document.getElementById(LIVE_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = LIVE_STYLE_ID;
    style.textContent = `.${LIVE_HIDDEN_CLASS}{display:none!important;}`;
    (document.head || document.documentElement).appendChild(style);
  }

  // 暂停真实页面里正在自动播放的视频/音频。与"视频（暂停播放并隐藏）"是同一个
  // 开关的两个动作，一起生效一起还原，所有改动记在 state.pausedMedia 里。
  function INS_pauseAutoplayMedia() {
    document.querySelectorAll('video, audio').forEach((el) => {
      const hadAutoplay = el.hasAttribute('autoplay');
      if (!hadAutoplay && el.paused) return;
      state.pausedMedia.push({ el, hadAutoplay, wasPlaying: !el.paused });
      if (hadAutoplay) el.removeAttribute('autoplay');
      if (!el.paused) el.pause();
    });
  }

  function INS_restoreAutoplayMedia() {
    state.pausedMedia.forEach(({ el, hadAutoplay, wasPlaying }) => {
      if (hadAutoplay) el.setAttribute('autoplay', '');
      if (wasPlaying) el.play().catch(() => {});
    });
    state.pausedMedia = [];
  }

  function INS_restoreAll() {
    state.hiddenEls.forEach((_category, el) => {
      el.classList.remove(LIVE_HIDDEN_CLASS);
    });
    state.hiddenEls.clear();
    INS_restoreAutoplayMedia();
  }

  function INS_stopObserving() {
    if (state.observer) {
      state.observer.disconnect();
      state.observer = null;
    }
    if (state.debounceTimer) {
      clearTimeout(state.debounceTimer);
      state.debounceTimer = null;
    }
  }

  function INS_startObserving() {
    if (state.observer) return;
    state.observer = new MutationObserver(() => {
      if (state.debounceTimer) return;
      state.debounceTimer = setTimeout(() => {
        state.debounceTimer = null;
        INS_syncLiveNoiseFilter();
      }, MUTATION_DEBOUNCE_MS);
    });
    state.observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  // 核心协调函数：把真实页面的隐藏状态对齐到当前 prefs，幂等、可反复调用。
  function INS_syncLiveNoiseFilter() {
    const { noiseFilter, prefsStore } = window.INS_Reader;
    const prefs = prefsStore.get();

    if (!prefs.noiseReduction) {
      INS_restoreAll();
      INS_stopObserving();
      return;
    }

    INS_ensureStyleInjected();
    const groups = prefs.noiseOptions || prefsStore.DEFAULT_PREFS.noiseOptions;
    const matchedEls = new Set();

    for (const groupKey of Object.keys(noiseFilter.NOISE_GROUPS)) {
      if (!groups[groupKey]) continue;
      for (const selector of noiseFilter.NOISE_GROUPS[groupKey]) {
        // 与 stripNoiseFromClone 保持一致：非 video 分组避免误伤包含正文视频的容器。
        const matches = Array.from(document.querySelectorAll(selector)).filter((el) => {
          return groupKey === 'video' || !(el.matches('video, iframe') || el.querySelector('video, iframe'));
        });
        matches.forEach((el) => {
          matchedEls.add(el);
          if (!state.hiddenEls.has(el)) {
            el.classList.add(LIVE_HIDDEN_CLASS);
            state.hiddenEls.set(el, groupKey);
          }
        });
      }
    }

    // 之前被隐藏、但这次没有再被匹配到（分类被关闭，或元素已从文档移除）的元素，复原。
    state.hiddenEls.forEach((_category, el) => {
      if (matchedEls.has(el)) return;
      el.classList.remove(LIVE_HIDDEN_CLASS);
      state.hiddenEls.delete(el);
    });

    if (groups.video) {
      INS_pauseAutoplayMedia();
    } else {
      INS_restoreAutoplayMedia();
    }

    INS_startObserving();
  }

  window.INS_Reader.liveNoiseFilter = {
    sync: INS_syncLiveNoiseFilter,
  };
})();
