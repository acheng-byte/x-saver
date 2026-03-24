// ============================================================
// X Saver - Background Service Worker V1.0.0
// 职责：动态脚本注入、API代理（Notion/飞书）、文件下载管理
// ============================================================

'use strict';

// ============================================================
// 第一部分：飞书 API 域名映射
// ============================================================

const FEISHU_API_DOMAINS = {
  feishu: 'https://open.feishu.cn',
  lark: 'https://open.larksuite.com'
};

// 飞书 Token 缓存
let feishuTokenCache = { token: '', expireAt: 0 };

// Notion 搜索缓存（URL → 搜索结果，5 分钟 TTL）
const notionSearchCache = new Map();
const NOTION_CACHE_TTL = 5 * 60 * 1000;

// 定期清理过期的 Notion 搜索缓存
function cleanExpiredNotionCache() {
  const now = Date.now();
  for (const [key, val] of notionSearchCache) {
    if (now - val.timestamp > NOTION_CACHE_TTL) {
      notionSearchCache.delete(key);
    }
  }
}

// 网络错误分类（CORS/VPN/代理/DNS 等）
function classifyNetworkError(error) {
  const msg = (error.message || '').toLowerCase();
  if (error.name === 'AbortError' || msg.includes('timeout') || msg.includes('aborted')) {
    return 'error.network.timeout';
  }
  if (msg.includes('cors') || msg.includes('blocked by cors')) {
    return 'error.network.cors';
  }
  if (msg.includes('err_tunnel') || msg.includes('err_proxy') || msg.includes('proxy')) {
    return 'error.network.proxy';
  }
  if (msg.includes('err_name_not_resolved') || msg.includes('err_connection_refused') || msg.includes('dns')) {
    return 'error.network.dns';
  }
  if (msg.includes('failed to fetch') || msg.includes('networkerror') || msg.includes('net::err_')) {
    return 'error.network.connection';
  }
  return 'error.network.unknown';
}

// 生成友好错误消息（background 中无 i18n.js，使用硬编码映射）
const NETWORK_ERROR_MESSAGES = {
  'error.network.timeout': '请求超时（30秒），请检查网络连接或稍后重试 / Request timeout (30s)',
  'error.network.connection': '网络连接失败，请检查网络或 VPN/代理 / Network connection failed',
  'error.network.cors': '请求被浏览器安全策略阻止 / Request blocked by CORS policy',
  'error.network.proxy': '代理/VPN 连接异常，请检查代理设置 / Proxy/VPN connection error',
  'error.network.dns': '无法解析目标地址，请检查网络 / Cannot resolve target address',
  'error.network.unknown': '网络请求失败 / Network request failed'
};

function friendlyNetworkError(error) {
  const key = classifyNetworkError(error);
  return NETWORK_ERROR_MESSAGES[key] || error.message;
}

// API 请求重试工具（支持 429 指数退避 + 友好网络错误）
async function fetchWithRetry(url, options = {}, maxRetries = 2) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeout);

      // HTTP 429 限流：指数退避重试
      if (response.status === 429 && attempt < maxRetries) {
        const retryAfter = response.headers.get('Retry-After');
        const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : 1000 * Math.pow(2, attempt + 1);
        console.warn(`[X Saver] API 429 限流，${waitTime}ms 后重试 (${attempt + 1}/${maxRetries})`);
        await new Promise(r => setTimeout(r, waitTime));
        continue;
      }

      return response;
    } catch (err) {
      clearTimeout(timeout);
      lastError = err;
      if (err.name === 'AbortError') {
        throw new Error(friendlyNetworkError(err));
      }
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }
  throw new Error(friendlyNetworkError(lastError));
}

// ============================================================
// 第二部分：消息监听器（核心路由）
// ============================================================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!request || !request.action) {
    sendResponse({ success: false, error: '无效的请求格式' });
    return false;
  }
  const handler = messageHandlers[request.action];
  if (handler) {
    handler(request, sender)
      .then(sendResponse)
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // 异步响应
  }
  return false;
});

const messageHandlers = {
  injectContentScript: handleInjectContentScript,
  saveToNotion: handleSaveToNotion,
  saveToFeishu: handleSaveToFeishu,
  downloadFile: handleDownloadFile,
  downloadHtml: handleDownloadHtml,
  testNotionConnection: handleTestNotionConnection,
  testFeishuConnection: handleTestFeishuConnection,
  translateText: handleTranslateText,
  fetchVideoVariants: handleFetchVideoVariants
};

// ============================================================
// 第三部分：动态脚本注入
// ============================================================

async function handleInjectContentScript(request, sender) {
  const tabId = sender.tab?.id;
  if (!tabId) return { success: false, error: '无法获取标签ID' };

  try {
    // 注入依赖库和主脚本（i18n 必须在 content.js 之前加载）
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['lib/turndown.min.js']
    });

    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['lib/marked.min.js']
    });

    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['i18n.js']
    });

    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['content.js']
    });

    // 注入样式
    try {
      await chrome.scripting.insertCSS({
        target: { tabId: tabId },
        files: ['styles/content.css']
      });
    } catch (e) {
      // CSS 注入失败不影响功能
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ============================================================
// 第四部分：Notion API 代理
// ============================================================

const NOTION_API_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

// Notion 请求封装（含 HTTP 状态码分类错误提示）
async function notionFetch(endpoint, token, options = {}) {
  const url = `${NOTION_API_BASE}${endpoint}`;
  let response;
  try {
    response = await fetchWithRetry(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    }, 1);
  } catch (err) {
    // fetchWithRetry 已将网络错误转为友好消息
    throw err;
  }

  let data;
  try {
    data = await response.json();
  } catch (e) {
    throw new Error(`Notion API 响应格式错误 (${response.status})`);
  }

  if (!response.ok) {
    // HTTP 状态码分类
    if (response.status === 401) {
      throw new Error('Notion Token 无效或已过期，请在设置中更新 / Notion Token invalid or expired');
    }
    if (response.status === 403) {
      throw new Error('Notion 无权访问，请确认 Integration 已连接到 Database / Access denied');
    }
    if (response.status === 404) {
      throw new Error('Notion Database 不存在，请检查 Database ID / Database not found');
    }
    if (response.status === 429) {
      throw new Error('Notion API 请求过于频繁，请稍后重试 / Rate limited');
    }
    throw new Error(`Notion API 错误 (${response.status}): ${data.message || JSON.stringify(data)}`);
  }

  return data;
}

