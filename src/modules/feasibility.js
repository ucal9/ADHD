// Copyright (c) 2026 Insta360. All rights reserved.
// INS_Reader · 阅读模式可行性判断模块
// 职责：只读判断当前页面是否适合进入阅读模式（视频/流媒体主导页面、正文质量不足
// 等场景会误抓到无意义内容），从不修改真实 DOM，只做查询。
// 依赖 INS_Reader.articleLocator 复用其已定位到的正文节点，避免重复解析。
// 调用者：reader-layer.js 的 render() 在挂载 Shadow DOM / 锁定原页面之前调用 check()，
// 判断不通过则直接跳过渗透；panel-ui.js 读取 reason 展示提示文案。

window.INS_Reader = window.INS_Reader || {};

(function () {
  // 已知视频/流媒体域名，命中即视为不适合阅读模式（后缀匹配，兼容子域名）。
  const VIDEO_HOST_SUFFIXES = [
    'bilibili.com',
    'youtube.com',
    'youtu.be',
    'youku.com',
    'iqiyi.com',
    'v.qq.com',
    'douyin.com',
    'ixigua.com',
    'twitch.tv',
    'netflix.com',
  ];

  const MIN_TEXT_LENGTH = 200;
  const MAX_LINK_DENSITY = 0.5;
  const MAX_VIDEO_AREA_RATIO = 0.3;

  function INS_textLength(el) {
    return (el.textContent || '').trim().length;
  }

  function INS_isVideoDomain() {
    const host = location.hostname.toLowerCase();
    return VIDEO_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
  }

  // 统计可见 <video> 元素占视口面积的比例，兜住黑名单未覆盖的自建播放器站点。
  function INS_isVideoDominated() {
    const videos = Array.from(document.querySelectorAll('video'));
    if (videos.length === 0) return false;

    const viewportArea = window.innerWidth * window.innerHeight;
    if (viewportArea <= 0) return false;

    let videoArea = 0;
    for (const video of videos) {
      const rect = video.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      videoArea += rect.width * rect.height;
    }
    return videoArea / viewportArea > MAX_VIDEO_AREA_RATIO;
  }

  // 正文过短或链接密度过高，说明定位到的其实是导航/列表而非正文。
  function INS_isContentTooThin(articleRoot) {
    if (!articleRoot) return true;
    const text = INS_textLength(articleRoot);
    if (text < MIN_TEXT_LENGTH) return true;

    const linkText = Array.from(articleRoot.querySelectorAll('a')).reduce(
      (sum, a) => sum + INS_textLength(a),
      0
    );
    const linkDensity = text > 0 ? linkText / text : 1;
    return linkDensity > MAX_LINK_DENSITY;
  }

  function INS_check(articleRoot) {
    if (INS_isVideoDomain()) {
      return { feasible: false, reason: 'domain' };
    }
    if (INS_isVideoDominated()) {
      return { feasible: false, reason: 'video' };
    }
    if (INS_isContentTooThin(articleRoot)) {
      return { feasible: false, reason: 'thin-content' };
    }
    return { feasible: true, reason: null };
  }

  window.INS_Reader.feasibility = {
    check: INS_check,
  };
})();
