// ============================================================
// X Saver - Options Page Logic V1.0.0
// ============================================================

'use strict';

// 默认配置（与 content.js 保持一致）
const DEFAULT_CONFIG = {
  pluginEnabled: true,
  saveToObsidian: true,
  saveToNotion: true,
  saveToFeishu: false,
  exportHtml: false,
  vaultName: '',
  folderPath: 'X收集箱',
  useAdvancedUri: true,
  addMetadata: true,
  includeImages: true,
  embedImages: false,
  imageMaxWidth: 1920,
  imageQuality: 0.9,
  autoDownloadImages: true,
  autoDownloadVideos: true,
  mediaDownloadFolder: 'X下载附件',
  videoQuality: 'highest',
  saveReplies: false,
  replyCount: 200,
  saveAllReplies: false,
  foldReplies: false,
  feishuApiDomain: 'feishu',
  feishuAppId: '',
  feishuAppSecret: '',
  feishuAppToken: '',
  feishuTableId: '',
  feishuUploadAttachment: false,
  feishuUploadHtml: false,
  notionToken: '',
  notionDatabaseId: '',
  notionPropTitle: '标题',
  notionPropUrl: '链接',
  notionPropAuthor: '作者',
  notionPropTags: '标签',
  notionPropSavedDate: '保存日期',
  notionPropLikes: '点赞数',
  notionPropRetweets: '转发数',
  notionPropType: '类型',
  htmlExportFolder: 'X导出',
  theme: 'system',  // 'light' | 'dark' | 'system'
  enableTranslation: false,
  translationTargetLang: 'zh-CN',
  translationMode: 'append',  // 'append' | 'replace'
  enableLinkPreview: true
};

// 所有表单字段 ID 列表
const FIELD_IDS = Object.keys(DEFAULT_CONFIG);

// ============================================================
// 初始化
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  // 初始化 i18n（优先，确保语言切换在配置加载前完成）
  if (typeof initI18n === 'function') {
    initI18n(() => {
      loadConfig();
    });
  } else {
    loadConfig();
  }
  setupEventListeners();
  setupCollapsibleSections();
  setupConditionalFields();
  setupLanguageSwitch();
});

// ============================================================
// 加载配置
// ============================================================

function loadConfig() {
  chrome.storage.sync.get(DEFAULT_CONFIG, (config) => {
    if (chrome.runtime.lastError) {
      console.error('[X Saver] 加载配置失败:', chrome.runtime.lastError.message);
      showStatus('saveStatus', (typeof t === 'function' ? t('options.status.loadFailed', { error: chrome.runtime.lastError.message }) : '加载配置失败: ' + chrome.runtime.lastError.message), 'error');
      config = { ...DEFAULT_CONFIG };
    }
    FIELD_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;

      if (el.type === 'checkbox') {
        el.checked = config[id];
      } else {
        el.value = config[id];
      }
    });

    // 更新条件字段的显隐
    updateConditionalFields();

    // 应用主题
    applyTheme(config.theme || 'system');
  });
}

// ============================================================
// 保存配置
// ============================================================

function saveConfig() {
  const config = {};

  FIELD_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;

    if (el.type === 'checkbox') {
      config[id] = el.checked;
    } else if (el.type === 'number') {
      config[id] = parseFloat(el.value) || 0;
    } else {
      config[id] = el.value.trim();
    }
  });

  chrome.storage.sync.set(config, () => {
    if (chrome.runtime.lastError) {
      showStatus('saveStatus', (typeof t === 'function' ? t('options.status.saveFailed', { error: chrome.runtime.lastError.message }) : '保存失败: ' + chrome.runtime.lastError.message), 'error');
      return;
    }
    showStatus('saveStatus', (typeof t === 'function' ? t('options.status.saved') : '设置已保存'), 'success');
  });
}

// ============================================================
// 事件监听
// ============================================================

