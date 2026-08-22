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
    // 视频（暂停播放并隐藏）：把视频容器整体从克隆体里摘掉。标注为"可能存在风险"是因为
    // 部分站点的正文本身就是视频（教程/评测），全屏蔽后阅读层可能空掉，故默认关闭。
    video: ['video', 'iframe[src*="youtube"]', 'iframe[src*="bilibili"]', 'iframe[src*="vimeo"]', 'iframe[src*="player"]', '[class*="video-player"]', '[class*="videoPlayer"]'],
  };

  // 返回移除的元素数量。cloneRoot 必须是克隆体，绝不作用于原始 DOM。
  // countScopeRoot 可选：只有落在这个子树内的移除才计入返回值——阅读层最终只展示
  // resolvedClone（正文子树），cloneRoot 之外与正文平级的兄弟节点（真实侧边栏/页眉页脚等）
  // 本来就从不会出现在阅读层里，如果不加这个参数，计数会把这些用户根本看不到的移除也算
  // 进"已隐藏 N 个干扰元素"，导致这个数字和用户在阅读层里实际看到的效果对不上。
  // 传 resolvedClone 作为 countScopeRoot 即可让计数与阅读层可见内容严格对应；
  // 不传时退化为旧行为（整个 cloneRoot 范围内都计数）。
  function INS_stripNoiseFromClone(cloneRoot, countScopeRoot) {
    const prefs = window.INS_Reader.prefsStore.get();
    if (!prefs.noiseReduction) return 0;
    const groups = prefs.noiseOptions || window.INS_Reader.prefsStore.DEFAULT_PREFS.noiseOptions;
    let count = 0;
    for (const groupKey of Object.keys(NOISE_GROUPS)) {
      if (!groups[groupKey]) continue;
      for (const selector of NOISE_GROUPS[groupKey]) {
        // 同一个 selector 可能一次性同时命中一个容器和它内部的子孙（比如 comment-section
        // 连同里面每条评论的 avatar/body/meta 都匹配 `[class*="comment"]`）。必须先把这一批
        // 命中元素的 withinVisibleScope 全部判断完，再统一 remove()——如果判断和移除交叉进行，
        // 容器先被摘掉后，它那些子孙节点就已经从树上断开，countScopeRoot.contains() 对它们
        // 恒为 false，会把本该计入的子孙全部漏计。
        const matches = Array.from(cloneRoot.querySelectorAll(selector)).filter((el) => {
          // 视频是否整体摘掉只应由用户显式开启的"视频（暂停播放并隐藏）"决定——其它分组里
          // 裸标签/宽泛选择器（如 banners 组的 header/footer）匹配范围很宽，很多站点
          // 模板会把正文视频包在 <header> 里，误命中后会连正文视频一起删掉。
          return groupKey === 'video' || !(el.matches('video, iframe') || el.querySelector('video, iframe'));
        });
        const withinVisibleScope = matches.map((el) => !countScopeRoot || countScopeRoot.contains(el));
        matches.forEach((el, i) => {
          el.remove();
          if (withinVisibleScope[i]) count += 1;
        });
      }
    }
    return count;
  }

  window.INS_Reader.noiseFilter = {
    NOISE_GROUPS,
    stripNoiseFromClone: INS_stripNoiseFromClone,
  };
})();
