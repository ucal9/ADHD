// Copyright (c) 2026 Insta360. All rights reserved.
// INS_Reader · 设置面板模块
// 职责：渲染用户设置面板，Shadow DOM 隔离样式。面板分两级：
// 一级入口界面只展示 Logo/Slogan、一键降噪（阅读模式总开关，关闭即恢复原网页）与
// 【我的预设】入口（沿用原"详细配置"按钮的展开逻辑，AI 内容助手总开关也一并挪入其中）；
// 点【我的预设】后展开二级面板（主题、排版、预设管理、动态降噪细分开关、AI 二级细分开关）。
// 依赖 INS_Reader.prefsStore / readerLayer / aiClient / pageMeta / appController。
// 面板自身不决定"是否应用"，只负责收集用户输入后回调 INS_Reader.appController
// 提供的 applyAll/restoreOriginalPage；点击"生成摘要"时直接调用 aiClient.summarize()，
// 成功后把结果写入 readerLayer.setSummary() 再重新渲染；点击"应用高亮"时调用
// aiClient.highlight()（把三个子开关状态传给后端），成功后把返回的正文 HTML 写入
// readerLayer.setHighlightHtml() 再重新渲染。当前页面被判定不适合阅读模式时
// （readerLayer.getLastFeasibilityReason() 非空），改为展示"生成内容概览"入口：用
// pageMeta.extract() 抓取标题/描述文本，同样交给 aiClient.summarize() 生成概览，
// 结果只存在面板本地状态（不写入 prefsStore/readerLayer，关闭面板即丢弃）。
// 调用者：content.js 把 updateNoiseCount 注册为 readerLayer 的降噪计数回调；
// content.js 收到 INS_READER_TOGGLE_PANEL 消息时调用 toggle()。

window.INS_Reader = window.INS_Reader || {};

