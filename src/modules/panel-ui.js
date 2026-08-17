// 缓读 · 设置面板模块
// 职责：渲染用户设置面板（主题/字号/宽度/降噪开关），Shadow DOM 隔离样式。
// 依赖 Huandu.prefsStore / noiseFilter / readerLayer。面板自身不决定"是否应用"，
// 只负责收集用户输入后回调 Huandu.appController 提供的 applyAll/restore。

window.Huandu = window.Huandu || {};

(function () {
  const FONT_MIN = 14;
  const FONT_MAX = 28;
  const LINE_HEIGHT_MIN = 1.5;
  const LINE_HEIGHT_MAX = 2.2;
  const LETTER_SPACING_MIN = 0;
  const LETTER_SPACING_MAX = 0.12;

  const state = { panelHost: null };

  function ensurePanelHost() {
    if (state.panelHost) return state.panelHost;
    state.panelHost = document.createElement('div');
    state.panelHost.id = 'huandu-panel-host';
    state.panelHost.style.position = 'fixed';
    state.panelHost.style.top = '0';
    state.panelHost.style.left = '0';
    state.panelHost.style.width = '0';
    state.panelHost.style.height = '0';
    state.panelHost.style.zIndex = '2147483647';
    document.documentElement.appendChild(state.panelHost);
    return state.panelHost;
  }

  function updateNoiseCount(count) {
    const shadow = state.panelHost && state.panelHost.shadowRoot;
    if (!shadow) return;
    const countEl = shadow.querySelector('[data-role="noise-count"]');
    if (countEl) countEl.textContent = String(count);
  }

  function toggle() {
    const host = ensurePanelHost();
    const shadow = host.shadowRoot;
    const existing = shadow && shadow.querySelector('.huandu-panel');
    if (existing) {
      close(existing);
      return;
    }
    render();
  }

  function close(panelEl) {
    panelEl.classList.add('closing');
    panelEl.addEventListener('animationend', () => panelEl.remove(), { once: true });
  }

  function render() {
    const { prefsStore, noiseFilter, readerLayer, appController } = window.Huandu;
    const prefs = prefsStore.get();

    const host = ensurePanelHost();
    let shadow = host.shadowRoot;
    if (!shadow) shadow = host.attachShadow({ mode: 'open' });
    const isFirstOpen = !shadow.querySelector('.huandu-panel');
    shadow.innerHTML = '';

    const style = document.createElement('style');
    style.textContent = PANEL_CSS;
    shadow.appendChild(style);

    const noiseLabels = { ads: '广告', sidebar: '侧边栏/导航', comments: '评论区', banners: '弹窗/横幅', marketing: '会员/登录推销' };

    const panel = document.createElement('div');
    panel.className = isFirstOpen ? 'huandu-panel opening' : 'huandu-panel';
    panel.innerHTML = `
      <div class="panel-top">
        <div class="brand">缓读</div>
        <button class="close-btn" data-role="close" aria-label="关闭">×</button>
      </div>
      <p class="tagline">把阅读调成适合你的样子</p>

      <div class="segmented" data-role="theme-group">
        ${['gentle', 'focus', 'custom']
          .map(
            (t) =>
              `<button data-theme="${t}" class="${prefs.theme === t ? 'selected' : ''}">${
                { gentle: '温和', focus: '专注', custom: '自定义' }[t]
              }</button>`
          )
          .join('')}
      </div>

      ${
        prefs.theme === 'custom'
          ? `<div class="custom-colors">
              <label>背景 <input type="color" data-role="custom-bg" value="${prefs.customColors.bg}" /></label>
              <label>文字 <input type="color" data-role="custom-text" value="${prefs.customColors.text}" /></label>
            </div>`
          : ''
      }

      <div class="setting">
        <span>字号 <b data-role="font-size-value">${prefs.fontSize}</b></span>
        <div class="stepper">
          <button data-role="font-minus" ${prefs.fontSize <= FONT_MIN ? 'disabled' : ''}>−</button>
          <input type="range" min="${FONT_MIN}" max="${FONT_MAX}" step="1" value="${prefs.fontSize}" data-role="font-size" />
          <button data-role="font-plus" ${prefs.fontSize >= FONT_MAX ? 'disabled' : ''}>＋</button>
        </div>
      </div>

      <div class="width-row">
        <span>内容宽度</span>
        <button data-width="wide" class="${prefs.contentWidth === 'wide' ? 'active' : ''}">宽</button>
        <button data-width="narrow" class="${prefs.contentWidth === 'narrow' ? 'active' : ''}">窄</button>
      </div>

      <div class="setting">
        <span>行间距 <b data-role="line-height-value">${prefs.lineHeight}</b></span>
        <input type="range" min="${LINE_HEIGHT_MIN}" max="${LINE_HEIGHT_MAX}" step="0.1" value="${prefs.lineHeight}" data-role="line-height" />
      </div>

      <div class="setting">
        <span>字间距 <b data-role="letter-spacing-value">${prefs.letterSpacing}em</b></span>
        <input type="range" min="${LETTER_SPACING_MIN}" max="${LETTER_SPACING_MAX}" step="0.01" value="${prefs.letterSpacing}" data-role="letter-spacing" />
      </div>

      <div class="noise-main">
        <label>动态降噪</label>
        <button class="switch ${prefs.noiseReduction ? 'on' : ''}" data-role="noise-switch"><span></span></button>
      </div>
      <div class="noise-settings ${prefs.noiseReduction ? '' : 'disabled'}" data-role="noise-settings">
        ${Object.keys(noiseFilter.NOISE_GROUPS)
          .map(
            (key) => `
          <div class="noise-row">
            <span>${noiseLabels[key]}</span>
            <button class="switch small ${prefs.noiseOptions[key] ? 'on' : ''}" data-noise-key="${key}"><span></span></button>
          </div>`
          )
          .join('')}
      </div>
      <p class="noise-feedback">本页已隐藏 <b data-role="noise-count">${readerLayer.getHiddenCount()}</b> 个干扰元素</p>

      <div class="noise-main">
        <label>AI 摘要</label>
        <button class="switch ${prefs.aiEnabled ? 'on' : ''}" data-role="ai-switch"><span></span></button>
      </div>
      <div class="ai-settings ${prefs.aiEnabled ? '' : 'disabled'}" data-role="ai-settings">
        <p class="ai-hint">正文将发送到缓读后端生成摘要，不会用于其他用途。</p>
        <button class="ai-generate" data-role="ai-generate">${readerLayer.getSummary() ? '重新生成摘要' : '生成摘要'}</button>
        <div class="ai-progress" data-role="ai-progress" hidden><div class="ai-progress-bar"></div></div>
        <p class="ai-status" data-role="ai-status"></p>
      </div>

      <button class="restore" data-role="restore">恢复原网页</button>
    `;
    shadow.appendChild(panel);

    // 事件绑定
    panel.querySelector('[data-role="close"]').addEventListener('click', () => close(panel));

    panel.querySelectorAll('[data-theme]').forEach((btn) => {
      btn.addEventListener('click', () => {
        prefs.theme = btn.getAttribute('data-theme');
        prefs.enabled = true;
        prefsStore.save();
        appController.applyAll();
        render();
      });
    });

    const customBg = panel.querySelector('[data-role="custom-bg"]');
    const customText = panel.querySelector('[data-role="custom-text"]');
    if (customBg && customText) {
      customBg.addEventListener('input', () => {
        prefs.customColors.bg = customBg.value;
        appController.applyAll();
      });
      customText.addEventListener('input', () => {
        prefs.customColors.text = customText.value;
        appController.applyAll();
      });
      [customBg, customText].forEach((input) => input.addEventListener('change', prefsStore.save));
    }

    const fontInput = panel.querySelector('[data-role="font-size"]');
    function setFontSize(value) {
      prefs.fontSize = Math.min(FONT_MAX, Math.max(FONT_MIN, value));
      prefs.enabled = true;
      appController.applyAll();
      prefsStore.save();
      render();
    }
    fontInput.addEventListener('input', () => {
      prefs.fontSize = Number(fontInput.value);
      prefs.enabled = true;
      panel.querySelector('[data-role="font-size-value"]').textContent = prefs.fontSize;
      appController.applyAll();
    });
    fontInput.addEventListener('change', prefsStore.save);
    panel.querySelector('[data-role="font-minus"]').addEventListener('click', () => setFontSize(prefs.fontSize - 1));
    panel.querySelector('[data-role="font-plus"]').addEventListener('click', () => setFontSize(prefs.fontSize + 1));

    panel.querySelectorAll('[data-width]').forEach((btn) => {
      btn.addEventListener('click', () => {
        prefs.contentWidth = btn.getAttribute('data-width');
        prefs.enabled = true;
        prefsStore.save();
        appController.applyAll();
        render();
      });
    });

    const lineHeightInput = panel.querySelector('[data-role="line-height"]');
    lineHeightInput.addEventListener('input', () => {
      prefs.lineHeight = Number(lineHeightInput.value);
      prefs.enabled = true;
      panel.querySelector('[data-role="line-height-value"]').textContent = prefs.lineHeight;
      appController.applyAll();
    });
    lineHeightInput.addEventListener('change', prefsStore.save);

    const letterSpacingInput = panel.querySelector('[data-role="letter-spacing"]');
    letterSpacingInput.addEventListener('input', () => {
      prefs.letterSpacing = Number(letterSpacingInput.value);
      prefs.enabled = true;
      panel.querySelector('[data-role="letter-spacing-value"]').textContent = `${prefs.letterSpacing}em`;
      appController.applyAll();
    });
    letterSpacingInput.addEventListener('change', prefsStore.save);

    panel.querySelector('[data-role="noise-switch"]').addEventListener('click', () => {
      prefs.noiseReduction = !prefs.noiseReduction;
      prefsStore.save();
      appController.applyAll();
      render();
    });

    panel.querySelectorAll('[data-noise-key]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-noise-key');
        prefs.noiseOptions[key] = !prefs.noiseOptions[key];
        prefsStore.save();
        appController.applyAll();
        render();
      });
    });

    panel.querySelector('[data-role="restore"]').addEventListener('click', appController.restoreOriginalPage);

    panel.querySelector('[data-role="ai-switch"]').addEventListener('click', () => {
      prefs.aiEnabled = !prefs.aiEnabled;
      prefsStore.save();
      render();
    });

    const statusEl = panel.querySelector('[data-role="ai-status"]');
    const generateBtn = panel.querySelector('[data-role="ai-generate"]');
    const progressEl = panel.querySelector('[data-role="ai-progress"]');
    generateBtn.addEventListener('click', async () => {
      const { aiClient } = window.Huandu;
      const articleText = readerLayer.getArticleText();
      if (!articleText) {
        statusEl.textContent = '未找到正文内容';
        return;
      }
      generateBtn.disabled = true;
      progressEl.hidden = false;
      statusEl.classList.remove('error');

      // 后端是一次性返回完整摘要（非流式），这里没有真实进度可读。
      // 用分阶段文案模拟过程感，减轻"卡住了"的感觉，时间点是估的，不代表真实耗时。
      const stages = ['正在读取正文…', '正在分析内容…', '正在生成摘要…'];
      let stageIndex = 0;
      statusEl.textContent = stages[0];
      const stageTimer = setInterval(() => {
        stageIndex = Math.min(stageIndex + 1, stages.length - 1);
        statusEl.textContent = stages[stageIndex];
      }, 3000);

      try {
        const summary = await aiClient.summarize(articleText);
        readerLayer.setSummary(summary);
        appController.applyAll();
        render();
      } catch (err) {
        statusEl.classList.add('error');
        statusEl.textContent = err.message || 'AI 摘要生成失败';
        generateBtn.disabled = false;
        progressEl.hidden = true;
      } finally {
        clearInterval(stageTimer);
      }
    });
  }

  const PANEL_CSS = `
    :host { all: initial; }
    .huandu-panel {
      position: fixed;
      top: 78px;
      right: 18px;
      width: 330px;
      padding: 17px 17px 13px;
      font-family: "Noto Sans SC", -apple-system, sans-serif;
      font-size: 12px;
      color: #33403a;
      background: #fffdf9;
      border: 1px solid #ccd4ce;
      border-radius: 7px;
      box-shadow: 0 18px 46px rgba(37, 59, 51, 0.12);
      transform-origin: top right;
    }
    .huandu-panel.opening { animation: huandu-in 0.16s ease-out; }
    .huandu-panel.closing { animation: huandu-out 0.14s ease-in forwards; }
    @keyframes huandu-in {
      from { opacity: 0; transform: scale(0.96) translateY(-4px); }
      to { opacity: 1; transform: scale(1) translateY(0); }
    }
    @keyframes huandu-out {
      from { opacity: 1; transform: scale(1) translateY(0); }
      to { opacity: 0; transform: scale(0.96) translateY(-4px); }
    }
    .panel-top { display: flex; justify-content: space-between; align-items: flex-start; }
    .brand { font-size: 18px; font-weight: 700; color: #21463f; }
    .close-btn {
      background: none; border: 0; font-size: 16px; line-height: 1; color: #7c8580;
      cursor: pointer; padding: 2px 4px;
    }
    .close-btn:hover { color: #33403a; }
    .tagline { margin: 5px 0 14px; font-size: 11px; color: #287e72; }
    .segmented {
      display: grid; grid-template-columns: repeat(3, 1fr);
      background: #eef1ed; border-radius: 4px; padding: 2px; margin-bottom: 10px;
    }
    .segmented button {
      background: none; border: 0; border-radius: 3px; padding: 5px; font-size: 11px;
      color: #65716a; cursor: pointer; transition: background 0.15s, color 0.15s;
    }
    .segmented button.selected { background: #fff; color: #19786c; font-weight: 600; box-shadow: 0 1px 3px rgba(32,44,37,0.08); }
    .custom-colors { display: flex; gap: 14px; margin-bottom: 10px; font-size: 11px; color: #56625c; }
    .custom-colors label { display: flex; align-items: center; gap: 6px; }
    .custom-colors input[type="color"] { width: 24px; height: 20px; border: 1px solid #d7ded8; border-radius: 3px; padding: 0; cursor: pointer; }
    .setting { margin: 8px 0; }
    .setting span { display: flex; justify-content: space-between; color: #56625c; margin-bottom: 4px; }
    .setting b { color: #278477; font-weight: 500; }
    .stepper { display: flex; align-items: center; gap: 6px; }
    .stepper input[type="range"] { flex: 1; accent-color: #258578; }
    .stepper button {
      width: 20px; height: 20px; flex: none; border: 1px solid #d7ded8; border-radius: 4px;
      background: #fff; color: #59625e; cursor: pointer; font-size: 13px; line-height: 1;
      display: flex; align-items: center; justify-content: center; transition: background 0.15s;
    }
    .stepper button:hover:not(:disabled) { background: #eef1ed; }
    .stepper button:disabled { opacity: 0.4; cursor: default; }
    .width-row { display: flex; align-items: center; gap: 5px; margin-top: 8px; color: #56625c; }
    .width-row span { margin-right: auto; }
    .width-row button {
      background: none; border: 0; border-radius: 3px; padding: 5px; font-size: 11px;
      color: #65716a; cursor: pointer; transition: background 0.15s, color 0.15s;
    }
    .width-row button.active { color: #187a6e; background: #deeee8; }
    .noise-main {
      display: flex; justify-content: space-between; align-items: center;
      background: #eaf5f0; border-radius: 5px; margin: 10px 0 6px; padding: 10px 11px;
    }
    .noise-main label { font-size: 12px; font-weight: 700; color: #246d62; }
    .switch {
      cursor: pointer; background: #c8d0ca; border: 0; border-radius: 999px;
      width: 33px; height: 18px; padding: 2px; transition: background 0.18s;
    }
    .switch span { display: block; width: 14px; height: 14px; background: #fff; border-radius: 50%; transition: transform 0.18s; box-shadow: 0 1px 2px rgba(0,0,0,0.13); }
    .switch.on { background: #1f8b7d; }
    .switch.on span { transform: translateX(15px); }
    .switch.small { width: 27px; height: 15px; }
    .switch.small span { width: 11px; height: 11px; }
    .switch.small.on span { transform: translateX(12px); }
    .noise-settings { display: flex; flex-direction: column; gap: 3px; margin: 0 0 6px 4px; transition: opacity 0.15s; }
    .noise-settings.disabled { opacity: 0.45; pointer-events: none; }
    .noise-row { display: flex; justify-content: space-between; align-items: center; height: 26px; color: #53615a; }
    .noise-feedback { margin: 7px 0 0; font-size: 10px; color: #718078; }
    .ai-settings { margin: 0 0 6px 4px; transition: opacity 0.15s; }
    .ai-settings.disabled { opacity: 0.45; pointer-events: none; }
    .ai-hint { margin: 4px 0 8px; font-size: 10px; color: #718078; line-height: 1.5; }
    .ai-generate {
      width: 100%; height: 28px; border: 1px solid #d7ded8; border-radius: 4px;
      background: #fff; color: #246d62; font-size: 12px; cursor: pointer; transition: background 0.15s;
    }
    .ai-generate:hover:not(:disabled) { background: #eaf5f0; }
    .ai-generate:disabled { opacity: 0.6; cursor: default; }
    .ai-progress { margin: 8px 0 0; height: 3px; border-radius: 999px; background: #e3ece7; overflow: hidden; }
    .ai-progress-bar { width: 40%; height: 100%; border-radius: 999px; background: #1f8b7d; animation: huandu-ai-progress 1.1s ease-in-out infinite; }
    @keyframes huandu-ai-progress {
      0% { transform: translateX(-100%); }
      100% { transform: translateX(250%); }
    }
    .ai-status { margin: 6px 0 0; font-size: 10px; color: #718078; min-height: 12px; }
    .ai-status.error { color: #b95042; }
    .restore {
      width: 100%; height: 30px; margin: 15px 0 0; display: flex; align-items: center; justify-content: center;
      color: #53615a; background: #fff; border: 1px solid #d7ded8; border-radius: 4px; cursor: pointer; font-size: 12px;
      transition: background 0.15s;
    }
    .restore:hover { background: #f6f8f5; }
  `;

  window.Huandu.panelUI = {
    toggle,
    render,
    updateNoiseCount,
  };
})();