// 保存到 Notion
async function handleSaveToNotion(request) {
  const d = request.data;

  try {
    // 1. 搜索是否已存在（按 URL 去重）
    const existing = await searchNotionByUrl(d.databaseId, d.token, d.url, d.propMapping.url);

    // 2. 构建属性
    const properties = buildNotionProperties(d);

    // 3. 将 Markdown 转换为 Notion Blocks
    const blocks = convertMarkdownToNotionBlocks(d.content);

    if (existing) {
      // 更新现有页面
      // 先清空内容
      await clearNotionPageChildren(existing.id, d.token);
      // 追加新内容（分批，每批100个）
      await appendNotionBlocksBatched(existing.id, d.token, blocks);
      // 更新属性
      await notionFetch(`/pages/${existing.id}`, d.token, {
        method: 'PATCH',
        body: JSON.stringify({ properties })
      });

      return { success: true, action: 'updated', pageId: existing.id };
    } else {
      // 创建新页面
      const createData = {
        parent: { database_id: d.databaseId },
        properties: properties,
        children: blocks.slice(0, 100)
      };

      const page = await notionFetch('/pages', d.token, {
        method: 'POST',
        body: JSON.stringify(createData)
      });

      // 追加剩余 blocks
      if (blocks.length > 100) {
        await appendNotionBlocksBatched(page.id, d.token, blocks.slice(100));
      }

      return { success: true, action: 'created', pageId: page.id };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// 搜索 Notion 页面（按 URL 去重，带缓存）
async function searchNotionByUrl(databaseId, token, url, urlPropName) {
  // 清理过期缓存
  cleanExpiredNotionCache();

  // 检查缓存
  const cacheKey = `${databaseId}:${url}`;
  const cached = notionSearchCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < NOTION_CACHE_TTL) {
    return cached.result;
  }

  try {
    const data = await notionFetch(`/databases/${databaseId}/query`, token, {
      method: 'POST',
      body: JSON.stringify({
        filter: {
          property: urlPropName || '链接',
          url: { equals: url }
        },
        page_size: 1
      })
    });

    const result = data.results && data.results.length > 0 ? data.results[0] : null;

    // 写入缓存
    notionSearchCache.set(cacheKey, { result, timestamp: Date.now() });
    // 缓存清理（最多 200 条，超出时批量删除最旧的 50 条）
    if (notionSearchCache.size > 200) {
      const keysToDelete = Array.from(notionSearchCache.keys()).slice(0, 50);
      keysToDelete.forEach(key => notionSearchCache.delete(key));
    }

    return result;
  } catch (e) {
    console.error('[X Saver] Notion 搜索失败:', e.message);
    return null;
  }
}

// 构建 Notion 属性
function buildNotionProperties(d) {
  const pm = d.propMapping;
  const props = {};

  // 标题（Title 类型，必需）
  if (pm.title) {
    props[pm.title] = {
      title: [{ text: { content: d.title || '' } }]
    };
  }

  // URL 类型
  if (pm.url) {
    props[pm.url] = { url: d.url || '' };
  }

  // Rich Text 类型
  if (pm.author) {
    props[pm.author] = {
      rich_text: [{ text: { content: d.author || '' } }]
    };
  }

  // Multi Select 类型（标签）
  if (pm.tags && d.tags && d.tags.length > 0) {
    props[pm.tags] = {
      multi_select: d.tags.map(t => ({ name: t }))
    };
  }

  // Date 类型
  if (pm.savedDate) {
    props[pm.savedDate] = {
      date: { start: d.savedDate }
    };
  }

  // Number 类型
  if (pm.likes) {
    props[pm.likes] = { number: d.likes || 0 };
  }
  if (pm.retweets) {
    props[pm.retweets] = { number: d.retweets || 0 };
  }

  // Select 类型（推文类型）
  if (pm.type) {
    props[pm.type] = {
      select: { name: d.type || '推文' }
    };
  }

  return props;
}

// Markdown → Notion Blocks
function convertMarkdownToNotionBlocks(markdown) {
  if (!markdown) return [];

  const blocks = [];
  // 去除 frontmatter
  const cleanMd = markdown.replace(/^---\n[\s\S]*?\n---\n*/, '');
  const lines = cleanMd.split('\n');

  let i = 0;
  let inCodeBlock = false;
  let codeContent = '';
  let codeLanguage = '';

  while (i < lines.length) {
    const line = lines[i];

    // 代码块
    if (line.startsWith('```')) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeLanguage = line.slice(3).trim() || 'plain text';
        codeContent = '';
      } else {
        inCodeBlock = false;
        blocks.push({
          type: 'code',
          code: {
            rich_text: [{ type: 'text', text: { content: codeContent.trimEnd() } }],
            language: mapNotionLanguage(codeLanguage)
          }
        });
      }
      i++;
      continue;
    }

    if (inCodeBlock) {
      codeContent += line + '\n';
      i++;
      continue;
    }

    // 空行
    if (line.trim() === '') {
      i++;
      continue;
    }

    // 分割线
    if (/^---+$/.test(line.trim())) {
      blocks.push({ type: 'divider', divider: {} });
      i++;
      continue;
    }

    // 标题
    if (line.startsWith('# ')) {
      blocks.push({
        type: 'heading_1',
        heading_1: { rich_text: parseNotionRichText(line.slice(2)) }
      });
      i++;
      continue;
    }
    if (line.startsWith('## ')) {
      blocks.push({
        type: 'heading_2',
        heading_2: { rich_text: parseNotionRichText(line.slice(3)) }
      });
      i++;
      continue;
    }
    if (line.startsWith('### ')) {
      blocks.push({
        type: 'heading_3',
        heading_3: { rich_text: parseNotionRichText(line.slice(4)) }
      });
      i++;
      continue;
    }

    // 图片
    const imgMatch = line.match(/^!\[([^\]]*)\]\(([^)]+)\)/);
    if (imgMatch) {
      const imgUrl = imgMatch[2];
      // Base64 图片不能用于 Notion
      if (!imgUrl.startsWith('data:')) {
        blocks.push({
          type: 'image',
          image: { type: 'external', external: { url: imgUrl } }
        });
      }
      i++;
      continue;
    }

    // 视频链接
    if (line.match(/^\[.*\]\(https?:\/\/.*\.(mp4|m3u8|webm)/)) {
      const urlMatch = line.match(/\((https?:\/\/[^)]+)\)/);
      if (urlMatch) {
        blocks.push({
          type: 'video',
          video: { type: 'external', external: { url: urlMatch[1] } }
        });
      }
      i++;
      continue;
    }

    // 引用块
    if (line.startsWith('> ')) {
      let quoteText = line.slice(2);
      while (i + 1 < lines.length && lines[i + 1].startsWith('> ')) {
        i++;
        quoteText += '\n' + lines[i].slice(2);
      }
      blocks.push({
        type: 'quote',
        quote: { rich_text: parseNotionRichText(quoteText) }
      });
      i++;
      continue;
    }

    // 无序列表
    if (line.match(/^[-*+] /)) {
      blocks.push({
        type: 'bulleted_list_item',
        bulleted_list_item: { rich_text: parseNotionRichText(line.replace(/^[-*+] /, '')) }
      });
      i++;
      continue;
    }

    // 有序列表
    if (line.match(/^\d+\. /)) {
      blocks.push({
        type: 'numbered_list_item',
        numbered_list_item: { rich_text: parseNotionRichText(line.replace(/^\d+\. /, '')) }
      });
      i++;
      continue;
    }

    // 表格（简单处理，限制最大 200 行防止无限循环）
    if (line.includes('|') && line.trim().startsWith('|')) {
      const tableRows = [];
      let maxRows = 200;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim().startsWith('|') && maxRows-- > 0) {
        const row = lines[i].trim();
        // 跳过分隔行
        if (!/^[|\-:\s]+$/.test(row)) {
          const cells = row.split('|').filter(c => c.trim() !== '');
          tableRows.push(cells.map(c => c.trim()));
        }
        i++;
      }

      if (tableRows.length > 0) {
        const tableWidth = Math.max(...tableRows.map(r => r.length));
        blocks.push({
          type: 'table',
          table: {
            table_width: tableWidth,
            has_column_header: true,
            has_row_header: false,
            children: tableRows.map(row => ({
              type: 'table_row',
              table_row: {
                cells: Array.from({ length: tableWidth }, (_, idx) => {
                  const cellText = row[idx] || '';
                  return [{ type: 'text', text: { content: cellText } }];
                })
              }
            }))
          }
        });
      }
      continue;
    }

    // <details> 折叠块 → toggle
    if (line.startsWith('<details>')) {
      let summaryText = '';
      let toggleContent = '';
      i++;
      while (i < lines.length && !lines[i].startsWith('</details>')) {
        if (lines[i].startsWith('<summary>')) {
          summaryText = lines[i].replace(/<\/?summary>/g, '').replace(/<\/?b>/g, '').trim();
        } else {
          toggleContent += lines[i] + '\n';
        }
        i++;
      }
      blocks.push({
        type: 'toggle',
        toggle: {
          rich_text: parseNotionRichText(summaryText || '详情'),
          children: [{
            type: 'paragraph',
            paragraph: { rich_text: parseNotionRichText(toggleContent.trim()) }
          }]
        }
      });
      i++;
      continue;
    }

    // HTML <iframe> 标签 → bookmark/embed
    const iframeMatch = line.match(/<iframe[^>]+src="([^"]+)"/);
    if (iframeMatch) {
      blocks.push({
        type: 'bookmark',
        bookmark: { url: iframeMatch[1] }
      });
      i++;
      continue;
    }

    // HTML <video> 标签 → video block
    const videoHtmlMatch = line.match(/<video[^>]+src="([^"]+)"/);
    if (videoHtmlMatch) {
      blocks.push({
        type: 'video',
        video: { type: 'external', external: { url: videoHtmlMatch[1] } }
      });
      i++;
      continue;
    }

    // HTML <img> 标签 → image block
    const imgHtmlMatch = line.match(/<img[^>]+src="([^"]+)"/);
    if (imgHtmlMatch && !imgHtmlMatch[1].startsWith('data:')) {
      blocks.push({
        type: 'image',
        image: { type: 'external', external: { url: imgHtmlMatch[1] } }
      });
      i++;
      continue;
    }

    // 裸 URL（非 Markdown 链接格式）
    if (/^https?:\/\/\S+$/.test(line.trim())) {
      blocks.push({
        type: 'bookmark',
        bookmark: { url: line.trim() }
      });
      i++;
      continue;
    }

    // 普通段落
    blocks.push({
      type: 'paragraph',
      paragraph: { rich_text: parseNotionRichText(line) }
    });
    i++;
  }

  return blocks;
}

