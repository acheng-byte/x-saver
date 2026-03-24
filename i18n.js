// ============================================================
// X Saver - i18n 国际化模块 V1.0.0
// 支持中文 (zh-CN) / 英文 (en) 双语切换
// ============================================================

'use strict';

const I18N_LANGUAGES = {

  // ========== 中文（简体）==========
  'zh-CN': {
    // --- options 页面 ---
    options: {
      header: {
        title: 'X Saver',
        subtitle: '保存推文、Thread、长文章到你的知识库'
      },
      sections: {
        pluginStatus: '插件状态',
        appearance: '外观',
        targets: '保存目标',
        obsidian: 'Obsidian 设置',
        notion: 'Notion Database 设置',
        feishu: '飞书多维表格设置',
        html: 'HTML 导出设置',
        content: '内容设置',
        reply: '回复设置',
        media: '媒体下载',
        translation: '翻译设置'
      },
      pluginStatus: {
        enable: '启用插件'
      },
      appearance: {
        theme: '主题',
        themeSystem: '跟随系统',
        themeLight: '浅色',
        themeDark: '深色',
        language: '语言 / Language'
      },
      targets: {
        desc: '选择保存推文的目标平台。可以同时保存到多个目标，保存时会并行处理。',
        obsidian: '保存到 Obsidian',
        notion: '保存到 Notion Database',
        feishu: '保存到飞书多维表格',
        html: '导出 HTML 文件'
      },
      obsidian: {
        desc: '通过 Obsidian URI 协议保存笔记。推荐安装 Advanced URI 插件以支持大文件。Vault 名称留空则自动使用当前打开的仓库。',
        vaultLabel: 'Vault 名称（留空自动使用当前仓库）',
        vaultPlaceholder: 'My Vault',
        folderLabel: '保存文件夹',
        advancedUri: '使用 Advanced URI 插件（推荐）',
        advancedUriHint: '无文件大小限制，需在 Obsidian 中安装 Advanced URI 插件'
      },
      notion: {
        desc: '将推文保存到 Notion Database。需要创建 Integration 并获取 Token，然后将 Integration 连接到目标 Database。属性映射必须与 Database 中的列名完全一致。属性类型要求：标题=Title, 链接=URL, 作者=Rich Text, 标签=Multi Select, 保存日期=Date, 类型=Select, 点赞数/转发数=Number。',
        tokenLabel: 'Integration Token',
        tokenPlaceholder: 'secret_xxx...',
        tokenHint: '在 Notion Integrations 创建',
        tokenHintLink: '前往创建',
        dbIdLabel: 'Database ID',
        dbIdPlaceholder: '32位 Database ID',
        dbIdHint: '从 Database 链接中复制 32 位 ID',
        propMapping: '属性映射（必须与 Database 中的列名完全一致）',
        propTitle: '标题 (Title)',
        propUrl: '链接 (URL)',
        propAuthor: '作者 (Text)',
        propTags: '标签 (Multi Select)',
        propSavedDate: '保存日期 (Date)',
        propType: '类型 (Select)',
        propLikes: '点赞数 (Number)',
        propRetweets: '转发数 (Number)',
        testConnection: '测试连接'
      },
      feishu: {
        desc: '将推文保存到飞书多维表格。需要在飞书开放平台创建应用并获取 App ID/Secret，然后将应用添加为多维表格的协作者。表格需包含：标题(文本)、链接(超链接)、作者(文本)、标签(文本)、保存日期(日期)、类型(单选)等字段。支持上传 Markdown 和 HTML 作为附件。',
        apiVersion: 'API 版本',
        feishuOption: '飞书（国内版）',
        larkOption: 'Lark（国际版）',
        appIdLabel: 'App ID',
        appIdPlaceholder: 'cli_xxx',
        appSecretLabel: 'App Secret',
        appSecretPlaceholder: 'xxx',
        appTokenLabel: '多维表格 app_token',
        appTokenPlaceholder: 'bascnxxx',
        tableIdLabel: '数据表 table_id',
        tableIdPlaceholder: 'tblxxx',
        uploadMd: '上传 Markdown 附件',
        uploadHtml: '上传 HTML 附件',
        testConnection: '测试连接'
      },
      html: {
        desc: '将推文导出为离线 HTML 文件，包含完整样式和交互功能。支持 5 种主题切换、代码高亮、图片灯箱、一键复制代码块和表格。',
        folderLabel: '导出文件夹（相对于浏览器下载目录）'
      },
      content: {
        desc: '控制保存内容的格式和丰富程度。Frontmatter 元数据用于 Obsidian 的属性视图。图片嵌入(Base64)会增加文件大小但可离线查看。链接预览增强会自动为 YouTube/B站/GitHub 等链接生成富媒体嵌入卡片。',
        addMetadata: '添加元数据（Frontmatter）',
        includeImages: '保留图片链接',
        embedImages: '将图片嵌入笔记（Base64）',
        enableLinkPreview: '链接预览增强（YouTube/B站/GitHub等自动嵌入）',
        imageMaxWidth: '图片最大宽度 (px，0=原始尺寸)',
        imageQuality: '图片质量 (0.1-1.0)'
      },
      reply: {
        desc: '配置是否保存推文下的回复/评论。可限制保存数量或保存全部。折叠模式使用 HTML details 标签，在 Obsidian 中可折叠展开。',
        saveReplies: '保存回复',
        replyCount: '回复数量',
        saveAll: '保存全部',
        foldReplies: '折叠回复（HTML details 标签）'
      },
      media: {
        desc: '保存推文时自动下载图片和视频到本地。图片默认下载原图(最高清晰度)。视频支持选择清晰度，"每次询问"模式会弹窗让你选择。文件保存到浏览器下载目录的指定子文件夹中。',
        hint: '勾选后，保存推文时自动下载媒体到本地',
        autoImages: '自动下载图片（原图）',
        autoVideos: '自动下载视频',
        videoQuality: '视频清晰度',
        videoHighest: '最高清晰度',
        videoLowest: '最低清晰度（省流量）',
        videoAsk: '每次询问',
        folderLabel: '下载文件夹（相对于浏览器下载目录）'
      },
      translation: {
        desc: '自动检测非目标语言的推文并翻译。使用 Google 翻译 API（免费）。追加模式保留原文并在下方添加译文，替换模式直接用译文替换原文。',
        enable: '开启自动翻译（非中文内容翻译为中文）',
        targetLang: '目标语言',
        langZhCN: '简体中文',
        langZhTW: '繁体中文',
        langEn: '英文',
        langJa: '日文',
        langKo: '韩文',
        mode: '翻译模式',
        modeAppend: '追加译文（保留原文）',
        modeReplace: '替换原文',
        hint: '使用 Google 翻译，保存时自动检测非目标语言并翻译'
      },
      buttons: {
        save: '保存设置',
        reset: '恢复默认',
        testConnection: '测试连接'
      },
      version: 'X Saver V1.0.0 | 单击书签按钮保存 | 双击触发原生书签 | 快捷键 Ctrl+Shift+S',
      confirm: {
        reset: '确定要恢复默认设置吗？所有配置将被重置。'
      },
      status: {
        loadFailed: '加载配置失败: {{error}}',
        saveFailed: '保存失败: {{error}}',
        saved: '设置已保存',
        resetDone: '已恢复默认设置',
        testingConnection: '正在测试连接...',
        connectionTimeout: '连接超时（15秒），请检查网络',
        notionNeedFields: '请填写 Token 和 Database ID',
        notionSuccess: '连接成功！数据库: "{{title}}"，共 {{count}} 个属性',
        notionMissing: '缺少属性: {{props}}',
        notionFailed: '连接失败: {{error}}',
        notionTestError: '测试出错: {{error}}',
        feishuNeedFields: '请填写所有飞书配置项',
        feishuSuccess: '连接成功！共 {{count}} 个字段',
        feishuMissing: '缺少必需字段: {{fields}}',
        feishuFieldList: '字段列表: {{fields}}',
        feishuFailed: '连接失败: {{error}}',
        feishuTestError: '测试出错: {{error}}'
      }
    },

    // --- content.js toast消息 ---
    content: {
      toast: {
        saving: '正在保存...',
        savingInProgress: '正在保存中，请稍候...',
        noTweet: '未找到推文内容',
        noTarget: '未配置任何保存目标，请在设置中开启',
        extractFailed: '提取推文失败: {{error}}',
        extractEmpty: '提取推文内容失败，页面可能尚未完全加载',
        mdFailed: 'Markdown 转换失败: {{error}}',
        embedImages: '正在嵌入 {{count}} 张图片...',
        translating: '正在翻译 {{count}} 段文本{{cached}}...',
        translatingCached: ' ({{count}}段已缓存)',
        downloadingMedia: '正在下载 {{count}} 个媒体文件...',
        mediaResult: '媒体下载：{{success}} 成功, {{failed}} 失败',
        mediaFailed: '媒体下载失败',
        mediaDownloadDone: '媒体下载完成（{{count}}个文件）',
        noMediaFound: '未检测到可下载的媒体',
        messageTimeout: '消息超时（{{timeout}}秒）',
        downloadFailed: '下载失败',
        downloadPartialFailed: '部分媒体下载失败',
        imageError: '图片 {{index}}: {{error}}',
        videoError: '视频 {{index}}: {{error}}',
        videoUrlMissing: '视频 {{index}}: 无法获取下载地址',
        saveSuccess: '保存成功！({{count}}个目标)',
        saveSuccessMedia: '保存成功！({{count}}个目标, {{media}}个媒体)',
        savePartial: '部分保存成功 ({{success}}/{{total}})，失败: {{failed}}',
        saveAllFailed: '全部保存失败: {{failed}}',
        saveFailed: '保存失败: {{error}}',
        noTweetOnPage: '当前页面没有推文'
      },
      quality: {
        title: '选择视频清晰度',
        cancel: '取消'
      }
    },

    // --- 网络/API错误 ---
    error: {
      network: {
        timeout: '请求超时（30秒），请检查网络连接或稍后重试',
        connection: '网络连接失败，请检查：1)网络是否正常 2)VPN/代理是否阻断了连接',
        cors: '请求被浏览器安全策略阻止，请确认插件权限设置正确',
        proxy: '代理/VPN 连接异常，请检查代理设置或尝试关闭 VPN 后重试',
        dns: '无法解析目标地址，请检查网络连接或 DNS 设置',
        unknown: '网络请求失败: {{error}}'
      },
      notion: {
        invalidToken: 'Notion Token 无效或已过期，请在设置中更新',
        forbidden: 'Notion 无权访问，请确认 Integration 已连接到 Database',
        notFound: 'Notion Database 不存在，请检查 Database ID',
        rateLimited: 'Notion API 请求过于频繁，正在自动重试...',
        invalidFormat: 'Notion API 响应格式错误 ({{status}})',
        apiError: 'Notion API 错误 ({{status}}): {{message}}',
        searchFailed: 'Notion 搜索失败: {{error}}'
      },
      feishu: {
        authFailed: '飞书认证失败: {{error}}',
        createFailed: '创建记录失败: {{error}}',
        updateFailed: '更新记录失败: {{error}}',
        uploadFailed: '文件上传失败: {{error}}',
        tableFailed: '表格访问失败: {{error}}'
      },
      general: {
        invalidRequest: '无效的请求格式',
        tabError: '无法获取标签ID',
        configFailed: '配置加载失败: {{error}}',
        translationFailed: '翻译请求失败: {{status}}',
        translationThrottled: '翻译被限流: {{status}}'
      }
    }
  },

  // ========== 英文 ==========
  'en': {
    options: {
      header: {
        title: 'X Saver',
        subtitle: 'Save tweets, threads & articles to your knowledge base'
      },
      sections: {
        pluginStatus: 'Plugin Status',
        appearance: 'Appearance',
        targets: 'Save Targets',
        obsidian: 'Obsidian Settings',
        notion: 'Notion Database Settings',
        feishu: 'Feishu Bitable Settings',
        html: 'HTML Export Settings',
        content: 'Content Settings',
        reply: 'Reply Settings',
        media: 'Media Download',
        translation: 'Translation Settings'
      },
      pluginStatus: {
        enable: 'Enable Plugin'
      },
      appearance: {
        theme: 'Theme',
        themeSystem: 'Follow System',
        themeLight: 'Light',
        themeDark: 'Dark',
        language: 'Language / 语言'
      },
      targets: {
        desc: 'Choose where to save tweets. Multiple targets can be enabled simultaneously and will be processed in parallel.',
        obsidian: 'Save to Obsidian',
        notion: 'Save to Notion Database',
        feishu: 'Save to Feishu Bitable',
        html: 'Export as HTML'
      },
      obsidian: {
        desc: 'Save notes via Obsidian URI protocol. Advanced URI plugin is recommended for large files. Leave Vault name empty to use the currently open vault.',
        vaultLabel: 'Vault Name (leave empty to use current vault)',
        vaultPlaceholder: 'My Vault',
        folderLabel: 'Save Folder',
        advancedUri: 'Use Advanced URI Plugin (Recommended)',
        advancedUriHint: 'No file size limit. Requires Advanced URI plugin installed in Obsidian.'
      },
      notion: {
        desc: 'Save tweets to a Notion Database. Create an Integration to get a Token, then connect it to your target Database. Property names must exactly match your Database column names. Required types: Title=Title, URL=URL, Author=Rich Text, Tags=Multi Select, Date=Date, Type=Select, Likes/Retweets=Number.',
        tokenLabel: 'Integration Token',
        tokenPlaceholder: 'secret_xxx...',
        tokenHint: 'Create at Notion Integrations',
        tokenHintLink: 'Create one',
        dbIdLabel: 'Database ID',
        dbIdPlaceholder: '32-character Database ID',
        dbIdHint: 'Copy the 32-character ID from your Database URL',
        propMapping: 'Property Mapping (must exactly match your Database column names)',
        propTitle: 'Title (Title)',
        propUrl: 'URL (URL)',
        propAuthor: 'Author (Text)',
        propTags: 'Tags (Multi Select)',
        propSavedDate: 'Saved Date (Date)',
        propType: 'Type (Select)',
        propLikes: 'Likes (Number)',
        propRetweets: 'Retweets (Number)',
        testConnection: 'Test Connection'
      },
      feishu: {
        desc: 'Save tweets to Feishu Bitable. Create an app on Feishu Open Platform to get App ID/Secret, then add the app as a collaborator to your Bitable. Required fields: Title(Text), URL(Link), Author(Text), Tags(Text), Date(Date), Type(Select). Supports uploading MD/HTML as attachments.',
        apiVersion: 'API Version',
        feishuOption: 'Feishu (China)',
        larkOption: 'Lark (International)',
        appIdLabel: 'App ID',
        appIdPlaceholder: 'cli_xxx',
        appSecretLabel: 'App Secret',
        appSecretPlaceholder: 'xxx',
        appTokenLabel: 'Bitable app_token',
        appTokenPlaceholder: 'bascnxxx',
        tableIdLabel: 'Table table_id',
        tableIdPlaceholder: 'tblxxx',
        uploadMd: 'Upload Markdown Attachment',
        uploadHtml: 'Upload HTML Attachment',
        testConnection: 'Test Connection'
      },
      html: {
        desc: 'Export tweets as offline HTML files with full styling and interactivity. Supports 5 themes, code highlighting, image lightbox, and one-click copy for code blocks and tables.',
        folderLabel: 'Export Folder (relative to browser download directory)'
      },
      content: {
        desc: 'Control the format and richness of saved content. Frontmatter metadata enables Obsidian property view. Image embedding (Base64) increases file size but allows offline viewing. Link preview enhancement auto-generates rich media embeds for YouTube/Bilibili/GitHub links.',
        addMetadata: 'Add Metadata (Frontmatter)',
        includeImages: 'Keep Image Links',
        embedImages: 'Embed Images in Note (Base64)',
        enableLinkPreview: 'Link Preview Enhancement (YouTube/Bilibili/GitHub auto-embed)',
        imageMaxWidth: 'Max Image Width (px, 0=original)',
        imageQuality: 'Image Quality (0.1-1.0)'
      },
      reply: {
        desc: 'Configure whether to save replies/comments under tweets. You can limit the count or save all. Fold mode uses HTML details tag, collapsible in Obsidian.',
        saveReplies: 'Save Replies',
        replyCount: 'Reply Count',
        saveAll: 'Save All',
        foldReplies: 'Fold Replies (HTML details tag)'
      },
      media: {
        desc: 'Auto-download images and videos when saving tweets. Images download at original quality (highest resolution). Videos support quality selection - "Ask each time" mode shows a picker dialog. Files are saved to a subfolder in your browser download directory.',
        hint: 'When enabled, media files are downloaded automatically when saving tweets',
        autoImages: 'Auto Download Images (Original)',
        autoVideos: 'Auto Download Videos',
        videoQuality: 'Video Quality',
        videoHighest: 'Highest Quality',
        videoLowest: 'Lowest Quality (Save Data)',
        videoAsk: 'Ask Each Time',
        folderLabel: 'Download Folder (relative to browser download directory)'
      },
      translation: {
        desc: 'Auto-detect and translate tweets not in the target language. Uses Google Translate API (free). Append mode keeps original text with translation below. Replace mode substitutes the original text.',
        enable: 'Enable Auto Translation (translate non-Chinese to Chinese)',
        targetLang: 'Target Language',
        langZhCN: 'Simplified Chinese',
        langZhTW: 'Traditional Chinese',
        langEn: 'English',
        langJa: 'Japanese',
        langKo: 'Korean',
        mode: 'Translation Mode',
        modeAppend: 'Append Translation (keep original)',
        modeReplace: 'Replace Original',
        hint: 'Uses Google Translate to auto-detect and translate non-target language content when saving'
      },
      buttons: {
        save: 'Save Settings',
        reset: 'Reset to Default',
        testConnection: 'Test Connection'
      },
      version: 'X Saver V1.0.0 | Click bookmark to save | Double-click for native bookmark | Shortcut Ctrl+Shift+S',
      confirm: {
        reset: 'Are you sure you want to reset all settings to default?'
      },
      status: {
        loadFailed: 'Failed to load config: {{error}}',
        saveFailed: 'Save failed: {{error}}',
        saved: 'Settings saved',
        resetDone: 'Settings reset to default',
        testingConnection: 'Testing connection...',
        connectionTimeout: 'Connection timeout (15s), please check your network',
        notionNeedFields: 'Please fill in Token and Database ID',
        notionSuccess: 'Connected! Database: "{{title}}", {{count}} properties',
        notionMissing: 'Missing properties: {{props}}',
        notionFailed: 'Connection failed: {{error}}',
        notionTestError: 'Test error: {{error}}',
        feishuNeedFields: 'Please fill in all Feishu settings',
        feishuSuccess: 'Connected! {{count}} fields found',
        feishuMissing: 'Missing required fields: {{fields}}',
        feishuFieldList: 'Fields: {{fields}}',
        feishuFailed: 'Connection failed: {{error}}',
        feishuTestError: 'Test error: {{error}}'
      }
    },

    content: {
      toast: {
        saving: 'Saving...',
        savingInProgress: 'Save in progress, please wait...',
        noTweet: 'Tweet not found',
        noTarget: 'No save target configured. Please enable one in Settings.',
        extractFailed: 'Failed to extract tweet: {{error}}',
        extractEmpty: 'Failed to extract tweet content. The page may not be fully loaded.',
        mdFailed: 'Markdown conversion failed: {{error}}',
        embedImages: 'Embedding {{count}} images...',
        translating: 'Translating {{count}} segments{{cached}}...',
        translatingCached: ' ({{count}} cached)',
        downloadingMedia: 'Downloading {{count}} media files...',
        mediaResult: 'Media download: {{success}} succeeded, {{failed}} failed',
        mediaFailed: 'Media download failed',
        mediaDownloadDone: 'Media download complete ({{count}} files)',
        noMediaFound: 'No downloadable media detected',
        messageTimeout: 'Message timeout ({{timeout}}s)',
        downloadFailed: 'Download failed',
        downloadPartialFailed: 'Some media downloads failed',
        imageError: 'Image {{index}}: {{error}}',
        videoError: 'Video {{index}}: {{error}}',
        videoUrlMissing: 'Video {{index}}: Cannot get download URL',
        saveSuccess: 'Saved! ({{count}} targets)',
        saveSuccessMedia: 'Saved! ({{count}} targets, {{media}} media)',
        savePartial: 'Partially saved ({{success}}/{{total}}), failed: {{failed}}',
        saveAllFailed: 'All saves failed: {{failed}}',
        saveFailed: 'Save failed: {{error}}',
        noTweetOnPage: 'No tweet found on this page'
      },
      quality: {
        title: 'Select Video Quality',
        cancel: 'Cancel'
      }
    },

    error: {
      network: {
        timeout: 'Request timeout (30s). Please check your network or try again later.',
        connection: 'Network connection failed. Please check: 1) Is your network working? 2) Is VPN/proxy blocking the connection?',
        cors: 'Request blocked by browser security policy. Please verify extension permissions.',
        proxy: 'Proxy/VPN connection error. Please check proxy settings or try disabling VPN.',
        dns: 'Cannot resolve target address. Please check your network or DNS settings.',
        unknown: 'Network request failed: {{error}}'
      },
      notion: {
        invalidToken: 'Notion Token is invalid or expired. Please update it in Settings.',
        forbidden: 'Notion access denied. Please confirm the Integration is connected to the Database.',
        notFound: 'Notion Database not found. Please check the Database ID.',
        rateLimited: 'Notion API rate limited. Auto-retrying...',
        invalidFormat: 'Notion API response format error ({{status}})',
        apiError: 'Notion API error ({{status}}): {{message}}',
        searchFailed: 'Notion search failed: {{error}}'
      },
      feishu: {
        authFailed: 'Feishu auth failed: {{error}}',
        createFailed: 'Failed to create record: {{error}}',
        updateFailed: 'Failed to update record: {{error}}',
        uploadFailed: 'File upload failed: {{error}}',
        tableFailed: 'Table access failed: {{error}}'
      },
      general: {
        invalidRequest: 'Invalid request format',
        tabError: 'Cannot get tab ID',
        configFailed: 'Config load failed: {{error}}',
        translationFailed: 'Translation request failed: {{status}}',
        translationThrottled: 'Translation throttled: {{status}}'
      }
    }
  }
};

