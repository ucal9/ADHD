// Copyright (c) 2026 Insta360. All rights reserved.
// INS_Reader · 降噪清理模块
// 职责：维护降噪选择器规则组，对 DOM 克隆体执行清理（不触碰原页面）。
// 依赖 INS_Reader.prefsStore 读取用户当前开启的降噪类别。
// 调用者：reader-layer.js 的 render() 调用 stripNoiseFromClone()；
// panel-ui.js 读取 NOISE_GROUPS 的 key 列表来渲染降噪类别开关。

window.INS_Reader = window.INS_Reader || {};

(function () {
  const NOISE_GROUPS = {
    ads: ['[class*="advert"]', '[class*="ad-"]', '[id*="ad-"]', '[class*="promo"]'],
    sidebar: ['nav', 'aside', '[class*="sidebar"]'],
    comments: ['[class*="comment"]'],
    banners: ['header', 'footer', '[class*="banner"]', '[class*="popup"]', '[class*="modal"]', '[class*="subscribe"]', '[class*="related"]', '[class*="recommend"]', '[class*="toolbox"]', '[class*="toolbar"]'],
    // 会员/登录墙推销 UI：常见于 CSDN、掘金等技术博客站——蒙层遮挡正文、
    // 求关注/求登录浮层、VIP 购买卡片，混在正文容器内部而非平级兄弟节点。
    marketing: ['[class*="vip-mask"]', '[class*="mask-dark"]', '[class*="article-vip"]', '[class*="openvippay"]', '[class*="unlogin"]', '[class*="login-mask"]'],
  };

  function INS_activeSelectors() {
    const prefs = window.INS_Reader.prefsStore.get();
    const groups = prefs.noiseOptions || window.INS_Reader.prefsStore.DEFAULT_PREFS.noiseOptions;
    return Object.keys(NOISE_GROUPS)
      .filter((key) => groups[key])
      .flatMap((key) => NOISE_GROUPS[key]);
  }

  // 返回移除的元素数量。cloneRoot 必须是克隆体，绝不作用于原始 DOM。
  function INS_stripNoiseFromClone(cloneRoot) {
    const prefs = window.INS_Reader.prefsStore.get();
    if (!prefs.noiseReduction) return 0;
    let count = 0;
    for (const selector of INS_activeSelectors()) {
      cloneRoot.querySelectorAll(selector).forEach((el) => {
        el.remove();
        count += 1;
      });
    }
    return count;
  }

  window.INS_Reader.noiseFilter = {
    NOISE_GROUPS,
    stripNoiseFromClone: INS_stripNoiseFromClone,
  };
})();
