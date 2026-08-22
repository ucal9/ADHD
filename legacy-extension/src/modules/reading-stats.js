// Copyright (c) 2026 Insta360. All rights reserved.
// INS_Reader · 阅读统计模块
// 职责：根据正文文本估算总阅读时长，并按滚动位置计算已读进度。
// 纯函数工具，不依赖其他 INS_Reader 模块。
// 调用者：仅 reader-layer.js 的 render()——渲染时调用 estimateMinutes()
// 算出总时长，滚动事件回调里调用 computeProgress() 更新进度条。

window.INS_Reader = window.INS_Reader || {};

(function () {
  const CJK_WPM = 350; // 中文按字符计数的阅读速度（字/分钟）
  const EN_WPM = 230; // 英文按单词计数的阅读速度（词/分钟）

  function INS_countCJKChars(text) {
    const matches = text.match(/[一-鿿㐀-䶿]/g);
    return matches ? matches.length : 0;
  }

  function INS_countWords(text) {
    const matches = text.match(/[A-Za-z0-9']+/g);
    return matches ? matches.length : 0;
  }

  // 中英文混排时分别计数、分别按各自速度换算时间再相加，
  // 避免用单一 WPM 估算导致中文页面严重失真。
  function INS_estimateMinutes(text) {
    const cjkChars = INS_countCJKChars(text);
    const enWords = INS_countWords(text.replace(/[一-鿿㐀-䶿]/g, ' '));
    return cjkChars / CJK_WPM + enWords / EN_WPM;
  }

  function INS_formatMinutes(minutes) {
    const rounded = Math.max(1, Math.round(minutes));
    return `${rounded} 分钟`;
  }

  // scrollTop/scrollHeight/clientHeight 取自阅读层的滚动容器。
  function INS_computeProgress(scrollTop, scrollHeight, clientHeight) {
    const scrollable = scrollHeight - clientHeight;
    if (scrollable <= 0) return 1;
    return Math.min(1, Math.max(0, scrollTop / scrollable));
  }

  window.INS_Reader.readingStats = {
    estimateMinutes: INS_estimateMinutes,
    formatMinutes: INS_formatMinutes,
    computeProgress: INS_computeProgress,
  };
})();