// ============================================================
// i18n 核心函数
// ============================================================

let i18nCurrentLang = 'zh-CN';

/**
 * 翻译函数：根据点分隔键查找翻译文本，支持 {{var}} 模板插值
 * @param {string} key - 点分隔键，如 'content.toast.saving'
 * @param {Object} [params] - 插值参数，如 { count: 5 }
 * @returns {string} 翻译后的文本
 */
function t(key, params) {
  const lang = I18N_LANGUAGES[i18nCurrentLang] || I18N_LANGUAGES['zh-CN'];
  const keys = key.split('.');
  let value = lang;

  for (const k of keys) {
    if (value && typeof value === 'object' && k in value) {
      value = value[k];
    } else {
      // 回退到中文
      value = I18N_LANGUAGES['zh-CN'];
      for (const fk of keys) {
        if (value && typeof value === 'object' && fk in value) {
          value = value[fk];
        } else {
          return key; // 找不到翻译，返回原始 key
        }
      }
      break;
    }
  }

  if (typeof value !== 'string') return key;

  // 模板插值 {{var}}
  if (params) {
    return value.replace(/\{\{(\w+)\}\}/g, (_, name) => {
      return params[name] !== undefined ? String(params[name]) : `{{${name}}}`;
    });
  }

  return value;
}