function setupEventListeners() {
  // 保存按钮
  document.getElementById('saveBtn').addEventListener('click', saveConfig);

  // 恢复默认
  document.getElementById('resetBtn').addEventListener('click', () => {
    if (confirm(typeof t === 'function' ? t('options.confirm.reset') : '确定要恢复默认设置吗？所有配置将被重置。')) {
      chrome.storage.sync.set(DEFAULT_CONFIG, () => {
        loadConfig();
        showStatus('saveStatus', (typeof t === 'function' ? t('options.status.resetDone') : '已恢复默认设置'), 'success');
      });
    }
  });

  // 测试 Notion 连接
  document.getElementById('testNotion').addEventListener('click', testNotionConnection);

  // 测试飞书连接
  document.getElementById('testFeishu').addEventListener('click', testFeishuConnection);
}

// ============================================================
// 可折叠面板
// ============================================================

function setupCollapsibleSections() {
  document.querySelectorAll('.section-header[data-toggle]').forEach(header => {
    header.addEventListener('click', () => {
      const targetId = header.getAttribute('data-toggle');
      const body = document.getElementById(targetId);
      const arrow = header.querySelector('.arrow');

      if (body.classList.contains('hidden')) {
        body.classList.remove('hidden');
        header.classList.remove('collapsed');
      } else {
        body.classList.add('hidden');
        header.classList.add('collapsed');
      }
    });
  });
}

// ============================================================
// 条件字段显隐
// ============================================================

function setupConditionalFields() {
  // 图片嵌入 → 显示图片选项
  document.getElementById('embedImages').addEventListener('change', updateConditionalFields);

  // 保存回复 → 显示回复选项
  document.getElementById('saveReplies').addEventListener('change', updateConditionalFields);

  // 自动下载视频 → 显示视频选项
  document.getElementById('autoDownloadVideos').addEventListener('change', updateConditionalFields);

  // 翻译开关 → 显示翻译选项
  const translationEl = document.getElementById('enableTranslation');
  if (translationEl) {
    translationEl.addEventListener('change', updateConditionalFields);
  }

  // 主题切换 → 立即应用
  const themeEl = document.getElementById('theme');
  if (themeEl) {
    themeEl.addEventListener('change', () => {
      applyTheme(themeEl.value);
    });
  }
}

function updateConditionalFields() {
  // 图片嵌入选项
  const imageOptions = document.getElementById('imageOptions');
  if (imageOptions) {
    imageOptions.style.display = document.getElementById('embedImages').checked ? 'block' : 'none';
  }

  // 回复选项
  const replyOptions = document.getElementById('replyOptions');
  if (replyOptions) {
    replyOptions.style.display = document.getElementById('saveReplies').checked ? 'block' : 'none';
  }

  // 视频清晰度选项
  const videoOptions = document.getElementById('videoOptions');
  if (videoOptions) {
    videoOptions.style.display = document.getElementById('autoDownloadVideos').checked ? 'block' : 'none';
  }

  // 翻译选项
  const translationOptions = document.getElementById('translationOptions');
  if (translationOptions) {
    const enableEl = document.getElementById('enableTranslation');
    translationOptions.style.display = enableEl && enableEl.checked ? 'block' : 'none';
  }
}

// ============================================================
// 测试连接
// ============================================================

async function testNotionConnection() {
  const statusEl = document.getElementById('notionStatus');
  const token = document.getElementById('notionToken').value.trim();
  const databaseId = document.getElementById('notionDatabaseId').value.trim();

  if (!token || !databaseId) {
    showStatusEl(statusEl, _t('options.status.notionNeedFields'), 'error');
    return;
  }

  showStatusEl(statusEl, _t('options.status.testingConnection'), 'warning');

  try {
    const response = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(_t('options.status.connectionTimeout'))), 15000);
      chrome.runtime.sendMessage({
        action: 'testNotionConnection',
        data: {
          token: token,
          databaseId: databaseId,
          propMapping: {
            title: document.getElementById('notionPropTitle').value.trim(),
            url: document.getElementById('notionPropUrl').value.trim()
          }
        }
      }, (resp) => {
        clearTimeout(timeout);
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(resp);
        }
      });
    });

    if (response.success) {
      let msg = _t('options.status.notionSuccess', { title: response.databaseTitle, count: response.propertyCount });
      if (response.missingProperties && response.missingProperties.length > 0) {
        msg += '\n\n' + _t('options.status.notionMissing', { props: response.missingProperties.join(', ') });
        showStatusEl(statusEl, msg, 'warning');
      } else {
        showStatusEl(statusEl, msg, 'success');
      }
    } else {
      showStatusEl(statusEl, _t('options.status.notionFailed', { error: response.error }), 'error');
    }
  } catch (error) {
    showStatusEl(statusEl, _t('options.status.notionTestError', { error: error.message }), 'error');
  }
}