// 解析 Markdown 行内格式为 Notion Rich Text
function parseNotionRichText(text) {
  if (!text) return [{ type: 'text', text: { content: '' } }];

  // 防止超长文本 ReDoS：超过 2000 字符直接作为纯文本返回
  if (text.length > 2000) {
    // 分段处理
    const chunks = [];
    for (let i = 0; i < text.length; i += 2000) {
      chunks.push({ type: 'text', text: { content: text.substring(i, i + 2000) } });
    }
    return chunks;
  }

  const richText = [];
  // 简单解析：粗体、斜体、代码、链接、删除线
  const regex = /(\*\*(.{1,500}?)\*\*|\*(.{1,500}?)\*|`(.{1,500}?)`|~~(.{1,500}?)~~|\[([^\]]{1,300})\]\(([^)]{1,500})\)|([^*`~\[]+))/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match[2]) {
      // **粗体**
      richText.push({
        type: 'text',
        text: { content: match[2] },
        annotations: { bold: true }
      });
    } else if (match[3]) {
      // *斜体*
      richText.push({
        type: 'text',
        text: { content: match[3] },
        annotations: { italic: true }
      });
    } else if (match[4]) {
      // `代码`
      richText.push({
        type: 'text',
        text: { content: match[4] },
        annotations: { code: true }
      });
    } else if (match[5]) {
      // ~~删除线~~
      richText.push({
        type: 'text',
        text: { content: match[5] },
        annotations: { strikethrough: true }
      });
    } else if (match[6] && match[7]) {
      // [链接](url)
      richText.push({
        type: 'text',
        text: { content: match[6], link: { url: match[7] } }
      });
    } else if (match[8]) {
      // 普通文本
      richText.push({
        type: 'text',
        text: { content: match[8] }
      });
    }
  }

  // 如果正则没有匹配到任何内容，返回原始文本
  if (richText.length === 0) {
    return [{ type: 'text', text: { content: text } }];
  }

  // Notion 限制每个 rich_text 数组最多 2000 字符
  return richText.filter(rt => rt.text.content.length > 0);
}

// 编程语言映射（Notion 支持的语言名称）
function mapNotionLanguage(lang) {
  const map = {
    js: 'javascript', ts: 'typescript', py: 'python', rb: 'ruby',
    sh: 'bash', yml: 'yaml', md: 'markdown', 'c++': 'c++',
    'c#': 'c#', objc: 'objective-c', kt: 'kotlin', rs: 'rust',
    jsx: 'javascript', tsx: 'typescript', scss: 'scss', less: 'less'
  };
  const lower = (lang || '').toLowerCase();
  return map[lower] || lower || 'plain text';
}

// 清空 Notion 页面子 blocks
async function clearNotionPageChildren(pageId, token) {
  try {
    // 获取所有子 block
    let hasMore = true;
    let startCursor = undefined;

    while (hasMore) {
      const params = startCursor ? `?start_cursor=${startCursor}` : '';
      const data = await notionFetch(`/blocks/${pageId}/children${params}`, token, {
        method: 'GET'
      });

      // 逐个删除
      for (const block of (data.results || [])) {
        try {
          await notionFetch(`/blocks/${block.id}`, token, { method: 'DELETE' });
        } catch (e) {
          // 忽略单个删除失败
        }
      }

      hasMore = data.has_more;
      startCursor = data.next_cursor;
    }
  } catch (e) {
    // 清空失败不阻塞流程
  }
}

// 分批追加 Notion Blocks
async function appendNotionBlocksBatched(pageId, token, blocks) {
  const BATCH_SIZE = 100;
  for (let i = 0; i < blocks.length; i += BATCH_SIZE) {
    const batch = blocks.slice(i, i + BATCH_SIZE);
    await notionFetch(`/blocks/${pageId}/children`, token, {
      method: 'PATCH',
      body: JSON.stringify({ children: batch })
    });
  }
}

// 测试 Notion 连接
async function handleTestNotionConnection(request) {
  const { token, databaseId, propMapping } = request.data;

  try {
    // 验证 Token
    const database = await notionFetch(`/databases/${databaseId}`, token, {
      method: 'GET'
    });

    // 验证属性
    const props = database.properties || {};
    const missing = [];

    // 标题属性（Title 类型，必需）
    if (propMapping.title && (!props[propMapping.title] || props[propMapping.title].type !== 'title')) {
      missing.push(`"${propMapping.title}" (需要 Title 类型)`);
    }

    // URL 属性（必需）
    if (propMapping.url && (!props[propMapping.url] || props[propMapping.url].type !== 'url')) {
      missing.push(`"${propMapping.url}" (需要 URL 类型)`);
    }

    return {
      success: true,
      databaseTitle: database.title?.[0]?.plain_text || '未命名',
      propertyCount: Object.keys(props).length,
      missingProperties: missing
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ============================================================
// 第五部分：飞书 API 代理
// ============================================================

// 获取飞书 Access Token（含友好网络错误提示）
async function getFeishuAccessToken(appId, appSecret, apiDomain) {
  const now = Date.now();

  // 检查缓存
  if (feishuTokenCache.token && feishuTokenCache.expireAt > now) {
    return feishuTokenCache.token;
  }

  const baseUrl = FEISHU_API_DOMAINS[apiDomain] || FEISHU_API_DOMAINS.feishu;
  const url = `${baseUrl}/open-apis/auth/v3/tenant_access_token/internal`;

  const response = await fetchWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret })
  }, 1);

  const data = await response.json();

  if (data.code !== 0 || !data.tenant_access_token) {
    // 飞书错误码分类
    if (data.code === 10003 || data.code === 10014) {
      throw new Error('飞书 App ID 或 App Secret 无效，请检查设置 / Invalid App ID or Secret');
    }
    if (data.code === 10012) {
      throw new Error('飞书应用未启用，请在飞书开放平台启用 / App not enabled');
    }
    throw new Error(`飞书认证失败: ${data.msg || '未知错误'} (code: ${data.code})`);
  }

  // 缓存 Token（提前 5 分钟过期）
  feishuTokenCache = {
    token: data.tenant_access_token,
    expireAt: now + (data.expire - 300) * 1000
  };

  return data.tenant_access_token;
}

// 保存到飞书（含 Token 过期自动刷新重试）
async function handleSaveToFeishu(request, _retried) {
  const d = request.data;
  const baseUrl = FEISHU_API_DOMAINS[d.apiDomain] || FEISHU_API_DOMAINS.feishu;

  try {
    // 1. 获取 Token
    const token = await getFeishuAccessToken(d.appId, d.appSecret, d.apiDomain);

    // 2. 搜索现有记录（按标题去重）
    const existingRecord = await searchFeishuRecord(baseUrl, d.appToken, d.tableId, token, d.title);

    // 3. 上传附件（如果开启）
    let mdAttachmentToken = null;
    let htmlAttachmentToken = null;

    if (d.uploadAttachment && d.markdown) {
      const blob = new Blob([d.markdown], { type: 'text/markdown; charset=utf-8' });
      mdAttachmentToken = await uploadFeishuFile(baseUrl, token, blob, `${sanitizeFeishuFilename(d.title)}.md`);
    }

    if (d.uploadHtml && d.htmlContent) {
      const blob = new Blob([d.htmlContent], { type: 'text/html; charset=utf-8' });
      htmlAttachmentToken = await uploadFeishuFile(baseUrl, token, blob, `${sanitizeFeishuFilename(d.title)}.html`);
    }

    // 4. 构建字段
    const fields = {
      '标题': d.title,
      '链接': { link: d.url, text: d.url },
      '作者': d.author,
      '保存时间': d.savedTime,
      '点赞数': d.likes || 0,
      '转发数': d.retweets || 0,
      '类型': d.type === 'thread' ? 'Thread' : d.type === 'article' ? '长文章' : '推文'
    };

    // 正文（如果不上传附件，用摘要文本）
    if (!d.uploadAttachment) {
      fields['正文'] = d.content;
    }

    // 附件
    if (mdAttachmentToken) {
      fields['附件'] = [{ file_token: mdAttachmentToken }];
    }
    if (htmlAttachmentToken) {
      fields['HTML附件'] = [{ file_token: htmlAttachmentToken }];
    }

    // 5. 创建或更新
    if (existingRecord) {
      await updateFeishuRecord(baseUrl, d.appToken, d.tableId, token, existingRecord.record_id, fields);
      return { success: true, action: 'updated' };
    } else {
      await createFeishuRecord(baseUrl, d.appToken, d.tableId, token, fields);
      return { success: true, action: 'created' };
    }
  } catch (error) {
    // 飞书 Token 过期自动刷新重试（仅重试一次）
    if (!_retried && error.message && (error.message.includes('1254001') || error.message.includes('token expired'))) {
      console.warn('[X Saver] 飞书 Token 过期，清除缓存后重试...');
      feishuTokenCache = { token: '', expireAt: 0 };
      return handleSaveToFeishu(request, true);
    }
    return { success: false, error: error.message };
  }
}

// 搜索飞书记录（含网络错误友好提示）
async function searchFeishuRecord(baseUrl, appToken, tableId, token, title) {
  try {
    const url = `${baseUrl}/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/search`;
    const response = await fetchWithRetry(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        field_names: ['标题'],
        filter: {
          conjunction: 'and',
          conditions: [{
            field_name: '标题',
            operator: 'is',
            value: [title]
          }]
        },
        page_size: 1
      })
    }, 1);

    const data = await response.json();
    if (data.code === 0 && data.data?.items?.length > 0) {
      return data.data.items[0];
    }
    return null;
  } catch (e) {
    console.warn('[X Saver] 飞书搜索失败（不阻断保存）:', e.message);
    return null;
  }
}

// 飞书 API 错误码分类
function classifyFeishuError(code, msg) {
  if (code === 1254043 || code === 1254044) {
    return '飞书多维表格不存在或无权限，请检查 App Token 和 Table ID / Bitable not found or no access';
  }
  if (code === 1254001) {
    return '飞书 Token 已过期，正在刷新... / Token expired, refreshing...';
  }
  if (code === 99991668 || code === 99991672) {
    return '飞书 API 请求过于频繁，请稍后重试 / Rate limited';
  }
  if (code === 1254045) {
    return '飞书字段类型不匹配，请检查字段配置 / Field type mismatch';
  }
  return `飞书操作失败 (${code}): ${msg}`;
}

// 创建飞书记录（含错误分类）
async function createFeishuRecord(baseUrl, appToken, tableId, token, fields) {
  const url = `${baseUrl}/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records`;
  const response = await fetchWithRetry(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ fields })
  }, 1);

  const data = await response.json();
  if (data.code !== 0) {
    throw new Error(classifyFeishuError(data.code, data.msg));
  }
  return data;
}

// 更新飞书记录（含错误分类）
async function updateFeishuRecord(baseUrl, appToken, tableId, token, recordId, fields) {
  const url = `${baseUrl}/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordId}`;
  const response = await fetchWithRetry(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ fields })
  }, 1);

  const data = await response.json();
  if (data.code !== 0) {
    throw new Error(classifyFeishuError(data.code, data.msg));
  }
  return data;
}

// 上传飞书文件（含错误分类）
async function uploadFeishuFile(baseUrl, token, blob, filename) {
  const formData = new FormData();
  formData.append('file_type', 'stream');
  formData.append('file_name', filename);
  formData.append('file', blob, filename);

  const url = `${baseUrl}/open-apis/drive/v1/medias/upload_all`;
  const response = await fetchWithRetry(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: formData
  }, 1);

  const data = await response.json();
  if (data.code !== 0 || !data.data?.file_token) {
    throw new Error(classifyFeishuError(data.code || -1, data.msg || '文件上传失败'));
  }

  return data.data.file_token;
}

// 清理飞书文件名
function sanitizeFeishuFilename(name) {
  return (name || 'untitled')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .substring(0, 80);
}

// 测试飞书连接
async function handleTestFeishuConnection(request) {
  const d = request.data;
  const baseUrl = FEISHU_API_DOMAINS[d.apiDomain] || FEISHU_API_DOMAINS.feishu;

  try {
    // 1. 验证 Token
    const token = await getFeishuAccessToken(d.appId, d.appSecret, d.apiDomain);

    // 2. 验证表格
    const tableUrl = `${baseUrl}/open-apis/bitable/v1/apps/${d.appToken}/tables/${d.tableId}/fields`;
    const response = await fetchWithRetry(tableUrl, {
      headers: { 'Authorization': `Bearer ${token}` }
    }, 1);
    const data = await response.json();

    if (data.code !== 0) {
      throw new Error(`表格访问失败: ${data.msg}`);
    }

    // 3. 检查必需字段
    const fields = (data.data?.items || []).map(f => f.field_name);
    const required = ['标题', '链接', '作者', '保存时间'];
    const missing = required.filter(f => !fields.includes(f));

    return {
      success: true,
      fieldCount: fields.length,
      fields: fields,
      missingFields: missing
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ============================================================
// 第六部分A：视频URL兜底获取（通过主世界调用 X API）
// 当 detector.js 的拦截器未能缓存视频URL时（如首次直接打开推文页），
// 通过 chrome.scripting.executeScript(world:'MAIN') 在页面主世界中
// 调用 X 的 v1.1 API 获取视频变体列表。
// ============================================================

// 参考 x2md 项目：直接在 background service worker 中调用 X API
// 不使用 chrome.scripting.executeScript（避免主世界执行不稳定的问题）
// 通过 chrome.cookies.get 获取 CSRF token，通过 credentials:'include' 携带认证
async function handleFetchVideoVariants(request, sender) {
  const tweetId = request.tweetId;
  console.log('[X Saver Video] 收到视频获取请求, tweetId:', tweetId);

  if (!tweetId) {
    console.error('[X Saver Video] 缺少推文ID');
    return { success: false, error: '缺少推文ID' };
  }

  // 过滤掉非法 tweetId（fallback ID 如 tw_xxx 或 tweet）
  if (!/^\d+$/.test(tweetId)) {
    console.error('[X Saver Video] 推文ID无效:', tweetId);
    return { success: false, error: '推文ID无效: ' + tweetId };
  }

  try {
    // 从浏览器 cookie 获取 CSRF token（需要 cookies 权限）
    console.log('[X Saver Video] 正在获取 CSRF token...');
    const cookie = await chrome.cookies.get({ url: 'https://x.com', name: 'ct0' });
    const csrfToken = cookie?.value;
    if (!csrfToken) {
      console.error('[X Saver Video] CSRF token 获取失败, cookie:', cookie);
      return { success: false, error: '未登录X或CSRF Token获取失败，请确保已登录 x.com' };
    }
    console.log('[X Saver Video] CSRF token 获取成功, 长度:', csrfToken.length);

    // X 的公开 Bearer Token（所有登录用户共用，非机密，与 x2md 相同）
    const BEARER = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

    // 方式1：v1.1 REST API（更简单直接）
    console.log('[X Saver Video] 尝试 v1.1 REST API...');
    const resp = await fetchWithRetry(
      'https://x.com/i/api/1.1/statuses/show.json?id=' + tweetId + '&include_entities=true&tweet_mode=extended',
      {
        credentials: 'include',
        headers: {
          'Authorization': 'Bearer ' + BEARER,
          'x-csrf-token': csrfToken,
          'x-twitter-active-user': 'yes',
          'x-twitter-auth-type': 'OAuth2Session'
        }
      }
    );

    if (!resp.ok) {
      // v1.1 API 失败，尝试方式2：GraphQL TweetResultByRestId
      console.warn('[X Saver Video] v1.1 API 返回 ' + resp.status + '，尝试 GraphQL 兜底');
      return await fetchVideoVariantsGraphQL(tweetId, csrfToken, BEARER, request.discoveredOperationIds);
    }

    const data = await resp.json();
    console.log('[X Saver Video] v1.1 API 返回成功, 数据 keys:', Object.keys(data).join(','));
    const variants = extractVideoVariantsFromTweet(data);
    console.log('[X Saver Video] 提取到', variants.length, '个视频变体');

    if (variants.length > 0) {
      console.log('[X Saver Video] 最高清晰度:', variants[0].bitrate, 'url:', variants[0].url?.substring(0, 80));
      return { success: true, variants };
    }

    // v1.1 没有返回视频数据，尝试 GraphQL
    console.log('[X Saver Video] v1.1 无视频数据，尝试 GraphQL...');
    return await fetchVideoVariantsGraphQL(tweetId, csrfToken, BEARER, request.discoveredOperationIds);
  } catch (error) {
    console.error('[X Saver Video] 视频获取异常:', error);
    return { success: false, error: '视频获取失败: ' + error.message };
  }
}

// 从推文数据中提取视频 variants（v1.1 REST API 响应格式）
function extractVideoVariantsFromTweet(data) {
  const variants = [];
  const entities = data.extended_entities || data.entities;
  if (entities && entities.media) {
    for (const m of entities.media) {
      if (m.video_info && m.video_info.variants) {
        const mp4 = m.video_info.variants
          .filter(v => v.content_type === 'video/mp4')
          .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
        if (mp4.length > 0) variants.push(...mp4);
      }
    }
  }
  return variants;
}

// ============================================================
// GraphQL 多计划兜底方案（参考 x2md 的动态 operationId 发现机制）
// 策略：
//   1. 优先使用 content.js 从页面请求中拦截到的动态 operationId
//   2. 然后通过扫描 X 的 JS 文件发现 operationId
//   3. 最后使用硬编码的 fallback ID
//   4. 同时尝试 TweetDetail 和 TweetResultByRestId 两种端点
// ============================================================

// 硬编码 fallback operationId（来自 x2md，定期更新）
const FALLBACK_OPERATION_IDS = {
  TweetDetail: ['xIYgDwjboktoFeXe_fgacw', 'nBS-WpgA6ZG0CyNHD517JQ'],
  TweetResultByRestId: ['zy39CwTyYhU-_0LP7dljjg', 'xOhkmRac04YFZmOzU9PJHg']
};

// TweetResultByRestId 的 features 参数（与 x2md 保持一致）
const GRAPHQL_FEATURES_TWEET_RESULT = {
  creator_subscriptions_tweet_preview_api_enabled: true,
  premium_content_api_read_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  responsive_web_grok_analyze_button_fetch_trends_enabled: false,
  responsive_web_grok_analyze_post_followups_enabled: true,
  responsive_web_jetfuel_frame: true,
  responsive_web_grok_share_attachment_enabled: true,
  responsive_web_grok_annotations_enabled: true,
  articles_preview_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  tweet_awards_web_tipping_enabled: false,
  content_disclosure_indicator_enabled: true,
  content_disclosure_ai_generated_indicator_enabled: true,
  responsive_web_grok_show_grok_translated_post: false,
  responsive_web_grok_analysis_button_from_backend: true,
  post_ctas_fetch_enabled: false,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: false,
  profile_label_improvements_pcf_label_in_post_enabled: true,
  responsive_web_profile_redirect_enabled: false,
  rweb_tipjar_consumption_enabled: false,
  verified_phone_label_enabled: false,
  responsive_web_grok_image_annotation_enabled: true,
  responsive_web_grok_imagine_annotation_enabled: true,
  responsive_web_grok_community_note_auto_translation_is_enabled: false,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_enhance_cards_enabled: false
};

// TweetDetail 的 features 参数
const GRAPHQL_FEATURES_TWEET_DETAIL = {
  rweb_tipjar_consumption_enabled: true,
  responsive_web_graphql_exclude_directive_enabled: true,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  articles_preview_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  tweet_awards_web_tipping_enabled: false,
  creator_subscriptions_quote_tweet_preview_enabled: false,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  rweb_video_timestamps_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  responsive_web_enhance_cards_enabled: false
};

// fieldToggles 参数
const GRAPHQL_FIELD_TOGGLES = {
  withArticleRichContentState: true,
  withArticlePlainText: false,
  withArticleSummaryText: true,
  withArticleVoiceOver: true
};

// 动态发现 operationId 的缓存（从 X 的 JS 文件中解析）
let discoveredOpsFromJsCache = null;
let discoveredOpsFromJsCacheTime = 0;
const DISCOVERED_OPS_CACHE_TTL = 30 * 60 * 1000; // 30 分钟

// 从 X 的 JS 文件中动态发现 GraphQL operationId（参考 x2md）
async function discoverGraphQLOperationIdsFromPage() {
  // 检查缓存
  if (discoveredOpsFromJsCache && (Date.now() - discoveredOpsFromJsCacheTime < DISCOVERED_OPS_CACHE_TTL)) {
    return discoveredOpsFromJsCache;
  }

  console.log('[X Saver Video] 开始从 X 页面 JS 文件中发现 operationId...');
  const discovered = { TweetDetail: [], TweetResultByRestId: [] };

  try {
    // 1. 获取 X 主页 HTML（10秒超时，不影响核心功能）
    const htmlController = new AbortController();
    const htmlTimeout = setTimeout(() => htmlController.abort(), 10000);
    const htmlResp = await fetch('https://x.com/home', {
      credentials: 'include',
      headers: { 'x-twitter-active-user': 'yes' },
      signal: htmlController.signal
    });
    clearTimeout(htmlTimeout);
    if (!htmlResp.ok) {
      console.warn('[X Saver Video] 获取 X 页面失败:', htmlResp.status);
      return discovered;
    }
    const html = await htmlResp.text();

    // 2. 提取 abs.twimg.com 上的 JS 文件 URL
    const scriptUrls = [];
    const scriptMatches = html.matchAll(/<script[^>]+src="([^"]+)"[^>]*><\/script>/g);
    for (const match of scriptMatches) {
      try {
        const url = new URL(match[1], 'https://x.com/').href;
        // 只关注 abs.twimg.com 的 JS 文件，优先含 /main. 的
        if (url.includes('abs.twimg.com') && url.endsWith('.js')) {
          scriptUrls.push(url);
        }
      } catch (e) {}
    }

    console.log('[X Saver Video] 找到', scriptUrls.length, '个 JS 文件');

    // 优先处理含 /main. 的文件（通常包含 GraphQL 定义）
    scriptUrls.sort((a, b) => {
      const aMain = a.includes('/main.') ? 0 : 1;
      const bMain = b.includes('/main.') ? 0 : 1;
      return aMain - bMain;
    });

    // 3. 逐个下载 JS 文件并解析 operationId（最多检查 5 个文件）
    const maxFiles = Math.min(scriptUrls.length, 5);
    for (let i = 0; i < maxFiles; i++) {
      try {
        const jsController = new AbortController();
        const jsTimeout = setTimeout(() => jsController.abort(), 8000);
        const jsResp = await fetch(scriptUrls[i], { signal: jsController.signal });
        clearTimeout(jsTimeout);
        if (!jsResp.ok) continue;
        const jsText = await jsResp.text();

        // 正则提取 queryId（与 x2md 相同的模式）
        const opMatches = jsText.matchAll(/queryId:"([A-Za-z0-9_-]+)",operationName:"(TweetDetail|TweetResultByRestId)"/g);
        for (const opMatch of opMatches) {
          const [, operationId, operationName] = opMatch;
          if (discovered[operationName] && !discovered[operationName].includes(operationId)) {
            discovered[operationName].push(operationId);
          }
        }

        // 如果两种都找到了，提前退出
        if (discovered.TweetDetail.length > 0 && discovered.TweetResultByRestId.length > 0) {
          break;
        }
      } catch (e) {
        console.warn('[X Saver Video] 解析 JS 文件失败:', scriptUrls[i], e.message);
      }
    }

    console.log('[X Saver Video] JS 文件发现结果:', JSON.stringify(discovered));

    // 缓存结果
    if (discovered.TweetDetail.length > 0 || discovered.TweetResultByRestId.length > 0) {
      discoveredOpsFromJsCache = discovered;
      discoveredOpsFromJsCacheTime = Date.now();
    }

    return discovered;
  } catch (error) {
    console.warn('[X Saver Video] operationId 发现过程异常:', error.message);
    return discovered;
  }
}

// 构建 GraphQL 请求计划列表（参考 x2md 的 buildGraphQLRequestPlans）
function buildGraphQLRequestPlans(tweetId, discoveredOperationIds) {
  const plans = [];

  // 合并 operationId 来源：content.js 拦截 > JS 文件发现 > 硬编码 fallback
  function mergeIds(opName) {
    const ids = [];
    // 1. content.js 通过 detector.js 拦截到的（最新、最可靠）
    if (discoveredOperationIds && discoveredOperationIds[opName]) {
      for (const id of discoveredOperationIds[opName]) {
        if (!ids.includes(id)) ids.push(id);
      }
    }
    // 2. 硬编码 fallback
    for (const id of FALLBACK_OPERATION_IDS[opName]) {
      if (!ids.includes(id)) ids.push(id);
    }
    return ids;
  }

  // TweetDetail 端点（返回更完整的数据）
  const detailIds = mergeIds('TweetDetail');
  for (const opId of detailIds) {
    plans.push({
      name: 'TweetDetail/' + opId,
      url: 'https://x.com/i/api/graphql/' + opId + '/TweetDetail',
      variables: {
        focalTweetId: tweetId,
        referrer: 'home',
        count: 20,
        includePromotedContent: false,
        withCommunity: true,
        withQuickPromoteEligibilityTweetFields: false,
        withBirdwatchNotes: false,
        withVoice: false
      },
      features: GRAPHQL_FEATURES_TWEET_DETAIL,
      fieldToggles: { ...GRAPHQL_FIELD_TOGGLES, withGrokAnalyze: false, withDisallowedReplyControls: false }
    });
  }

  // TweetResultByRestId 端点（更直接）
  const resultIds = mergeIds('TweetResultByRestId');
  for (const opId of resultIds) {
    plans.push({
      name: 'TweetResultByRestId/' + opId,
      url: 'https://x.com/i/api/graphql/' + opId + '/TweetResultByRestId',
      variables: {
        tweetId: tweetId,
        includePromotedContent: true,
        withBirdwatchNotes: true,
        withVoice: true,
        withCommunity: true
      },
      features: GRAPHQL_FEATURES_TWEET_RESULT,
      fieldToggles: GRAPHQL_FIELD_TOGGLES
    });
  }

  return plans;
}

// 递归从 GraphQL 响应中提取视频 variants
function extractVideoVariantsFromGraphQL(json) {
  const variants = [];
  const MAX_DEPTH = 30; // 防止极深嵌套导致栈溢出
  function extractFromObj(obj, depth) {
    if (!obj || typeof obj !== 'object' || depth > MAX_DEPTH) return;
    if (obj.video_info && obj.video_info.variants) {
      const mp4 = obj.video_info.variants
        .filter(v => v.content_type === 'video/mp4')
        .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
      if (mp4.length > 0) variants.push(...mp4);
      return;
    }
    if (Array.isArray(obj)) {
      for (const item of obj) extractFromObj(item, depth + 1);
    } else {
      for (const key of Object.keys(obj)) {
        if (typeof obj[key] === 'object' && obj[key] !== null) {
          extractFromObj(obj[key], depth + 1);
        }
      }
    }
  }
  extractFromObj(json, 0);
  return variants;
}

// GraphQL 多计划兜底方案
async function fetchVideoVariantsGraphQL(tweetId, csrfToken, bearer, discoveredOperationIds) {
  console.log('[X Saver Video] GraphQL 多计划兜底开始, tweetId:', tweetId);

  // 如果没有从页面拦截到 operationId，尝试从 JS 文件发现
  let enrichedDiscoveredIds = discoveredOperationIds;
  if (!enrichedDiscoveredIds || (!enrichedDiscoveredIds.TweetDetail?.length && !enrichedDiscoveredIds.TweetResultByRestId?.length)) {
    console.log('[X Saver Video] 无拦截到的 operationId，尝试从 JS 文件发现...');
    const jsDiscovered = await discoverGraphQLOperationIdsFromPage();
    if (jsDiscovered.TweetDetail.length > 0 || jsDiscovered.TweetResultByRestId.length > 0) {
      enrichedDiscoveredIds = jsDiscovered;
      console.log('[X Saver Video] JS 文件发现成功:', JSON.stringify(jsDiscovered));
    }
  }

  // 构建所有请求计划
  const plans = buildGraphQLRequestPlans(tweetId, enrichedDiscoveredIds);
  console.log('[X Saver Video] 共', plans.length, '个 GraphQL 计划');

  const headers = {
    'Authorization': 'Bearer ' + bearer,
    'x-csrf-token': csrfToken,
    'x-twitter-active-user': 'yes',
    'x-twitter-auth-type': 'OAuth2Session'
  };

  // 逐个尝试每个计划
  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i];
    console.log('[X Saver Video] 尝试计划', (i + 1) + '/' + plans.length, ':', plan.name);

    try {
      let urlStr = plan.url
        + '?variables=' + encodeURIComponent(JSON.stringify(plan.variables))
        + '&features=' + encodeURIComponent(JSON.stringify(plan.features));
      if (plan.fieldToggles) {
        urlStr += '&fieldToggles=' + encodeURIComponent(JSON.stringify(plan.fieldToggles));
      }

      const resp = await fetchWithRetry(urlStr, { credentials: 'include', headers });

      if (!resp.ok) {
        console.warn('[X Saver Video] 计划', plan.name, '返回', resp.status);
        continue; // 尝试下一个计划
      }

      const json = await resp.json();
      const variants = extractVideoVariantsFromGraphQL(json);

      if (variants.length > 0) {
        console.log('[X Saver Video] 计划', plan.name, '成功！提取到', variants.length, '个视频变体');
        console.log('[X Saver Video] 最高清晰度:', variants[0].bitrate, 'url:', variants[0].url?.substring(0, 80));
        return { success: true, variants };
      }

      console.log('[X Saver Video] 计划', plan.name, '返回成功但无视频数据');
    } catch (error) {
      console.warn('[X Saver Video] 计划', plan.name, '异常:', error.message);
    }
  }

  console.error('[X Saver Video] 所有 GraphQL 计划均失败');
  return { success: false, error: '所有 GraphQL 查询计划均未返回视频数据' };
}

// ============================================================
// 第六部分B：文件下载管理
// ============================================================

// 下载文件
async function handleDownloadFile(request) {
  return new Promise((resolve) => {
    chrome.downloads.download({
      url: request.url,
      filename: request.filename,
      saveAs: false,
      conflictAction: 'overwrite'
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        resolve({ success: false, error: chrome.runtime.lastError.message });
      } else {
        resolve({ success: true, downloadId: downloadId });

        // 下载完成或失败后清理监听器
        chrome.downloads.onChanged.addListener(function listener(delta) {
          if (delta.id === downloadId && (delta.state?.current === 'complete' || delta.state?.current === 'interrupted')) {
            chrome.downloads.onChanged.removeListener(listener);
          }
        });
      }
    });
  });
}

// 下载 HTML 文件
async function handleDownloadHtml(request) {
  return new Promise((resolve) => {
    const blob = new Blob([request.content], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    chrome.downloads.download({
      url: url,
      filename: request.filename,
      saveAs: false,
      conflictAction: 'overwrite'
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        URL.revokeObjectURL(url);
        resolve({ success: false, error: chrome.runtime.lastError.message });
      } else {
        resolve({ success: true, downloadId: downloadId });

        chrome.downloads.onChanged.addListener(function listener(delta) {
          if (delta.id === downloadId && (delta.state?.current === 'complete' || delta.state?.current === 'interrupted')) {
            URL.revokeObjectURL(url);
            chrome.downloads.onChanged.removeListener(listener);
          }
        });
      }
    });
  });
}

// ============================================================
// 第七部分：翻译 API 代理
// ============================================================

async function handleTranslateText(request, _depth) {
  const depth = _depth || 0;
  const { text, targetLang = 'zh-CN', sourceLang = 'auto' } = request;
  if (!text || text.trim().length === 0) {
    return { success: true, translatedText: text };
  }

  // 文本长度限制（Google Translate 免费 API 约 5000 字符限制）
  const MAX_TEXT_LENGTH = 4500;
  if (text.length > MAX_TEXT_LENGTH) {
    // 防止无限递归（最多 3 层）
    if (depth >= 3) {
      console.warn('[X Saver] 翻译递归深度超限，返回原文');
      return { success: true, translatedText: text };
    }
    // 超长文本分片翻译
    const chunks = [];
    for (let i = 0; i < text.length; i += MAX_TEXT_LENGTH) {
      chunks.push(text.substring(i, i + MAX_TEXT_LENGTH));
    }

    let fullTranslation = '';
    for (const chunk of chunks) {
      const result = await handleTranslateText(
        { text: chunk, targetLang, sourceLang }, depth + 1
      );
      fullTranslation += result.translatedText;
    }
    return { success: true, translatedText: fullTranslation };
  }

  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceLang}&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;

  try {
    const response = await fetchWithRetry(url, {}, 1); // 1 次重试
    if (!response.ok) {
      if (response.status === 429) {
        // 被限流：等 2 秒重试一次
        await new Promise(r => setTimeout(r, 2000));
        const retryResp = await fetch(url);
        if (!retryResp.ok) throw new Error(`翻译被限流: ${retryResp.status}`);
        const retryData = await retryResp.json();
        let retryText = '';
        if (retryData?.[0]) retryData[0].forEach(s => { if (s[0]) retryText += s[0]; });
        return { success: true, translatedText: retryText || text };
      }
      throw new Error(`翻译请求失败: ${response.status}`);
    }
    const data = await response.json();

    let translatedText = '';
    if (data && data[0]) {
      data[0].forEach(segment => {
        if (segment[0]) translatedText += segment[0];
      });
    }

    if (!translatedText) {
      console.warn('[X Saver] 翻译返回空结果，使用原文');
      return { success: true, translatedText: text };
    }

    return { success: true, translatedText };
  } catch (error) {
    console.error('[X Saver] 翻译失败:', error.message);
    return { success: true, translatedText: text };
  }
}

// ============================================================
// 第八部分：快捷键命令监听
// ============================================================

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'save-tweet') {
    try {
      // 获取当前活动标签页
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) return;

      // 检查是否在 X/Twitter 页面
      const url = tab.url || '';
      if (!url.includes('x.com') && !url.includes('twitter.com')) return;

      // 向 content script 发送保存命令
      chrome.tabs.sendMessage(tab.id, { action: 'triggerSave' }).catch(() => {
        // content script 可能未加载，忽略错误
      });
    } catch (e) {
      console.warn('[X Saver] 快捷键命令处理失败:', e.message);
    }
  }
});

// ============================================================
// 第九部分：安装事件
// ============================================================

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    // 首次安装，打开设置页面
    chrome.runtime.openOptionsPage();
  }
});