/**
 * 设置当前语言并更新 DOM
 * @param {string} lang - 语言代码 'zh-CN' 或 'en'
 */
function setLanguage(lang) {
  if (!I18N_LANGUAGES[lang]) lang = 'zh-CN';
  i18nCurrentLang = lang;

  // 持久化到 chrome.storage
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
    chrome.storage.sync.set({ language: lang }, () => {
      if (chrome.runtime && chrome.runtime.lastError) {
        console.warn('[i18n] 语言偏好保存失败:', chrome.runtime.lastError.message);
      }
    });
  }

  // 更新 HTML lang 属性
  document.documentElement.lang = lang === 'zh-CN' ? 'zh-CN' : 'en';

  // 自动更新 DOM 中带 data-i18n 属性的元素
  applyI18n();
}

/**
 * 扫描 DOM 中所有 data-i18n 属性元素并更新文本
 */
function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const translated = t(key);
    if (translated === key) return; // 未找到翻译则跳过

    if (el.tagName === 'INPUT' && (el.type === 'text' || el.type === 'password' || el.type === 'number')) {
      el.placeholder = translated;
    } else if (el.tagName === 'OPTION') {
      el.textContent = translated;
    } else {
      el.textContent = translated;
    }
  });

  // 更新语言选择器的选中状态
  const langSelect = document.getElementById('language');
  if (langSelect) {
    langSelect.value = i18nCurrentLang;
  }
}

/**
 * 初始化 i18n：从存储读取语言偏好，应用翻译
 * @param {Function} [callback] - 初始化完成后回调
 */
function initI18n(callback) {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
    chrome.storage.sync.get({ language: 'zh-CN' }, (result) => {
      i18nCurrentLang = result.language || 'zh-CN';
      applyI18n();
      if (callback) callback(i18nCurrentLang);
    });
  } else {
    // 非 Chrome 扩展环境（如测试）
    applyI18n();
    if (callback) callback(i18nCurrentLang);
  }
}

/**
 * 获取当前语言
 * @returns {string}
 */
function getCurrentLang() {
  return i18nCurrentLang;
}

// CommonJS / 全局导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { I18N_LANGUAGES, t, setLanguage, applyI18n, initI18n, getCurrentLang };
}