(function () {
  const FONT_MIN = 14;
  const FONT_MAX = 28;
  const LINE_HEIGHT_MIN = 1.5;
  const LINE_HEIGHT_MAX = 2.2;
  const PARAGRAPH_SPACING_MIN = 1.0;
  const PARAGRAPH_SPACING_MAX = 2.0;
  const LETTER_SPACING_MIN = 0;
  const LETTER_SPACING_MAX = 0.12;

  const FONT_FAMILIES = {
    default: '系统默认',
    serif: '宋体',
    'sans-serif': '黑体',
    monospace: '等宽',
  };

  // 页面底色调色盘（PRD：排版栏目新增自定义调色盘）
  const BG_SWATCHES = [
    { bg: '#fbfcfa', text: '#3b4540', label: '米白' },
    { bg: '#f5efe1', text: '#4a4034', label: '纸黄' },
    { bg: '#e8f0e6', text: '#33443a', label: '浅绿' },
    { bg: '#e6edf5', text: '#333f4a', label: '浅蓝' },
    { bg: '#f7e9ec', text: '#4a3639', label: '浅粉' },
    { bg: '#20211f', text: '#ecede8', label: '深灰' },
  ];

  // 四个数值型排版项统一用 +/- 步进器（PRD：不使用拖动条，直接加减数值）
  const STEPPERS = [
    { key: 'fontSize', label: '字号', min: FONT_MIN, max: FONT_MAX, step: 1, digits: 0, suffix: '' },
    { key: 'lineHeight', label: '行间距', min: LINE_HEIGHT_MIN, max: LINE_HEIGHT_MAX, step: 0.1, digits: 1, suffix: '' },
    {
      key: 'paragraphSpacing',
      label: '段落间距',
      min: PARAGRAPH_SPACING_MIN,
      max: PARAGRAPH_SPACING_MAX,
      step: 0.1,
      digits: 1,
      suffix: '×',
    },
    {
      key: 'letterSpacing',
      label: '字间距',
      min: LETTER_SPACING_MIN,
      max: LETTER_SPACING_MAX,
      step: 0.01,
      digits: 2,
      suffix: 'em',
    },
  ];

  // 把浮点步进结果修正到指定小数位，避免 0.1 累加出现 1.7000000000000002
  function INS_roundTo(value, digits) {
    return Number(value.toFixed(digits));
  }

  // 套用预设：深拷贝写回，避免 prefs 与预设共享嵌套对象引用
  // （否则套用后改设置会连带修改已保存的预设）。
  function INS_applyPreset(preset) {
    const { prefsStore, appController } = window.INS_Reader;
    const prefs = prefsStore.get();
    if (!preset || !preset.prefs) return;
    Object.assign(prefs, JSON.parse(JSON.stringify(preset.prefs)));
    prefs.enabled = true;
    prefsStore.save();
    appController.applyAll();
    INS_render();
  }

  const state = {
    panelHost: null,
    isExpanded: false,
    pageOverviewText: '',
    pageOverviewStatus: '',
    pageOverviewError: '',
    expandedGroups: { typography: false, noise: false, ai: false }, // 二级配置里"排版/降噪/
    // AI 内容助手"三个栏目各自独立展开/收起自己的设置内容，可以同时展开多个，不是手风琴互斥、
    // 也不是整页替换/跳转。
    savePresetDialogOpen: false, // 面板内自定义的"保存预设"命名弹层是否展示
  };

  function INS_ensurePanelHost() {
    if (state.panelHost) return state.panelHost;
    state.panelHost = document.createElement('div');
    state.panelHost.id = 'ins-reader-panel-host';
    state.panelHost.style.position = 'fixed';
    state.panelHost.style.top = '0';
    state.panelHost.style.left = '0';
    state.panelHost.style.width = '0';
    state.panelHost.style.height = '0';
    state.panelHost.style.zIndex = '2147483647';
    document.documentElement.appendChild(state.panelHost);
    return state.panelHost;
  }

  function INS_isOpen() {
    const shadow = state.panelHost && state.panelHost.shadowRoot;
    return !!(shadow && shadow.querySelector('.ins-reader-panel'));
  }

  function INS_updateNoiseCount(count) {
    const shadow = state.panelHost && state.panelHost.shadowRoot;
    if (!shadow) return;
    const countEl = shadow.querySelector('[data-role="noise-count"]');
    if (countEl) countEl.textContent = String(count);
  }

  function INS_toggle() {
    const host = INS_ensurePanelHost();
    const shadow = host.shadowRoot;
    const existing = shadow && shadow.querySelector('.ins-reader-panel');
    if (existing) {
      INS_close(existing);
      return;
    }
    INS_render();
  }

  function INS_close(panelEl) {
    panelEl.classList.add('closing');
    panelEl.addEventListener('animationend', () => panelEl.remove(), { once: true });
  }

  function INS_render() {
    const { prefsStore, readerLayer, appController } = window.INS_Reader;
    const prefs = prefsStore.get();

    const host = INS_ensurePanelHost();
    let shadow = host.shadowRoot;
    if (!shadow) shadow = host.attachShadow({ mode: 'open' });
    const isFirstOpen = !shadow.querySelector('.ins-reader-panel');
    shadow.innerHTML = '';

    const style = document.createElement('style');
    style.textContent = PANEL_CSS;
    shadow.appendChild(style);

    // 动态降噪模块暴露这 4 项开关，其余降噪选择器（广告推荐/会员登录推销）
    // 仍在 noiseFilter 里按默认值生效，只是不再作为用户可调的开关出现在这个模块里。
    // "视频（暂停播放并隐藏）"是一个开关同时驱动两个动作：暂停原页面自动播放 + 从
    // 阅读层克隆体里摘掉视频容器，两者始终同开同关，不再拆成两个独立开关。
    const noiseLabels = {
      sidebar: '隐藏侧边栏',
      comments: '隐藏评论区',
      banners: '隐藏弹窗横幅',
      video: '视频（暂停播放并隐藏）',
    };

    const noiseOrder = ['sidebar', 'comments', 'banners', 'video'];

    const feasibilityReason = readerLayer.getLastFeasibilityReason();
    const feasibilityMessages = {
      domain: '此页面暂不支持阅读模式（识别为视频/流媒体网站）',
      video: '此页面暂不支持阅读模式（检测到视频内容为主）',
      'thin-content': '此页面暂不支持阅读模式（未能识别到足够的正文内容）',
    };

    const panel = document.createElement('div');
    panel.className = isFirstOpen ? 'ins-reader-panel opening' : 'ins-reader-panel';
    panel.classList.toggle('expanded', state.isExpanded);

    let panelHTML = '';

    if (state.isExpanded) {
      // 二级详细配置：保留【‹ 返回】与【×】关闭，一级简易视图的开关不出现在这里。
      panelHTML += `
        <div class="panel-top">
          <button class="back-btn" data-role="collapse-btn" aria-label="返回">‹ 返回</button>
          <div class="brand">缓读</div>
          <button class="close-btn" data-role="close" aria-label="关闭">×</button>
        </div>
        <p class="tagline">把阅读调成适合你的样子</p>
      `;
      panelHTML += `
        ${
          feasibilityReason
            ? `<div class="feasibility-notice">
                <p class="feasibility-notice-text">${
                  feasibilityMessages[feasibilityReason] || '此页面暂不支持阅读模式'
                }</p>
                <button class="overview-generate" data-role="overview-generate" ${
                  state.pageOverviewStatus === 'loading' ? 'disabled' : ''
                }>
                  ${state.pageOverviewText ? '重新生成内容概览' : '生成内容概览'}
                </button>
                ${state.pageOverviewStatus === 'loading' ? '<p class="overview-status">正在生成…</p>' : ''}
                ${
                  state.pageOverviewStatus === 'error'
                    ? `<p class="overview-status error" data-role="overview-error"></p>`
                    : ''
                }
                ${
                  state.pageOverviewText
                    ? `<div class="overview-result">
                        <p class="overview-body" data-role="overview-body"></p>
                        <p class="overview-disclaimer">基于页面标题与简介生成，可能不完整</p>
                      </div>`
                    : ''
                }
              </div>`
            : ''
        }

        <div class="nav-row ${state.expandedGroups.typography ? 'open' : ''}">
          <button class="nav-row-main" data-role="group-open-typography">
            <span class="group-label">排版</span>
            <span class="nav-chevron">›</span>
          </button>
          <button class="switch small group-master-switch ${prefs.typographyEnabled ? 'on' : ''}" data-role="typography-master-switch" aria-label="排版总开关"><span></span></button>
        </div>
        ${
          state.expandedGroups.typography
            ? `
        <div class="group-content">
          ${
            !prefs.typographyEnabled
              ? '<p class="ai-hint">排版总开关已关闭，阅读层使用系统默认外观；开启后可自定义字号/字体/颜色等。</p>'
              : `
          <div class="setting">
            <span>页面底色</span>
            <div class="bg-swatches">
              ${BG_SWATCHES.map(
                (s) =>
                  `<button class="bg-swatch ${
                    prefs.customColors.bg.toLowerCase() === s.bg ? 'active' : ''
                  }" data-swatch-bg="${s.bg}" data-swatch-text="${s.text}" title="${s.label}" aria-label="${s.label}" style="background:${s.bg}"></button>`
              ).join('')}
            </div>
          </div>

          <div class="custom-colors">
            <label>背景 <input type="color" data-role="custom-bg" value="${prefs.customColors.bg}" /></label>
            <label>文字 <input type="color" data-role="custom-text" value="${prefs.customColors.text}" /></label>
          </div>

          ${STEPPERS.map(
            (s) => `
          <div class="setting row">
            <span>${s.label}</span>
            <div class="stepper">
              <button data-step-key="${s.key}" data-step-dir="-1" ${
              prefs[s.key] <= s.min ? 'disabled' : ''
            } aria-label="减小${s.label}">−</button>
              <span class="step-value-wrap">
                <input type="number" class="step-value-input" data-step-input="${s.key}" inputmode="decimal"
                  step="${s.step}" min="${s.min}" max="${s.max}" value="${prefs[s.key].toFixed(s.digits)}"
                  aria-label="${s.label}数值" />${s.suffix ? `<span class="step-suffix">${s.suffix}</span>` : ''}
              </span>
              <button data-step-key="${s.key}" data-step-dir="1" ${
              prefs[s.key] >= s.max ? 'disabled' : ''
            } aria-label="增大${s.label}">＋</button>
            </div>
          </div>`
          ).join('')}

          <div class="setting">
            <span>字体</span>
            <div class="font-options">
              ${Object.entries(FONT_FAMILIES)
                .map(
                  ([key, label]) =>
                    `<button data-font="${key}" class="font-btn ${prefs.fontFamily === key ? 'active' : ''}">${label}</button>`
                )
                .join('')}
            </div>
          </div>`
          }
        </div>`
            : ''
        }

        <div class="nav-row ${state.expandedGroups.noise ? 'open' : ''}">
          <button class="nav-row-main" data-role="group-open-noise">
            <span class="group-label">降噪</span>
            <span class="nav-chevron">›</span>
          </button>
          <button class="switch small group-master-switch ${prefs.noiseReduction ? 'on' : ''}" data-role="noise-master-switch" aria-label="降噪总开关"><span></span></button>
        </div>
        ${
          state.expandedGroups.noise
            ? `
        <div class="group-content">
          ${noiseOrder
            .map(
              (key) => `
          <div class="noise-row">
            <span>${noiseLabels[key]}</span>
            <button class="switch small ${prefs.noiseOptions[key] ? 'on' : ''}" data-noise-key="${key}"><span></span></button>
          </div>`
            )
            .join('')}
          <p class="noise-reset-hint">关闭此开关会直接退出阅读视图并显示原网页；排版与 AI 设置不受影响，重新开启后自动恢复。</p>
          <p class="noise-risk-disclaimer">"视频（暂停播放并隐藏）"可能影响页面正常播放或功能，请谨慎开启</p>
          <p class="noise-reset-hint">降噪只作用于阅读层的克隆内容，关闭对应开关即可立即恢复，无需刷新页面。</p>
          <p class="noise-feedback">本页已隐藏 <b data-role="noise-count">${readerLayer.getHiddenCount()}</b> 个干扰元素</p>
        </div>`
            : ''
        }

        <div class="nav-row ${state.expandedGroups.ai ? 'open' : ''}">
          <button class="nav-row-main" data-role="group-open-ai">
            <span class="group-label">AI 内容助手</span>
            <span class="nav-chevron">›</span>
          </button>
          <button class="switch small group-master-switch ${prefs.aiEnabled ? 'on' : ''}" data-role="ai-master-switch" aria-label="AI 内容助手总开关"><span></span></button>
        </div>
        ${
          state.expandedGroups.ai
            ? `
        <div class="group-content">
          ${
            !prefs.aiEnabled
              ? '<p class="ai-hint">AI 内容助手总开关已关闭，开启后可在此配置摘要与高亮。</p>'
              : `
          <div class="ai-row">
            <span>AI 摘要</span>
            <button class="switch small ${prefs.aiSummary ? 'on' : ''}" data-role="ai-summary-switch" aria-label="AI 摘要开关"><span></span></button>
          </div>
          <div class="ai-row">
            <span>拆分长段落</span>
            <button class="switch small ${prefs.aiHighlight.breakLongParagraphs ? 'on' : ''}" data-highlight-key="breakLongParagraphs" aria-label="拆分长段落开关"><span></span></button>
          </div>
          <div class="ai-row">
            <span>简化复杂长句</span>
            <button class="switch small ${prefs.aiHighlight.simplifySentences ? 'on' : ''}" data-highlight-key="simplifySentences" aria-label="简化复杂长句开关"><span></span></button>
          </div>
          <div class="ai-row">
            <span>标记核心信息</span>
            <button class="switch small ${prefs.aiHighlight.markKeyInfo ? 'on' : ''}" data-highlight-key="markKeyInfo" aria-label="标记核心信息开关"><span></span></button>
          </div>
          <div class="setting row">
            <span>内容版本</span>
            <div class="font-options">
              <button class="font-btn ${readerLayer.getContentVersion() === 'original' ? 'active' : ''}" data-role="content-version-original">原文</button>
              <button class="font-btn ${readerLayer.getContentVersion() === 'digest' ? 'active' : ''}" data-role="content-version-digest">缓读版</button>
            </div>
          </div>
          <p class="ai-hint">正文将发送到 INS_Reader 后端处理，不会用于其他用途。</p>
          <div class="ai-progress" data-role="ai-content-progress" hidden><div class="ai-progress-bar"></div></div>
          <p class="ai-status" data-role="ai-content-status"></p>`
          }
        </div>`
            : ''
        }

        <div class="presets-section">
          <button class="save-preset" data-role="save-preset">+ 保存当前配置为预设</button>
          ${
            prefs.presets && prefs.presets.length > 0
              ? `<div class="presets-header">我的预设</div>
                <div class="presets-list">
                  ${prefs.presets
                    .map(
                      (p, idx) => `
                    <div class="preset-item">
                      <button class="preset-apply" data-preset-index="${idx}">${p.name}</button>
                      <button class="preset-delete" data-preset-index="${idx}" aria-label="删除预设">×</button>
                    </div>`
                    )
                    .join('')}
                </div>`
              : ''
          }
        </div>

        <button class="restore" data-role="restore">恢复原网页</button>

        ${
          state.savePresetDialogOpen
            ? `<div class="dialog-overlay" data-role="preset-dialog-overlay">
                <div class="dialog-card">
                  <p class="dialog-title">保存预设</p>
                  <input type="text" class="dialog-input" data-role="preset-name-input" placeholder="请输入预设名称" maxlength="20" autofocus />
                  <p class="dialog-error" data-role="preset-name-error" hidden></p>
                  <div class="dialog-actions">
                    <button class="dialog-btn dialog-btn-cancel" data-role="preset-name-cancel">取消</button>
                    <button class="dialog-btn dialog-btn-confirm" data-role="preset-name-confirm">确定</button>
                  </div>
                </div>
              </div>`
            : ''
        }
      `;
    } else {
      // 一级简易视图：不展示【‹ 返回】/【×】，图标+标题+一键降噪开关合并在同一行，
      // 底部改为分割线 + 右对齐的【详细配置 ›】文字链接（原来的"我的预设"按钮文案
      // 与上方预设列表标题重名混淆，按设计稿改名并改成 nav-link 样式）。
      panelHTML += `
        <div class="simple-mode">
          <div class="simple-header">
            <span class="brand-icon" aria-hidden="true"><span></span><span></span><span></span></span>
            <span class="simple-title">缓读</span>
            <button class="switch ${prefs.enabled ? 'on' : ''}" data-role="simple-noise-toggle" aria-label="一键降噪"><span></span></button>
          </div>
          <p class="tagline">把阅读调成适合你的样子</p>

          ${
            prefs.presets && prefs.presets.length > 0
              ? `<div class="simple-presets">
                  <div class="simple-presets-title">我的预设</div>
                  ${prefs.presets
                    .map(
                      (p, idx) =>
                        `<button class="simple-preset-btn" data-preset-index="${idx}">${p.name}</button>`
                    )
                    .join('')}
                </div>`
              : ''
          }

          <hr class="simple-divider" />
          <button class="detail-link" data-role="expand-btn">详细配置<span class="chevron">›</span></button>
        </div>
      `;
    }

    panel.innerHTML = panelHTML;
    shadow.appendChild(panel);

    // 概览文本用 textContent 写入
    const overviewBodyEl = panel.querySelector('[data-role="overview-body"]');
    if (overviewBodyEl) overviewBodyEl.textContent = state.pageOverviewText;
    const overviewErrorEl = panel.querySelector('[data-role="overview-error"]');
    if (overviewErrorEl) overviewErrorEl.textContent = state.pageOverviewError || '生成失败';

    // ===== 事件绑定 =====
    // 一级简易视图没有独立的关闭按钮（改为图标+标题+开关合并一行），只有二级详细配置才有。
    const closeBtn = panel.querySelector('[data-role="close"]');
    if (closeBtn) closeBtn.addEventListener('click', () => INS_close(panel));

    // 展开/收起详细配置
    const expandBtn = panel.querySelector('[data-role="expand-btn"]');
    if (expandBtn) {
      expandBtn.addEventListener('click', () => {
        state.isExpanded = true;
        INS_render();
      });
    }

    // 从详细配置返回入口界面
    const collapseBtn = panel.querySelector('[data-role="collapse-btn"]');
    if (collapseBtn) {
      collapseBtn.addEventListener('click', () => {
        state.isExpanded = false;
        state.expandedGroups = { typography: false, noise: false, ai: false };
        INS_render();
      });
    }

    // 页面概览生成
    const overviewBtn = panel.querySelector('[data-role="overview-generate"]');
    if (overviewBtn) {
      overviewBtn.addEventListener('click', async () => {
        const { pageMeta, aiClient } = window.INS_Reader;
        const metaText = pageMeta.extract();
        if (!metaText) {
          state.pageOverviewStatus = 'error';
          state.pageOverviewError = '未能提取到页面标题或简介';
          INS_render();
          return;
        }
        state.pageOverviewStatus = 'loading';
        state.pageOverviewError = '';
        INS_render();
        try {
          const overview = await aiClient.summarize(metaText);
          state.pageOverviewText = overview;
          state.pageOverviewStatus = '';
        } catch (err) {
          state.pageOverviewStatus = 'error';
          state.pageOverviewError = err.message || '生成失败';
        }
        INS_render();
      });
    }

    // 自定义颜色
    const customBg = panel.querySelector('[data-role="custom-bg"]');
    const customText = panel.querySelector('[data-role="custom-text"]');
    if (customBg && customText) {
      customBg.addEventListener('input', () => {
        prefs.customColors.bg = customBg.value;
        prefs.enabled = true;
        appController.applyAll();
      });
      customText.addEventListener('input', () => {
        prefs.customColors.text = customText.value;
        prefs.enabled = true;
        appController.applyAll();
      });
      [customBg, customText].forEach((input) => input.addEventListener('change', prefsStore.save));
    }

    // 页面底色调色盘：选中色板即写入前景/背景色
    panel.querySelectorAll('[data-swatch-bg]').forEach((btn) => {
      btn.addEventListener('click', () => {
        prefs.customColors.bg = btn.getAttribute('data-swatch-bg');
        prefs.customColors.text = btn.getAttribute('data-swatch-text');
        prefs.enabled = true;
        prefsStore.save();
        appController.applyAll();
        INS_render();
      });
    });

    // 四个数值型排版项的 +/- 步进器（字号/行间距/段落间距/字间距）
    panel.querySelectorAll('[data-step-key]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-step-key');
        const dir = Number(btn.getAttribute('data-step-dir'));
        const conf = STEPPERS.find((s) => s.key === key);
        if (!conf) return;
        const next = INS_roundTo(prefs[key] + dir * conf.step, conf.digits);
        prefs[key] = Math.min(conf.max, Math.max(conf.min, next));
        prefs.enabled = true;
        prefsStore.save();
        appController.applyAll();
        INS_render();
      });
    });

    // 四个数值型排版项的直接输入框：与 +/- 步进器共用同一批 STEPPERS 配置，
    // 失焦或按 Enter 时提交（而非每次按键都提交），避免输入过程中被重渲染打断。
    panel.querySelectorAll('[data-step-input]').forEach((input) => {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') input.blur();
      });
      input.addEventListener('change', () => {
        const key = input.getAttribute('data-step-input');
        const conf = STEPPERS.find((s) => s.key === key);
        if (!conf) return;
        const parsed = parseFloat(input.value);
        prefs[key] = Number.isFinite(parsed)
          ? INS_roundTo(Math.min(conf.max, Math.max(conf.min, parsed)), conf.digits)
          : prefs[key];
        prefs.enabled = true;
        prefsStore.save();
        appController.applyAll();
        INS_render();
      });
    });

    // 字体选择
    panel.querySelectorAll('[data-font]').forEach((btn) => {
      btn.addEventListener('click', () => {
        prefs.fontFamily = btn.getAttribute('data-font');
        prefs.enabled = true;
        prefsStore.save();
        appController.applyAll();
        INS_render();
      });
    });

    // 二级栏目导航：点击"排版"/"降噪"/"AI 内容助手"标题行原地展开/收起该栏目的设置内容——
    // 每个栏目独立维护自己的展开状态，可以同时展开多个，互不影响。
    const groupOpenButtons = {
      typography: panel.querySelector('[data-role="group-open-typography"]'),
      noise: panel.querySelector('[data-role="group-open-noise"]'),
      ai: panel.querySelector('[data-role="group-open-ai"]'),
    };
    Object.entries(groupOpenButtons).forEach(([group, btn]) => {
      if (!btn) return;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        state.expandedGroups[group] = !state.expandedGroups[group];
        INS_render();
      });
    });

    // AI 内容助手模块总开关（位于"AI 内容助手"栏目标题行右侧）
    const aiMasterSwitch = panel.querySelector('[data-role="ai-master-switch"]');
    if (aiMasterSwitch) {
      aiMasterSwitch.addEventListener('click', (e) => {
        e.stopPropagation();
        prefs.aiEnabled = !prefs.aiEnabled;
        prefs.enabled = true;
        prefsStore.save();
        appController.applyAll();
        INS_render();
      });
    }

    // 排版模块总开关（位于"排版"栏目标题行右侧，与展开/收起互不影响）
    const typographyMasterSwitch = panel.querySelector('[data-role="typography-master-switch"]');
    if (typographyMasterSwitch) {
      typographyMasterSwitch.addEventListener('click', (e) => {
        e.stopPropagation();
        prefs.typographyEnabled = !prefs.typographyEnabled;
        prefs.enabled = true;
        prefsStore.save();
        appController.applyAll();
        INS_render();
      });
    }

    // 降噪模块总开关（位于"降噪"栏目标题行右侧，与展开/收起互不影响）
    const noiseMasterSwitch = panel.querySelector('[data-role="noise-master-switch"]');
    if (noiseMasterSwitch) {
      noiseMasterSwitch.addEventListener('click', (e) => {
        e.stopPropagation();
        prefs.noiseReduction = !prefs.noiseReduction;
        prefs.enabled = true;
        prefsStore.save();
        appController.applyAll();
        INS_render();
      });
    }

    // AI 摘要开关（AI 内容助手详情页里的平级开关，与拆分长段落/简化复杂长句/标记核心信息同级）
    const aiSummarySwitch = panel.querySelector('[data-role="ai-summary-switch"]');
    if (aiSummarySwitch) {
      aiSummarySwitch.addEventListener('click', (e) => {
        e.stopPropagation();
        prefs.aiSummary = !prefs.aiSummary;
        prefs.enabled = true;
        prefsStore.save();
        appController.applyAll();
        INS_render();
      });
    }

    // 拆分长段落/简化复杂长句/标记核心信息：三个开关平级展示，不再有独立的"高亮"总开关——
    // aiHighlight.enabled 由三者中任意一项开启即自动置真，供 reader-layer.js 判断是否展示高亮结果。
    panel.querySelectorAll('[data-highlight-key]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const key = btn.getAttribute('data-highlight-key');
        prefs.aiHighlight[key] = !prefs.aiHighlight[key];
        prefs.aiHighlight.enabled =
          prefs.aiHighlight.breakLongParagraphs ||
          prefs.aiHighlight.simplifySentences ||
          prefs.aiHighlight.markKeyInfo;
        prefs.enabled = true;
        prefsStore.save();
        appController.applyAll();
        INS_render();
      });
    });

    // 内容版本切换（原文 / 缓读版）：切到缓读版时按需生成（已缓存则直接展示），切回原文不触发生成
    const contentStatusEl = panel.querySelector('[data-role="ai-content-status"]');
    const contentProgressEl = panel.querySelector('[data-role="ai-content-progress"]');
    const contentVersionOriginalBtn = panel.querySelector('[data-role="content-version-original"]');
    const contentVersionDigestBtn = panel.querySelector('[data-role="content-version-digest"]');

    if (contentVersionOriginalBtn) {
      contentVersionOriginalBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        readerLayer.setContentVersion('original');
        prefs.enabled = true;
        prefsStore.save();
        appController.applyAll();
        INS_render();
      });
    }

    if (contentVersionDigestBtn) {
      contentVersionDigestBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const { aiClient } = window.INS_Reader;
        const needSummary = prefs.aiSummary && !readerLayer.getSummary();
        const needHighlight = prefs.aiHighlight.enabled && !readerLayer.getHighlightHtml();

        if (!needSummary && !needHighlight) {
          readerLayer.setContentVersion('digest');
          prefs.enabled = true;
          prefsStore.save();
          appController.applyAll();
          INS_render();
          return;
        }

        const articleText = readerLayer.getArticleText();
        if (!articleText) {
          if (contentStatusEl) {
            contentStatusEl.classList.add('error');
            contentStatusEl.textContent = '未找到正文内容';
          }
          return;
        }

        contentVersionDigestBtn.disabled = true;
        if (contentProgressEl) contentProgressEl.hidden = false;
        if (contentStatusEl) {
          contentStatusEl.classList.remove('error');
          contentStatusEl.textContent = '正在生成缓读版…';
        }

        try {
          // 依次串行请求，不用 Promise.all 并发——内网 LLM 网关对同一客户端的并发连接不稳定，
          // 并发发两路请求时曾出现其中一路 ConnectError（All connection attempts failed）。
          if (needSummary) {
            const summary = await aiClient.summarize(articleText);
            readerLayer.setSummary(summary);
          }
          if (needHighlight) {
            const options = {
              break_long_paragraphs: !!prefs.aiHighlight.breakLongParagraphs,
              simplify_sentences: !!prefs.aiHighlight.simplifySentences,
              mark_key_info: !!prefs.aiHighlight.markKeyInfo,
            };
            const html = await aiClient.highlight(articleText, options);
            readerLayer.setHighlightHtml(html);
          }
          readerLayer.setContentVersion('digest');
          prefs.enabled = true;
          prefsStore.save();
          appController.applyAll();
          INS_render();
        } catch (err) {
          console.error('[INS_Reader][panel-ui] 生成缓读版失败', {
            name: err && err.name,
            message: err && err.message,
            stack: err && err.stack,
          });
          if (contentStatusEl) {
            contentStatusEl.classList.add('error');
            contentStatusEl.textContent = err.message || '生成缓读版失败';
          }
          contentVersionDigestBtn.disabled = false;
          if (contentProgressEl) contentProgressEl.hidden = true;
        }
      });
    }

    // 保存预设：点击按钮先做数量上限检查，通过后打开面板内自定义命名弹层（取代原生 prompt()）
    const savePresetBtn = panel.querySelector('[data-role="save-preset"]');
    if (savePresetBtn) {
      savePresetBtn.addEventListener('click', () => {
        if (prefs.presets.length >= 3) {
          alert('最多保存 3 个预设，请先删除旧预设');
          return;
        }
        state.savePresetDialogOpen = true;
        INS_render();
      });
    }

    // 命名弹层：确定按钮直接从 DOM 读取输入框当前值（不经过 state/每次按键重渲染），
    // 避免像 custom-bg/custom-text 那样因重渲染打断输入框焦点。
    const presetNameInput = panel.querySelector('[data-role="preset-name-input"]');
    const presetNameError = panel.querySelector('[data-role="preset-name-error"]');
    const presetDialogOverlay = panel.querySelector('[data-role="preset-dialog-overlay"]');
    const presetNameConfirm = panel.querySelector('[data-role="preset-name-confirm"]');
    const presetNameCancel = panel.querySelector('[data-role="preset-name-cancel"]');

    function INS_closeSaveDialog() {
      state.savePresetDialogOpen = false;
      INS_render();
    }

    function INS_confirmSaveDialog() {
      const presetName = (presetNameInput.value || '').trim();
      if (!presetName) {
        presetNameError.textContent = '请输入预设名称';
        presetNameError.hidden = false;
        return;
      }
      const existingName = prefs.presets.some((p) => p.name === presetName);
      if (existingName) {
        presetNameError.textContent = '预设名称已存在';
        presetNameError.hidden = false;
        return;
      }
      // 深拷贝快照：noiseOptions/customColors/aiHighlight 都是嵌套对象，浅拷贝会让
      // 预设与当前偏好共享同一个引用，之后改设置会把已保存的预设一起改掉。
      // 同时剔除 presets（避免预设自包含）和 deviceId（设备标识，不属于外观配置）。
      const prefsSnapshot = JSON.parse(JSON.stringify(prefs));
      delete prefsSnapshot.presets;
      delete prefsSnapshot.deviceId;
      prefs.presets.push({
        name: presetName,
        timestamp: Date.now(),
        prefs: prefsSnapshot,
      });
      prefsStore.save();
      state.savePresetDialogOpen = false;
      INS_render();
    }

    if (presetNameInput) {
      presetNameInput.focus();
      presetNameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') INS_confirmSaveDialog();
        if (e.key === 'Escape') INS_closeSaveDialog();
      });
    }
    if (presetNameConfirm) presetNameConfirm.addEventListener('click', INS_confirmSaveDialog);
    if (presetNameCancel) presetNameCancel.addEventListener('click', INS_closeSaveDialog);
    if (presetDialogOverlay) {
      presetDialogOverlay.addEventListener('click', (e) => {
        if (e.target === presetDialogOverlay) INS_closeSaveDialog();
      });
    }

    // 应用预设
    panel.querySelectorAll('.preset-apply').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.getAttribute('data-preset-index'));
        INS_applyPreset(prefs.presets[idx]);
      });
    });

    // 删除预设
    panel.querySelectorAll('.preset-delete').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.getAttribute('data-preset-index'));
        if (confirm('确定删除此预设？')) {
          prefs.presets.splice(idx, 1);
          prefsStore.save();
          INS_render();
        }
      });
    });

    // 一键降噪开关：本身就是阅读模式的总开关，关闭即直接恢复原网页，
    // 不是仅仅停用降噪子功能——用户预期"关掉这个开关=退出阅读模式"，
    // 与详细配置里"恢复原网页"按钮和弹出页"一键降噪"开关的效果保持一致。
    const simpleNoiseToggle = panel.querySelector('[data-role="simple-noise-toggle"]');
    if (simpleNoiseToggle) {
      simpleNoiseToggle.addEventListener('click', () => {
        if (prefs.enabled) {
          appController.restoreOriginalPage();
          return;
        }
        prefs.enabled = true;
        prefs.noiseReduction = true;
        prefsStore.save();
        appController.applyAll();
        INS_render();
      });
    }

    // 各降噪选项开关
    panel.querySelectorAll('[data-noise-key]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-noise-key');
        prefs.noiseOptions[key] = !prefs.noiseOptions[key];
        prefs.enabled = true;
        prefsStore.save();
        appController.applyAll();
        INS_render();
      });
    });

    // 简洁模式预设按钮
    panel.querySelectorAll('.simple-preset-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.getAttribute('data-preset-index'));
        INS_applyPreset(prefs.presets[idx]);
      });
    });

    const restoreBtn = panel.querySelector('[data-role="restore"]');
    if (restoreBtn) {
      restoreBtn.addEventListener('click', appController.restoreOriginalPage);
    }
  }

  const PANEL_CSS = `
    :host { all: initial; }
    .ins-reader-panel {
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
      max-height: 85vh;
      overflow-y: auto;
    }
    .ins-reader-panel.opening { animation: ins-reader-in 0.16s ease-out; }
    .ins-reader-panel.closing { animation: ins-reader-out 0.14s ease-in forwards; }
    @keyframes ins-reader-in {
      from { opacity: 0; transform: scale(0.96) translateY(-4px); }
      to { opacity: 1; transform: scale(1) translateY(0); }
    }
    @keyframes ins-reader-out {
      from { opacity: 1; transform: scale(1) translateY(0); }
      to { opacity: 0; transform: scale(0.96) translateY(-4px); }
    }
    .panel-top { display: flex; justify-content: space-between; align-items: flex-start; }
    .back-btn {
      border: none; background: transparent; color: #5f7a6c; cursor: pointer;
      font-size: 13px; padding: 0 8px 0 0; line-height: 1.4;
    }
    .back-btn:hover { color: #3b4540; }
    .brand { font-size: 18px; font-weight: 700; color: #21463f; }
    .close-btn {
      background: none; border: 0; font-size: 16px; line-height: 1; color: #7c8580;
      cursor: pointer; padding: 2px 4px;
    }
    .close-btn:hover { color: #33403a; }
    .tagline { margin: 5px 0 14px; font-size: 11px; color: #287e72; }
    .feasibility-notice {
      margin: 0 0 12px; padding: 8px 10px; border-radius: 5px;
      background: #fdf1ea; border: 1px solid #eecdb3; color: #9a5a2c;
      font-size: 11px; line-height: 1.5;
    }
    .feasibility-notice-text { margin: 0 0 8px; }
    .overview-generate {
      width: 100%; height: 26px; border: 1px solid #eecdb3; border-radius: 4px;
      background: #fff; color: #9a5a2c; font-size: 11px; cursor: pointer; transition: background 0.15s;
    }
    .overview-generate:hover:not(:disabled) { background: #fdf1ea; }
    .overview-generate:disabled { opacity: 0.6; cursor: default; }
    .overview-status { margin: 6px 0 0; font-size: 10px; color: #9a5a2c; }
    .overview-status.error { color: #b95042; }
    .overview-result { margin-top: 8px; padding-top: 8px; border-top: 1px solid #eecdb3; }
    .overview-body { margin: 0; font-size: 11px; line-height: 1.6; color: #5a4030; white-space: pre-line; }
    .overview-disclaimer { margin: 6px 0 0; font-size: 9px; color: #b08a63; }
    .segmented {
      display: grid; grid-template-columns: repeat(3, 1fr);
      background: #eef1ed; border-radius: 4px; padding: 2px; margin-bottom: 10px;
    }
    .segmented button {
      background: none; border: 0; border-radius: 3px; padding: 5px; font-size: 11px;
      color: #65716a; cursor: pointer; transition: background 0.15s, color 0.15s;
    }
    .segmented button.selected { background: #fff; color: #19786c; font-weight: 600; box-shadow: 0 1px 3px rgba(32,44,37,0.08); }
    .nav-row {
      display: flex; justify-content: space-between; align-items: center;
      width: 100%; padding: 8px 10px; background: #f4f8f5; border-radius: 5px;
      margin: 6px 0; transition: background 0.15s;
    }
    .nav-row:hover { background: #ecf4ee; }
    .nav-row-main {
      display: flex; align-items: center; gap: 6px; flex: 1;
      border: 0; background: none; padding: 0; margin: 0;
      font: inherit; font-size: 11px; font-weight: 700; color: #246d62; cursor: pointer;
    }
    .nav-row.open { background: #ecf4ee; }
    .nav-chevron { font-size: 13px; color: #7c9c93; display: inline-block; transition: transform 0.15s; }
    .nav-row.open .nav-chevron { transform: rotate(90deg); }
    .group-content { margin: 6px 2px 12px; padding: 0 2px; }
    .custom-colors { display: flex; gap: 14px; margin-bottom: 10px; font-size: 11px; color: #56625c; }
    .custom-colors label { display: flex; align-items: center; gap: 6px; }
    .custom-colors input[type="color"] { width: 24px; height: 20px; border: 1px solid #d7ded8; border-radius: 3px; padding: 0; cursor: pointer; }
    .setting { margin: 8px 0; }
    .setting span { display: flex; justify-content: space-between; color: #56625c; margin-bottom: 4px; }
    .setting b { color: #278477; font-weight: 500; }
    /* 步进器行：标签在左、加减控件在右，同一行对齐 */
    .setting.row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .setting.row > span { margin-bottom: 0; }
    .step-value-wrap { display: flex; align-items: center; gap: 3px; min-width: 46px; justify-content: center; }
    .step-value-input {
      width: 34px; text-align: center; font-variant-numeric: tabular-nums;
      color: #278477; font-weight: 500; font-size: 12px; font-family: inherit;
      border: 1px solid #d7ded8; border-radius: 4px; background: #fff; padding: 2px 0;
    }
    .step-value-input:focus { outline: none; border-color: #1f8b7d; }
    .step-suffix { font-size: 11px; color: #278477; font-weight: 500; }
    .bg-swatches { display: flex; flex-wrap: wrap; gap: 6px; }
    .bg-swatch {
      width: 22px; height: 22px; border-radius: 50%; cursor: pointer;
      border: 1px solid #d7ded8; padding: 0; transition: transform 0.15s, box-shadow 0.15s;
    }
    .bg-swatch:hover { transform: scale(1.1); }
    .bg-swatch.active { box-shadow: 0 0 0 2px #258578; border-color: #fff; }
    .stepper { display: flex; align-items: center; gap: 6px; }
    .stepper input[type="range"] { flex: 1; accent-color: #258578; }
    .stepper button {
      width: 20px; height: 20px; flex: none; border: 1px solid #d7ded8; border-radius: 4px;
      background: #fff; color: #59625e; cursor: pointer; font-size: 13px; line-height: 1;
      display: flex; align-items: center; justify-content: center; transition: background 0.15s;
    }
    .stepper button:hover:not(:disabled) { background: #eef1ed; }
    .stepper button:disabled { opacity: 0.4; cursor: default; }
    .font-options { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; margin-top: 6px; }
    .font-btn {
      padding: 6px; border: 1px solid #d7ded8; border-radius: 4px; background: #fff;
      color: #56625c; font-size: 11px; cursor: pointer; transition: all 0.15s;
    }
    .font-btn.active { background: #1f8b7d; color: #fff; border-color: #1f8b7d; }
    .font-btn:hover:not(.active) { background: #eef1ed; }
    .width-row { display: flex; align-items: center; gap: 5px; margin-top: 8px; color: #56625c; }
    .width-row span { margin-right: auto; }
    .width-row button {
      background: none; border: 0; border-radius: 3px; padding: 5px; font-size: 11px;
      color: #65716a; cursor: pointer; transition: background 0.15s, color 0.15s;
    }
    .width-row button.active { color: #187a6e; background: #deeee8; }
    .save-preset {
      width: 100%; height: 30px; border: 1px dashed #b9c7bf; border-radius: 4px;
      background: transparent; color: #5f7a6c; font-size: 11px; cursor: pointer; transition: background 0.15s, border-color 0.15s;
    }
    .save-preset:hover { background: #f4f8f5; border-color: #8fa89d; }
    .presets-section { margin: 14px 0 0; }
    .presets-header { font-size: 11px; font-weight: 600; color: #246d62; margin: 10px 0 6px; padding: 0 5px; }
    .presets-list { display: flex; flex-direction: column; gap: 4px; }
    .preset-item { display: flex; gap: 6px; align-items: center; }
    .preset-apply {
      flex: 1; padding: 6px; border: 1px solid #d7ded8; border-radius: 4px; background: #fff;
      color: #56625c; font-size: 11px; cursor: pointer; transition: all 0.15s; text-align: left;
    }
    .preset-apply:hover { background: #eef1ed; }
    .preset-delete {
      width: 24px; height: 24px; padding: 0; border: 1px solid #d7ded8; border-radius: 4px;
      background: #fff; color: #56625c; font-size: 14px; cursor: pointer; transition: all 0.15s;
    }
    .preset-delete:hover { background: #fff5f5; color: #b95042; }
    .dialog-overlay {
      position: fixed; inset: 0; z-index: 10; background: rgba(32, 44, 37, 0.32);
      display: flex; align-items: center; justify-content: center;
    }
    .dialog-card {
      width: 260px; padding: 16px; background: #fffdf9; border-radius: 8px;
      border: 1px solid #ccd4ce; box-shadow: 0 12px 32px rgba(37, 59, 51, 0.18);
    }
    .dialog-title { margin: 0 0 10px; font-size: 13px; font-weight: 700; color: #246d62; }
    .dialog-input {
      width: 100%; height: 28px; box-sizing: border-box; padding: 0 8px; font: inherit; font-size: 12px;
      border: 1px solid #d7ded8; border-radius: 4px; background: #fff; color: #33403a;
    }
    .dialog-input:focus { outline: none; border-color: #1f8b7d; }
    .dialog-error { margin: 6px 0 0; font-size: 10px; color: #b95042; }
    .dialog-actions { display: flex; gap: 8px; margin-top: 12px; }
    .dialog-btn {
      flex: 1; height: 28px; border-radius: 4px; font-size: 11px; cursor: pointer; transition: background 0.15s;
    }
    .dialog-btn-cancel { border: 1px solid #d7ded8; background: #fff; color: #56625c; }
    .dialog-btn-cancel:hover { background: #eef1ed; }
    .dialog-btn-confirm { border: 1px solid #1f8b7d; background: #1f8b7d; color: #fff; }
    .dialog-btn-confirm:hover { background: #197a6e; }
    .noise-row { display: flex; justify-content: space-between; align-items: center; min-height: 26px; color: #53615a; gap: 8px; }
    .noise-row > span { display: flex; align-items: baseline; gap: 5px; }
    .noise-risk-disclaimer { margin: 8px 0 0; font-size: 10px; color: #b08a63; line-height: 1.5; }
    .noise-reset-hint { margin: 8px 0 0; font-size: 10px; color: #718078; line-height: 1.5; }
    .noise-feedback { margin: 12px 0 0; font-size: 10px; color: #718078; }
    .ai-row { display: flex; justify-content: space-between; align-items: center; height: 26px; color: #53615a; }
    .ai-hint { margin: 4px 0 8px; font-size: 10px; color: #718078; line-height: 1.5; }
    .ai-progress { margin: 8px 0 0; height: 3px; border-radius: 999px; background: #e3ece7; overflow: hidden; }
    .ai-progress-bar { width: 40%; height: 100%; border-radius: 999px; background: #1f8b7d; animation: ins-reader-ai-progress 1.1s ease-in-out infinite; }
    @keyframes ins-reader-ai-progress {
      0% { transform: translateX(-100%); }
      100% { transform: translateX(250%); }
    }
    .ai-status { margin: 6px 0 0; font-size: 10px; color: #718078; min-height: 12px; }
    .ai-status.error { color: #b95042; }
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
    .restore {
      width: 100%; height: 30px; margin: 15px 0 0; display: flex; align-items: center; justify-content: center;
      color: #53615a; background: #fff; border: 1px solid #d7ded8; border-radius: 4px; cursor: pointer; font-size: 12px;
      transition: background 0.15s;
    }
    .restore:hover { background: #f6f8f5; }
    .simple-mode { display: flex; flex-direction: column; gap: 12px; }
    .simple-header { display: flex; align-items: center; gap: 8px; }
    .brand-icon {
      flex: none; width: 22px; height: 22px; border-radius: 6px; background: #1f8b7d;
      display: inline-flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
    }
    .brand-icon span { display: block; height: 2px; border-radius: 1px; background: #fff; }
    .brand-icon span:nth-child(1) { width: 12px; }
    .brand-icon span:nth-child(2) { width: 9px; }
    .brand-icon span:nth-child(3) { width: 12px; }
    .simple-title { flex: 1; font-size: 16px; font-weight: 700; color: #21463f; }
    .simple-presets { display: flex; flex-direction: column; gap: 6px; }
    .simple-presets-title { font-size: 11px; color: #8a948e; }
    .simple-preset-btn {
      padding: 8px; border: 1px solid #d7ded8; border-radius: 4px; background: #fff;
      color: #246d62; font-size: 11px; cursor: pointer; transition: all 0.15s;
    }
    .simple-preset-btn:hover { background: #eaf5f0; }
    .simple-divider { border: 0; border-top: 1px solid #e3e8e4; margin: 0; }
    .detail-link {
      align-self: flex-end; display: inline-flex; align-items: center; gap: 2px;
      border: 0; background: none; padding: 0; margin: 0;
      color: #1f8b7d; font-size: 12px; font-weight: 600; cursor: pointer; transition: color 0.15s;
    }
    .detail-link:hover { color: #166b60; }
    .detail-link .chevron { font-size: 13px; }
  `;

  window.INS_Reader.panelUI = {
    toggle: INS_toggle,
    render: INS_render,
    isOpen: INS_isOpen,
    updateNoiseCount: INS_updateNoiseCount,
  };
})();