async function testFeishuConnection() {
  const statusEl = document.getElementById('feishuStatus');
  const appId = document.getElementById('feishuAppId').value.trim();
  const appSecret = document.getElementById('feishuAppSecret').value.trim();
  const appToken = document.getElementById('feishuAppToken').value.trim();
  const tableId = document.getElementById('feishuTableId').value.trim();
  const apiDomain = document.getElementById('feishuApiDomain').value;

  if (!appId || !appSecret || !appToken || !tableId) {
    showStatusEl(statusEl, _t('options.status.feishuNeedFields'), 'error');
    return;
  }

  showStatusEl(statusEl, _t('options.status.testingConnection'), 'warning');

  try {
    const response = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(_t('options.status.connectionTimeout'))), 15000);
      chrome.runtime.sendMessage({
        action: 'testFeishuConnection',
        data: { appId, appSecret, appToken, tableId, apiDomain }
      }, (resp) => {
        clearTimeout(timeout);
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(resp);
        }
      });
    });

    if (response.success) {
      let msg = _t('options.status.feishuSuccess', { count: response.fieldCount });
      if (response.missingFields && response.missingFields.length > 0) {
        msg += '\n' + _t('options.status.feishuMissing', { fields: response.missingFields.join(', ') });
        showStatusEl(statusEl, msg, 'warning');
      } else {
        msg += '\n' + _t('options.status.feishuFieldList', { fields: response.fields.join(', ') });
        showStatusEl(statusEl, msg, 'success');
      }
    } else {
      showStatusEl(statusEl, _t('options.status.feishuFailed', { error: response.error }), 'error');
    }
  } catch (error) {
    showStatusEl(statusEl, _t('options.status.feishuTestError', { error: error.message }), 'error');
  }
}

// ============================================================
// 状态显示
// ============================================================

function showStatus(containerId, message, type) {
  // 在保存按钮附近显示临时状态
  const btn = document.getElementById('saveBtn');
  const existing = document.querySelector('.save-status-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'save-status-toast';
  const colors = { success: 'var(--success)', error: 'var(--error)', warning: 'var(--warning)' };
  toast.style.cssText = `
    color: ${colors[type] || colors.success}; font-size: 13px; text-align: center;
    padding: 6px; animation: fadeIn 0.3s;
  `;
  toast.textContent = message;
  btn.parentNode.insertBefore(toast, btn.nextSibling);

  setTimeout(() => toast.remove(), 3000);
}

function showStatusEl(el, message, type) {
  el.className = `status-msg ${type}`;
  el.textContent = message;
  el.style.display = 'block';

  if (type !== 'warning' || !message.includes('正在')) {
    setTimeout(() => {
      el.style.display = 'none';
    }, 8000);
  }
}

// ============================================================
// 主题切换
// ============================================================

function applyTheme(theme) {
  const root = document.documentElement;

  // 移除之前的主题类
  root.classList.remove('theme-light', 'theme-dark');

  if (theme === 'system') {
    // 跟随系统
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.classList.add(prefersDark ? 'theme-dark' : 'theme-light');
  } else {
    root.classList.add(`theme-${theme}`);
  }
}

// 监听系统主题变化
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  const themeEl = document.getElementById('theme');
  if (themeEl && themeEl.value === 'system') {
    applyTheme('system');
  }
});

// ============================================================
// i18n 辅助函数
// ============================================================

// 安全翻译封装：i18n.js 未加载时返回 fallback
function _t(key, params) {
  if (typeof t === 'function') return t(key, params);
  return key;
}

// 语言切换
function setupLanguageSwitch() {
  const langSelect = document.getElementById('language');
  if (!langSelect) return;

  langSelect.addEventListener('change', () => {
    if (typeof setLanguage === 'function') {
      setLanguage(langSelect.value);
    }
  });
}
