// Copyright (c) 2026 Insta360. All rights reserved.
// INS_Reader · DOM 路径工具模块
// 职责：记录节点相对某个祖先的子节点下标路径，用于在克隆后的树里重新定位同一个节点。
// 纯函数工具，不依赖任何 INS_Reader 状态或其他模块。
// 调用者：仅 reader-layer.js 的 render()——克隆 body 前用 getChildIndexPath()
// 记录正文节点位置，克隆并降噪后用 resolveChildIndexPath() 在克隆体里找回它。

window.INS_Reader = window.INS_Reader || {};

(function () {
  function INS_getChildIndexPath(node, root) {
    const path = [];
    let current = node;
    while (current && current !== root) {
      const parent = current.parentNode;
      if (!parent) return null;
      path.unshift(Array.prototype.indexOf.call(parent.childNodes, current));
      current = parent;
    }
    return current === root ? path : null;
  }

  function INS_resolveChildIndexPath(root, path) {
    let current = root;
    for (const index of path) {
      current = current && current.childNodes[index];
      if (!current) return null;
    }
    return current;
  }

  window.INS_Reader.domPath = {
    getChildIndexPath: INS_getChildIndexPath,
    resolveChildIndexPath: INS_resolveChildIndexPath,
  };
})();
