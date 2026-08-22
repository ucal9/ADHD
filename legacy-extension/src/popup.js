// Copyright (c) 2026 Insta360. All rights reserved.
// INS_Reader · 弹出页脚本
// 职责：打开弹出页时直接展示"一键降噪"开关（对应 prefs.enabled，阅读模式总开关，
// 控制该标签页全部功能开启/关闭）与"我的预设"列表，无需先点按钮进入。
// "详细配置"按钮仍复用旧的 INS_READER_TOGGLE_PANEL 消息打开网页内的完整设置面板
// （字号/行间距/降噪细分开关/AI/预设管理等）。
// 弹出页与 content script 运行在不同执行上下文，content.js 里的 prefsStore 是一份
// 内存缓存、不会随 chrome.storage.sync 的外部写入自动刷新，因此这里直接读写
// chrome.storage.sync（STORAGE_KEY 需与 prefs-store.js 保持一致），写入后再通过
// chrome.tabs.sendMessage 发 INS_READER_SYNC_PREFS 消息，通知 content.js 用
// prefsStore.load() 重新从 storage 拉取一次，再触发 applyAll()/panelUI.render()。
// 若当前页面未注入 content script（如 chrome:// 内置页面），sendMessage 会抛异常，
// 这里捕获后展示 #unsupported-hint 提示，而不是让弹出页崩溃或静默失败。

const STORAGE_KEY = 'ins_reader_prefs_v1';

const enabledSwitch = document.getElementById('enabled-switch');
const presetsSection = document.getElementById('presets-section');
const presetsList = document.getElementById('presets-list');
const expandBtn = document.getElementById('expand-btn');
const unsupportedHint = document.getElementById('unsupported-hint');

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function getPrefs() {
  return new Promise((resolve) => {
    chrome.storage.sync.get([STORAGE_KEY], (result) => resolve(result[STORAGE_KEY] || {}));
  });
}

function setPrefs(prefs) {
  return new Promise((resolve) => {
    chrome.storage.sync.set({ [STORAGE_KEY]: prefs }, resolve);
  });
}

async function notifyContentScript() {
  const tab = await getActiveTab();
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'INS_READER_SYNC_PREFS' });
  } catch (e) {
    unsupportedHint.style.display = 'block';
  }
}

function renderPresets(prefs) {
  const presets = prefs.presets || [];
  if (presets.length === 0) {
    presetsSection.style.display = 'none';
    return;
  }
  presetsSection.style.display = 'block';
  presetsList.innerHTML = presets
    .map((p, idx) => `<button class="preset-btn" data-preset-index="${idx}">${p.name}</button>`)
    .join('');
  presetsList.querySelectorAll('[data-preset-index]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const idx = Number(btn.getAttribute('data-preset-index'));
      const current = await getPrefs();
      const preset = (current.presets || [])[idx];
      if (!preset || !preset.prefs) return;
      const next = { ...current, ...JSON.parse(JSON.stringify(preset.prefs)), enabled: true };
      await setPrefs(next);
      enabledSwitch.classList.add('on');
      await notifyContentScript();
    });
  });
}

async function init() {
  const prefs = await getPrefs();
  enabledSwitch.classList.toggle('on', !!prefs.enabled);
  renderPresets(prefs);
}

enabledSwitch.addEventListener('click', async () => {
  const prefs = await getPrefs();
  prefs.enabled = !prefs.enabled;
  enabledSwitch.classList.toggle('on', prefs.enabled);
  await setPrefs(prefs);
  await notifyContentScript();
});

// 详细配置：打开网页内的设置面板（字号/行间距/降噪细分开关/AI/预设管理等），
// 复用已有的 INS_READER_TOGGLE_PANEL 消息，由 content.js 负责启用阅读模式并展开面板。
expandBtn.addEventListener('click', async () => {
  const tab = await getActiveTab();
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'INS_READER_TOGGLE_PANEL' });
    window.close();
  } catch (e) {
    unsupportedHint.style.display = 'block';
  }
});

init();
