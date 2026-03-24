// ============================================================
// X Saver - Content Script V1.0.0
// 劫持书签按钮，保存推文/Thread/长文章到 Obsidian/Notion/飞书
// 支持视频/图片下载、表情渲染、元数据保存
//
// 交互方式：
// - 单击书签按钮：保存推文到配置的目标
// - 双击书签按钮：触发原生书签功能
// ============================================================

(function () {
  'use strict';

  // 防止重复注入
  if (window.__xSaverContentLoaded) return;
  window.__xSaverContentLoaded = true;

  // ============================================================
  // 第一部分：默认配置
  // ============================================================

  const DEFAULT_CONFIG = {
    pluginEnabled: true,

    // 保存目标（默认开启 Obsidian + Notion）
    saveToObsidian: true,
    saveToNotion: true,
    saveToFeishu: false,
    exportHtml: false,

    // Obsidian 设置
    vaultName: '',
    folderPath: 'X收集箱',
    useAdvancedUri: true,
    addMetadata: true,

    // 图片设置
    includeImages: true,
    embedImages: false,
    imageMaxWidth: 1920,
    imageQuality: 0.9,

    // 媒体下载（勾选后自动下载）
    autoDownloadImages: true,
    autoDownloadVideos: true,
    mediaDownloadFolder: 'X下载附件',
    videoQuality: 'highest', // 'highest' | 'lowest' | 'ask'

    // 评论/回复设置
    saveReplies: false,
    replyCount: 200,
    saveAllReplies: false,
    foldReplies: false,

    // 飞书设置
    feishuApiDomain: 'feishu',
    feishuAppId: '',
    feishuAppSecret: '',
    feishuAppToken: '',
    feishuTableId: '',
    feishuUploadAttachment: false,
    feishuUploadHtml: false,

    // Notion 设置
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

    // HTML 导出
    htmlExportFolder: 'X导出',
    theme: 'system',

    // 翻译设置
    enableTranslation: false,
    translationTargetLang: 'zh-CN',  // 目标语言（简体中文）
    translationMode: 'append',       // 'append'（追加译文） | 'replace'（替换原文）

    // 链接预览
    enableLinkPreview: true          // 自动为YouTube/B站/GitHub等链接生成嵌入预览
  };

  // 当前配置缓存
  let currentConfig = { ...DEFAULT_CONFIG };

  // 保存锁：防止快速连续点击导致并发保存
  let isSaving = false;

  // 翻译缓存（LRU，最多 100 条）
  const translationCache = new Map();
  const TRANSLATION_CACHE_MAX = 100;

  // ============================================================
  // 第二部分：工具函数
  // ============================================================

  const DEBUG = false;
  function log(...args) {
    if (DEBUG) console.log('[X Saver]', ...args);
  }

  // i18n 降级封装：i18n.js 未加载时回退到键名
  function _t(key, params) {
    if (typeof t === 'function') return t(key, params);
    return key;
  }

  // Promise 包装 chrome.runtime.sendMessage
  function sendMessageAsync(message, timeoutMs = 30000) {
    return new Promise((resolve) => {
      let resolved = false;
      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve({ success: false, error: '消息超时（' + timeoutMs/1000 + '秒）' });
        }
      }, timeoutMs);
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (resolved) return;
          resolved = true;
          clearTimeout(timer);
          if (chrome.runtime.lastError) {
            resolve({ success: false, error: chrome.runtime.lastError.message });
          } else {
            resolve(response || { success: false, error: '未收到响应' });
          }
        });
      } catch (e) {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          resolve({ success: false, error: '发送消息失败: ' + e.message });
        }
      }
    });
  }

  // 获取北京时间格式字符串
  function getBeijingTime() {
    const now = new Date();
    const bjTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    return bjTime.toISOString().replace('T', ' ').replace(/\.\d{3}Z/, '') + ' (北京时间)';
  }

  // 获取 ISO 日期（Notion 用）
  function getISODate() {
    return new Date().toISOString().split('T')[0];
  }

  // 清理文件名（去除非法字符）
  function sanitizeFilename(name) {
    return name
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 100);
  }

  // 等待元素出现
  function waitForElement(selector, timeout = 5000) {
    return new Promise((resolve) => {
      const el = document.querySelector(selector);
      if (el) return resolve(el);

      const observer = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) {
          observer.disconnect();
          resolve(el);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, timeout);
    });
  }

  // 延迟
  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // 格式化数字（1000 → 1K, 1000000 → 1M）
  function formatNumber(num) {
    if (!num) return '0';
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return String(num);
  }

  // 解析 X 显示的数字（"1.2K" → 1200）
  function parseDisplayNumber(text) {
    if (!text) return 0;
    text = text.trim().replace(/,/g, '');
    if (text.endsWith('K') || text.endsWith('千')) {
      return Math.round(parseFloat(text) * 1000);
    }
    if (text.endsWith('M') || text.endsWith('万')) {
      return Math.round(parseFloat(text) * 1000000);
    }
    return parseInt(text) || 0;
  }

  // ============================================================
  // 第三部分：视频URL缓存
  // 视频 URL 由 detector.js 在页面主世界中拦截 fetch/XHR 捕获，
  // 通过 postMessage 存入 window.__xSaverVideoCache（内容脚本世界共享）。
  // 如果缓存未命中，content.js 会通过 background.js 调用 X API 兜底获取。
  // ============================================================

  // 获取 detector.js 建立的共享视频缓存
  function getVideoCache() {
    if (!window.__xSaverVideoCache) {
      window.__xSaverVideoCache = new Map();
    }
    return window.__xSaverVideoCache;
  }

  // 获取 detector.js 动态发现的 GraphQL operationId（参考 x2md）
  // 这些 ID 从页面实际的 GraphQL 请求中拦截得到，比硬编码 ID 更可靠
  function getDiscoveredOperationIds() {
    const cache = window.__xSaverGraphQLOpCache;
    if (cache && (cache.TweetDetail?.length > 0 || cache.TweetResultByRestId?.length > 0)) {
      return {
        TweetDetail: cache.TweetDetail || [],
        TweetResultByRestId: cache.TweetResultByRestId || []
      };
    }
    return null;
  }

  // ============================================================
  // 第四部分：X 内容提取引擎
  // ============================================================

  const XExtractor = {

    // 从 URL 提取推文 ID
    getTweetIdFromUrl(url) {
      url = url || window.location.href;
      const match = url.match(/\/status\/(\d+)/);
      return match ? match[1] : null;
    },

    // 查找推文所在的 article 元素
    findTweetArticle(tweetElement) {
      if (!tweetElement) {
        // 推文详情页：找到主推文（第一个 article）
        const articles = document.querySelectorAll('article[data-testid="tweet"]');
        return articles.length > 0 ? articles[0] : null;
      }
      // 从按钮向上查找最近的 article
      return tweetElement.closest('article[data-testid="tweet"]');
    },

    // 提取完整推文数据
    extractTweet(article) {
      if (!article) article = this.findTweetArticle();
      if (!article) return null;

      const data = {
        type: 'tweet',
        id: this.extractTweetId(article),
        url: this.extractTweetUrl(article),
        author: this.extractAuthor(article),
        content: this.extractContent(article),
        media: this.extractMedia(article),
        metadata: this.extractMetadata(article),
        quotedTweet: this.extractQuotedTweet(article),
        thread: null,  // 后续填充
        replies: []    // 后续填充
      };

      // 检测是否为 Thread
      if (this.isThread()) {
        data.type = 'thread';
        data.thread = this.extractThread(article);
      }

      return data;
    },

    // 提取推文 ID
    // 注意：优先从 article 内链接提取，而非 URL。
    // 原因：Thread 页面 URL 只包含主推文 ID，但每条推文有独立 ID。
    extractTweetId(article) {
      if (article) {
        // 方式1: 从 article 内的时间链接（优先，适用于 Thread 等场景）
        const timeLink = article.querySelector('a[href*="/status/"] time');
        if (timeLink) {
          const link = timeLink.closest('a');
          const match = link?.href?.match(/\/status\/(\d+)/);
          if (match) return match[1];
        }

        // 方式2: 从 article 内所有含 /status/ 的链接
        const statusLinks = article.querySelectorAll('a[href*="/status/"]');
        for (const link of statusLinks) {
          const match = link.href?.match(/\/status\/(\d+)/);
          if (match) return match[1];
        }

        // 方式3: 从 article 的 share 按钮或 analytics 链接
        const shareLink = article.querySelector('a[href*="/analytics"], a[role="link"][href*="/status/"]');
        if (shareLink) {
          const match = shareLink.href?.match(/\/status\/(\d+)/);
          if (match) return match[1];
        }
      }

      // 方式4: 从页面 URL（回退）
      const urlId = this.getTweetIdFromUrl();
      if (urlId) return urlId;

      // 方式5: 生成唯一 fallback ID（避免 null 导致文件名错误）
      return 'tw_' + Date.now();
    },

    // 提取推文 URL
    extractTweetUrl(article) {
      const tweetId = this.extractTweetId(article);
      const author = this.extractAuthor(article);
      if (tweetId && author.username) {
        return `https://x.com/${author.username}/status/${tweetId}`;
      }
      // 从时间链接获取
      const timeLink = article.querySelector('a[href*="/status/"]');
      if (timeLink) {
        const href = timeLink.href;
        if (href.includes('x.com') || href.includes('twitter.com')) return href;
        return 'https://x.com' + timeLink.getAttribute('href');
      }
      return window.location.href;
    },

    // 提取作者信息
    extractAuthor(article) {
      const result = {
        username: '',
        displayName: '',
        avatar: '',
        verified: false
      };

      // 用户名区域
      const userNameDiv = article.querySelector('[data-testid="User-Name"]');
      if (userNameDiv) {
        // 显示名（第一个 span 链接内的文本）
        const nameLinks = userNameDiv.querySelectorAll('a');
        if (nameLinks.length > 0) {
          // 第一个链接通常是显示名
          const nameSpans = nameLinks[0].querySelectorAll('span');
          const texts = [];
          nameSpans.forEach(s => {
            // 跳过验证标记
            if (!s.querySelector('svg') && s.textContent.trim()) {
              texts.push(s.textContent.trim());
            }
          });
          result.displayName = texts.join('') || nameLinks[0].textContent.trim();
        }

        // @username
        const usernameSpan = userNameDiv.querySelector('a[href^="/"] span');
        const allText = userNameDiv.textContent;
        const atMatch = allText.match(/@(\w+)/);
        if (atMatch) {
          result.username = atMatch[1];
        }

        // 验证标记
        result.verified = !!userNameDiv.querySelector('svg[data-testid="icon-verified"]') ||
          !!userNameDiv.querySelector('[aria-label*="Verified"]') ||
          !!userNameDiv.querySelector('[aria-label*="已验证"]');
      }

      // 头像
      const avatarImg = article.querySelector('[data-testid="Tweet-User-Avatar"] img, img[src*="profile_images"]');
      if (avatarImg) {
        result.avatar = avatarImg.src.replace('_normal', '_400x400').replace('_bigger', '_400x400');
      }

      return result;
    },

    // 提取推文文本内容
    extractContent(article) {
      const result = {
        text: '',
        html: '',
        entities: {
          hashtags: [],
          mentions: [],
          urls: [],
          emojis: []
        }
      };

      const tweetText = article.querySelector('[data-testid="tweetText"]');
      if (!tweetText) return result;

      // 原始 HTML（保留结构）
      result.html = tweetText.innerHTML;

      // 纯文本（处理表情和链接）
      result.text = this._processTextContent(tweetText);

      // 提取实体
      // Hashtags
      tweetText.querySelectorAll('a[href*="/hashtag/"]').forEach(a => {
        const tag = a.textContent.replace('#', '').trim();
        if (tag) result.entities.hashtags.push(tag);
      });

      // @Mentions
      tweetText.querySelectorAll('a[href^="/"]').forEach(a => {
        const href = a.getAttribute('href');
        if (href && /^\/\w+$/.test(href) && !href.includes('/hashtag/')) {
          result.entities.mentions.push(href.substring(1));
        }
      });

      // URLs
      tweetText.querySelectorAll('a[href*="t.co"], a[href^="http"]').forEach(a => {
        const displayUrl = a.textContent.trim();
        const actualUrl = a.getAttribute('href');
        if (actualUrl && !actualUrl.startsWith('/')) {
          result.entities.urls.push({
            display: displayUrl,
            expanded: a.title || actualUrl,
            shortened: actualUrl
          });
        }
      });

      // Emojis（X 使用 Twemoji 图片）
      tweetText.querySelectorAll('img[src*="emoji"], img[alt]').forEach(img => {
        const alt = img.alt;
        if (alt && alt.length <= 4) { // emoji 通常 1-2 个字符
          result.entities.emojis.push(alt);
        }
      });

      return result;
    },

    // 处理文本节点（将 Twemoji 图片转回 Unicode）
    _processTextContent(element) {
      let text = '';
      element.childNodes.forEach(node => {
        if (node.nodeType === Node.TEXT_NODE) {
          text += node.textContent;
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          if (node.tagName === 'IMG') {
            // Twemoji → Unicode emoji
            text += node.alt || '';
          } else if (node.tagName === 'BR') {
            text += '\n';
          } else if (node.tagName === 'A') {
            text += node.textContent;
          } else {
            text += this._processTextContent(node);
          }
        }
      });
      return text;
    },

    // 提取媒体（图片+视频+GIF）
    extractMedia(article) {
      const media = [];

      // --- 图片 ---
      // data-testid="tweetPhoto" 包含图片
      article.querySelectorAll('[data-testid="tweetPhoto"] img, img[src*="pbs.twimg.com/media"]').forEach(img => {
        const src = img.src || '';
        if (!src.includes('pbs.twimg.com/media')) return;
        // 排除头像和 emoji
        if (src.includes('profile_images') || src.includes('emoji')) return;

        // 获取原图 URL
        const origUrl = this._getOriginalImageUrl(src);
        media.push({
          type: 'photo',
          url: origUrl,
          thumbnailUrl: src,
          alt: img.alt || '图片'
        });
      });

      // --- 视频 ---
      // 策略1：通过 data-testid 查找视频播放器
      let videoPlayer = article.querySelector('[data-testid="videoPlayer"], [data-testid="previewInterstitial"]');

      // 策略2：直接查找 article 中的 video 元素（兜底）
      if (!videoPlayer) {
        const videoEl = article.querySelector('video');
        if (videoEl) {
          videoPlayer = videoEl.closest('[data-testid]') || videoEl.parentElement;
          console.info('[X Saver extractMedia] data-testid="videoPlayer" 未找到，但发现 video 元素，使用父容器');
        }
      }

      // 诊断日志
      const allVideos = article.querySelectorAll('video');
      const allTestIds = [...article.querySelectorAll('[data-testid]')].map(el => el.getAttribute('data-testid'));
      console.info('[X Saver extractMedia] 诊断: video元素数=' + allVideos.length +
        ', videoPlayer=' + !!videoPlayer +
        ', data-testid列表=' + JSON.stringify([...new Set(allTestIds)]));

      if (videoPlayer) {
        const videoEl = videoPlayer.querySelector('video') || article.querySelector('video');
        const posterUrl = videoEl?.poster || '';
        const tweetId = this.extractTweetId(article);

        // 尝试从共享缓存获取视频 URL（detector.js 主世界拦截器写入）
        const cache = getVideoCache();
        let variants = cache.get(tweetId) || [];

        // 备用1：如果 tweetId 未命中，尝试从页面 URL 中的 ID 查找
        if (variants.length === 0) {
          const urlId = this.getTweetIdFromUrl();
          if (urlId && urlId !== tweetId) {
            variants = cache.get(urlId) || [];
          }
        }

        // 备用2：如果缓存中只有一条记录且当前页面也只有一个视频，直接使用
        // （覆盖直接打开推文详情页、tweetId 不匹配但缓存有数据的场景）
        if (variants.length === 0 && cache.size > 0 && cache.size <= 3) {
          for (const [cachedId, cachedVariants] of cache) {
            // 如果缓存的 ID 包含在当前 URL 中，说明是当前推文
            if (window.location.href.includes(cachedId)) {
              variants = cachedVariants;
              break;
            }
          }
          // 最终兜底：如果缓存只有一条，且上面都没命中
          if (variants.length === 0 && cache.size === 1) {
            const [, singleVariants] = [...cache][0];
            variants = singleVariants;
          }
        }

        // 备用3：从 video src 获取（非 blob: URL 时有效）
        if (variants.length === 0 && videoEl) {
          const src = videoEl.src || videoEl.currentSrc || '';
          if (src && !src.startsWith('blob:')) {
            variants = [{ url: src, bitrate: 0, content_type: 'video/mp4' }];
          }
        }

        // 备用4：从 source 标签获取
        if (variants.length === 0 && videoEl) {
          videoEl.querySelectorAll('source').forEach(source => {
            const srcUrl = source.src;
            if (srcUrl && srcUrl.includes('.mp4')) {
              variants.push({ url: srcUrl, bitrate: 0, content_type: 'video/mp4' });
            }
          });
        }

        // 检测是否为 GIF（X 的 GIF 实际是短视频循环播放）
        const isGif = !!article.querySelector('[data-testid="gifPlayer"]') ||
          (videoEl && videoEl.loop);

        media.push({
          type: isGif ? 'gif' : 'video',
          variants: variants,
          thumbnailUrl: posterUrl,
          duration: videoEl ? Math.round(videoEl.duration || 0) : 0,
          tweetId: tweetId
        });
      }

      console.info('[X Saver] extractMedia 结果:', media.length, '个媒体',
        media.map(m => m.type + ':variants=' + (m.variants?.length || 0) + (m.url ? ':' + m.url.substring(0, 40) : '')).join(', '));
      if (media.length === 0 && allVideos.length > 0) {
        console.warn('[X Saver] 警告：article 内有 video 元素但 extractMedia 未提取到！video.src:', allVideos[0]?.src?.substring(0, 60));
      }
      return media;
    },

    // 获取原图 URL（去掉尺寸参数）
    _getOriginalImageUrl(url) {
      // https://pbs.twimg.com/media/xxx?format=jpg&name=small
      // → https://pbs.twimg.com/media/xxx?format=jpg&name=orig
      try {
        const u = new URL(url);
        u.searchParams.set('name', 'orig');
        if (!u.searchParams.has('format')) {
          u.searchParams.set('format', 'jpg');
        }
        return u.toString();
      } catch {
        return url.replace(/[?&]name=\w+/, '?name=orig');
      }
    },

    // 提取元数据（互动数据）
    extractMetadata(article) {
      const result = {
        createdAt: '',
        likes: 0,
        retweets: 0,
        replies: 0,
        views: 0,
        bookmarks: 0
      };

      // 时间
      const timeEl = article.querySelector('time');
      if (timeEl) {
        result.createdAt = timeEl.getAttribute('datetime') || timeEl.textContent;
      }

      // 互动按钮区域
      const actionGroup = article.querySelector('[role="group"]');
      if (actionGroup) {
        const buttons = actionGroup.querySelectorAll('button');
        buttons.forEach(btn => {
          const label = btn.getAttribute('aria-label') || '';
          const text = btn.textContent.trim();

          // 回复数
          if (label.includes('repl') || label.includes('回复') || label.includes('Reply')) {
            result.replies = parseDisplayNumber(text) || this._extractNumberFromLabel(label);
          }
          // 转发数
          if (label.includes('Repost') || label.includes('Retweet') || label.includes('转推') || label.includes('转发')) {
            result.retweets = parseDisplayNumber(text) || this._extractNumberFromLabel(label);
          }
          // 点赞数
          if (label.includes('Like') || label.includes('喜欢') || label.includes('赞')) {
            result.likes = parseDisplayNumber(text) || this._extractNumberFromLabel(label);
          }
          // 书签数
          if (label.includes('Bookmark') || label.includes('书签')) {
            result.bookmarks = parseDisplayNumber(text) || this._extractNumberFromLabel(label);
          }
        });
      }

      // 浏览量（推文详情页独有）
      const viewsEl = article.querySelector('a[href*="/analytics"] span, [aria-label*="view"], [aria-label*="浏览"]');
      if (viewsEl) {
        result.views = parseDisplayNumber(viewsEl.textContent);
      }
      // 备用：从 aria-label 提取
      if (!result.views) {
        const allSpans = article.querySelectorAll('span');
        allSpans.forEach(span => {
          const parent = span.parentElement;
          if (parent && parent.tagName === 'A' && parent.href && parent.href.includes('/analytics')) {
            result.views = parseDisplayNumber(span.textContent);
          }
        });
      }

      return result;
    },

    // 从 aria-label 提取数字
    _extractNumberFromLabel(label) {
      const match = label.match(/(\d[\d,.]*[KMkm]?)/);
      return match ? parseDisplayNumber(match[1]) : 0;
    },

    // 提取引用推文
    extractQuotedTweet(article) {
      const quoteEl = article.querySelector('[data-testid="quoteTweet"]') ||
        article.querySelector('div[role="link"][tabindex="0"]');
      if (!quoteEl) return null;

      // 确认是引用推文而非其他可点击元素
      const innerText = quoteEl.querySelector('[data-testid="tweetText"]');
      if (!innerText) return null;

      const quoted = {
        author: { username: '', displayName: '' },
        text: this._processTextContent(innerText),
        html: innerText.innerHTML,
        url: ''
      };

      // 引用推文的作者
      const userNameEl = quoteEl.querySelector('[data-testid="User-Name"]');
      if (userNameEl) {
        const atMatch = userNameEl.textContent.match(/@(\w+)/);
        if (atMatch) quoted.author.username = atMatch[1];
        const nameSpans = userNameEl.querySelectorAll('span');
        if (nameSpans.length > 0) {
          quoted.author.displayName = nameSpans[0].textContent.trim();
        }
      }

      // 引用推文的链接
      const link = quoteEl.querySelector('a[href*="/status/"]');
      if (link) {
        quoted.url = link.href.startsWith('http') ? link.href : 'https://x.com' + link.getAttribute('href');
      }

      return quoted;
    },

    // ============================================================
    // Thread 检测与提取
    // ============================================================

    // 检测当前页面是否为 Thread
    isThread() {
      // 推文详情页中，同一作者的连续推文
      const articles = document.querySelectorAll('article[data-testid="tweet"]');
      if (articles.length < 2) return false;

      // 获取第一条推文的作者
      const firstAuthor = this.extractAuthor(articles[0]).username;
      if (!firstAuthor) return false;

      // 检查是否有连续的同作者推文（至少2条）
      let consecutiveCount = 0;
      for (const art of articles) {
        const author = this.extractAuthor(art).username;
        if (author === firstAuthor) {
          consecutiveCount++;
        } else {
          break; // 遇到不同作者就停止
        }
      }

      // 还要检查是否有"展示此Thread"按钮或连接线
      const hasThreadLine = !!document.querySelector('[data-testid="Tweet-thread-line"]') ||
        !!document.querySelector('div[style*="width: 2px"]');

      return consecutiveCount >= 2 || hasThreadLine;
    },

    // 提取 Thread 中的所有推文
    extractThread(mainArticle) {
      const articles = document.querySelectorAll('article[data-testid="tweet"]');
      const mainAuthor = this.extractAuthor(mainArticle).username;
      const threadTweets = [];

      for (const art of articles) {
        const author = this.extractAuthor(art).username;
        if (author !== mainAuthor) break; // Thread 结束

        const content = this.extractContent(art);
        const media = this.extractMedia(art);

        threadTweets.push({
          content: content,
          media: media,
          id: this.extractTweetId(art)
        });
      }

      return threadTweets.length > 1 ? threadTweets : null;
    },

    // ============================================================
    // 回复提取
    // ============================================================

    extractReplies(mainArticle) {
      const replies = [];
      const articles = document.querySelectorAll('article[data-testid="tweet"]');
      const mainAuthor = this.extractAuthor(mainArticle).username;
      let passedMain = false;
      let passedThread = false;

      for (const art of articles) {
        if (art === mainArticle) {
          passedMain = true;
          continue;
        }

        if (!passedMain) continue;

        const author = this.extractAuthor(art);

        // 跳过 Thread 中的后续推文
        if (!passedThread && author.username === mainAuthor) {
          continue;
        }
        passedThread = true;

        // 提取回复
        const content = this.extractContent(art);
        const media = this.extractMedia(art);
        const metadata = this.extractMetadata(art);

        replies.push({
          author: author,
          content: content,
          media: media,
          metadata: metadata,
          url: this.extractTweetUrl(art)
        });
      }

      return replies;
    },

    // ============================================================
    // 长文章（X Articles / Notes）提取
    // ============================================================

    extractArticle() {
      // X Articles 有独立的文章容器
      const articleContainer = document.querySelector('[data-testid="article"]') ||
        document.querySelector('article.r-article') ||
        document.querySelector('[role="article"]');

      if (!articleContainer) return null;

      return {
        type: 'article',
        title: this._extractArticleTitle(articleContainer),
        content: {
          html: articleContainer.innerHTML,
          text: articleContainer.textContent
        },
        author: this.extractAuthor(articleContainer.closest('article[data-testid="tweet"]') || articleContainer),
        url: window.location.href,
        id: this.getTweetIdFromUrl()
      };
    },

    _extractArticleTitle(container) {
      // 长文章通常有标题
      const h1 = container.querySelector('h1');
      if (h1) return h1.textContent.trim();
      const h2 = container.querySelector('h2');
      if (h2) return h2.textContent.trim();
      return '';
    }
  };

  // ============================================================
  // 第五部分：Markdown 转换器
  // ============================================================

  let turndownService = null;

  function createTurndownService() {
    if (typeof TurndownService === 'undefined') {
      log('TurndownService 未加载');
      return null;
    }

    const td = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-',
      emDelimiter: '*',
      strongDelimiter: '**',
      linkStyle: 'inlined'
    });

    // 自定义规则：Twemoji 图片 → Unicode emoji
    td.addRule('twemoji', {
      filter: function (node) {
        return node.tagName === 'IMG' &&
          (node.src.includes('emoji') || node.src.includes('twemoji') ||
            (node.alt && node.alt.length <= 4 && /[\u{1F000}-\u{1FFFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u.test(node.alt)));
      },
      replacement: function (content, node) {
        return node.alt || '';
      }
    });

    // 自定义规则：@mentions
    td.addRule('mentions', {
      filter: function (node) {
        return node.tagName === 'A' && /^\/@?\w+$/.test(node.getAttribute('href') || '');
      },
      replacement: function (content, node) {
        const href = node.getAttribute('href') || '';
        const username = href.replace('/', '').replace('@', '');
        return `[@${username}](https://x.com/${username})`;
      }
    });

    // 自定义规则：#hashtags
    td.addRule('hashtags', {
      filter: function (node) {
        return node.tagName === 'A' &&
          (node.getAttribute('href') || '').includes('/hashtag/');
      },
      replacement: function (content, node) {
        const tag = content.replace('#', '').trim();
        return `[#${tag}](https://x.com/hashtag/${encodeURIComponent(tag)})`;
      }
    });

    // 自定义规则：短链接展开
    td.addRule('tcoLinks', {
      filter: function (node) {
        return node.tagName === 'A' &&
          (node.getAttribute('href') || '').includes('t.co');
      },
      replacement: function (content, node) {
        const expandedUrl = node.title || node.getAttribute('href') || '';
        const displayText = content.trim();
        if (expandedUrl && expandedUrl !== displayText) {
          return `[${displayText}](${expandedUrl})`;
        }
        return `[${displayText}](${node.getAttribute('href')})`;
      }
    });

    return td;
  }

  // 将推文数据转换为 Markdown
  function convertToMarkdown(tweetData, config) {
    let md = '';

    // --- Frontmatter ---
    if (config.addMetadata) {
      md += '---\n';
      md += `来源: ${tweetData.url}\n`;
      md += `作者: "@${tweetData.author.username}"\n`;
      md += `昵称: "${tweetData.author.displayName}"\n`;
      if (tweetData.author.verified) md += `认证: true\n`;
      md += `类型: ${tweetData.type === 'thread' ? 'Thread' : tweetData.type === 'article' ? '长文章' : '推文'}\n`;
      md += `发布时间: ${tweetData.metadata.createdAt}\n`;
      md += `保存时间: ${getBeijingTime()}\n`;
      md += `点赞: ${tweetData.metadata.likes}\n`;
      md += `转发: ${tweetData.metadata.retweets}\n`;
      md += `回复: ${tweetData.metadata.replies}\n`;
      if (tweetData.metadata.views) md += `浏览: ${tweetData.metadata.views}\n`;
      if (tweetData.content.entities.hashtags.length > 0) {
        md += `标签: [${tweetData.content.entities.hashtags.map(t => `"${t}"`).join(', ')}]\n`;
      }
      md += 'tags: [x, twitter]\n';
      md += '---\n\n';
    }

    // --- 作者信息 ---
    md += `# ${tweetData.author.displayName} (@${tweetData.author.username})\n\n`;

    // --- 正文 ---
    if (tweetData.type === 'thread' && tweetData.thread) {
      // Thread：多条推文合并
      tweetData.thread.forEach((tweet, index) => {
        md += `## 🧵 ${index + 1}/${tweetData.thread.length}\n\n`;
        md += convertContentToMd(tweet.content) + '\n\n';

        // Thread 中每条推文的媒体
        if (tweet.media && tweet.media.length > 0) {
          md += convertMediaToMd(tweet.media, { author: tweetData.author.username, tweetId: tweet.id || tweetData.id }) + '\n\n';
        }
      });
    } else {
      // 单条推文或长文章
      md += convertContentToMd(tweetData.content) + '\n\n';
    }

    // --- 媒体 ---
    if (tweetData.media && tweetData.media.length > 0 && tweetData.type !== 'thread') {
      md += convertMediaToMd(tweetData.media, { author: tweetData.author.username, tweetId: tweetData.id }) + '\n\n';
    }

    // --- 引用推文 ---
    if (tweetData.quotedTweet) {
      md += '---\n\n';
      md += '## 引用推文\n\n';
      md += `> **${tweetData.quotedTweet.author.displayName}** ([@${tweetData.quotedTweet.author.username}](https://x.com/${tweetData.quotedTweet.author.username}))\n>\n`;
      const quotedLines = tweetData.quotedTweet.text.split('\n');
      quotedLines.forEach(line => {
        md += `> ${line}\n`;
      });
      if (tweetData.quotedTweet.url) {
        md += `>\n> [原推文](${tweetData.quotedTweet.url})\n`;
      }
      md += '\n';
    }

    // --- 互动数据卡片 ---
    md += '---\n\n';
    md += '| 👍 点赞 | 🔁 转发 | 💬 回复 | 👁️ 浏览 |\n';
    md += '|---------|---------|---------|----------|\n';
    md += `| ${formatNumber(tweetData.metadata.likes)} | ${formatNumber(tweetData.metadata.retweets)} | ${formatNumber(tweetData.metadata.replies)} | ${formatNumber(tweetData.metadata.views)} |\n\n`;

    // --- 回复区 ---
    if (tweetData.replies && tweetData.replies.length > 0) {
      md += '---\n\n';
      md += `## 回复区（共${tweetData.replies.length}条）\n\n`;

      tweetData.replies.forEach((reply, index) => {
        if (config.foldReplies) {
          md += `<details>\n<summary><b>${index + 1}楼 - @${reply.author.username}</b> (👍${reply.metadata.likes})</summary>\n\n`;
          md += convertContentToMd(reply.content) + '\n';
          if (reply.media && reply.media.length > 0) {
            md += convertMediaToMd(reply.media, { author: reply.author.username, tweetId: reply.id || 'reply' }) + '\n';
          }
          md += '</details>\n\n';
        } else {
          md += `### ${index + 1}楼 - ${reply.author.displayName} (@${reply.author.username}) 👍${reply.metadata.likes}\n\n`;
          md += convertContentToMd(reply.content) + '\n\n';
          if (reply.media && reply.media.length > 0) {
            md += convertMediaToMd(reply.media, { author: reply.author.username, tweetId: reply.id || 'reply' }) + '\n\n';
          }
        }
      });
    }

    return md;
  }

  // 内容 HTML → Markdown
  function convertContentToMd(content) {
    if (!content) return '';

    // 优先使用 Turndown 转换 HTML
    if (turndownService && content.html) {
      try {
        return turndownService.turndown(content.html);
      } catch (e) {
        log('Turndown 转换失败, 回退到纯文本:', e);
      }
    }

    // 回退到纯文本
    return content.text || '';
  }

  // ============================================================
  // 第三方链接增强（YouTube/B站/GitHub等嵌入预览）
  // ============================================================

  // 链接匹配规则表
  const LINK_EMBED_RULES = [
    // YouTube
    {
      name: 'YouTube',
      pattern: /https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/,
      embed: (match) => {
        const videoId = match[1];
        return `<iframe width="100%" height="360" src="https://www.youtube.com/embed/${videoId}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen style="border-radius:12px;"></iframe>`;
      }
    },
    // Bilibili
    {
      name: 'Bilibili',
      pattern: /https?:\/\/(?:www\.)?bilibili\.com\/video\/(BV[\w]+)/,
      embed: (match) => {
        const bvid = match[1];
        return `<iframe width="100%" height="360" src="https://player.bilibili.com/player.html?bvid=${bvid}&high_quality=1" frameborder="0" allowfullscreen style="border-radius:12px;"></iframe>`;
      }
    },
    // Vimeo
    {
      name: 'Vimeo',
      pattern: /https?:\/\/(?:www\.)?vimeo\.com\/(\d+)/,
      embed: (match) => {
        const id = match[1];
        return `<iframe width="100%" height="360" src="https://player.vimeo.com/video/${id}" frameborder="0" allow="autoplay; fullscreen" allowfullscreen style="border-radius:12px;"></iframe>`;
      }
    },
    // GitHub 仓库
    {
      name: 'GitHub',
      pattern: /https?:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/?(?:#[\w-]*)?$/,
      embed: (match, fullUrl) => {
        const repo = match[1];
        return `> **GitHub** - [${repo}](${fullUrl})\n> \`https://github.com/${repo}\`\n> \n> <a href="${fullUrl}"><img src="https://opengraph.githubassets.com/1/${repo}" alt="${repo}" style="max-width:100%;border-radius:12px;"></a>`;
      }
    },
    // 百度网盘
    {
      name: '百度网盘',
      pattern: /https?:\/\/pan\.baidu\.com\/s\/([\w-]+)/,
      embed: (match, fullUrl) => {
        return `> **百度网盘分享**\n> [点击打开百度网盘链接](${fullUrl})`;
      }
    },
    // Spotify
    {
      name: 'Spotify',
      pattern: /https?:\/\/open\.spotify\.com\/(track|album|playlist)\/([\w]+)/,
      embed: (match, fullUrl) => {
        const type = match[1];
        const id = match[2];
        return `<iframe src="https://open.spotify.com/embed/${type}/${id}" width="100%" height="152" frameborder="0" allow="encrypted-media" style="border-radius:12px;"></iframe>`;
      }
    },
    // TikTok
    {
      name: 'TikTok',
      pattern: /https?:\/\/(?:www\.)?tiktok\.com\/@[\w.-]+\/video\/(\d+)/,
      embed: (match, fullUrl) => {
        return `> **TikTok 视频**\n> [点击观看](${fullUrl})\n> \n> <iframe src="https://www.tiktok.com/embed/v2/${match[1]}" width="100%" height="600" frameborder="0" allowfullscreen style="border-radius:12px;"></iframe>`;
      }
    }
  ];

  // 增强 Markdown 中的外部链接
  // 注意：跳过 frontmatter 和代码块内的 URL，避免破坏格式
  function enhanceExternalLinks(markdown) {
    if (!currentConfig?.enableLinkPreview) return markdown;

    // 先标记 frontmatter 和代码块的范围，只处理正文部分
    const lines = markdown.split('\n');
    const safeLine = []; // true = 可处理, false = 跳过
    let inFrontmatter = false;
    let inCodeBlock = false;
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed === '---' && (i === 0 || inFrontmatter)) {
        inFrontmatter = !inFrontmatter;
        safeLine.push(false);
        continue;
      }
      if (trimmed.startsWith('```')) {
        inCodeBlock = !inCodeBlock;
        safeLine.push(false);
        continue;
      }
      safeLine.push(!inFrontmatter && !inCodeBlock);
    }

    // 构建安全区域的字符位置集合
    const safeRanges = [];
    let charPos = 0;
    for (let i = 0; i < lines.length; i++) {
      if (safeLine[i]) {
        safeRanges.push([charPos, charPos + lines[i].length]);
      }
      charPos += lines[i].length + 1; // +1 for \n
    }

    function isInSafeRange(index) {
      for (const [start, end] of safeRanges) {
        if (index >= start && index < end) return true;
      }
      return false;
    }

    // 匹配 Markdown 链接：[text](url)
    const linkRegex = /\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g;
    let result = markdown;
    const replacements = [];

    let match;
    while ((match = linkRegex.exec(markdown)) !== null) {
      if (!isInSafeRange(match.index)) continue;
      const [fullMatch, linkText, url] = match;

      for (const rule of LINK_EMBED_RULES) {
        const ruleMatch = url.match(rule.pattern);
        if (ruleMatch) {
          const embed = rule.embed(ruleMatch, url);
          replacements.push({
            original: fullMatch,
            replacement: `${fullMatch}\n\n${embed}`
          });
          break;
        }
      }
    }

    // 也匹配独立的 URL（不在 Markdown 链接语法中的裸链接）
    const bareUrlRegex = /(?<!\]\()(?<!\()(https?:\/\/[\S]+?)(?=[)\s\n]|$)/g;
    while ((match = bareUrlRegex.exec(markdown)) !== null) {
      if (!isInSafeRange(match.index)) continue;
      const url = match[0];
      const beforeChar = match.index > 0 ? markdown[match.index - 1] : '';
      if (beforeChar === '(' || beforeChar === '"') continue;

      for (const rule of LINK_EMBED_RULES) {
        const ruleMatch = url.match(rule.pattern);
        if (ruleMatch) {
          const embed = rule.embed(ruleMatch, url);
          replacements.push({
            original: url,
            replacement: `${url}\n\n${embed}`
          });
          break;
        }
      }
    }

    // 应用替换
    const uniqueReplacements = [];
    const seen = new Set();
    for (const r of replacements) {
      if (!seen.has(r.original)) {
        seen.add(r.original);
        uniqueReplacements.push(r);
      }
    }

    for (const r of uniqueReplacements) {
      result = result.replace(r.original, r.replacement);
    }

    return result;
  }

  // 媒体 → Markdown
  // 每种媒体类型独立判断：
  // - 勾选了对应下载选项：使用 OB wiki link ![[文件名]] 引用本地文件（纯文件名，最短路径匹配）
  // - 未勾选：使用 HTML 标签嵌入在线链接（OB 阅读模式可实时预览）
  // mediaContext: { author, tweetId } — 用于生成本地文件名
  function convertMediaToMd(mediaList, mediaContext) {
    if (!mediaList || mediaList.length === 0) return '';

    // tweetId fallback 必须与 downloadMediaGroup 保持一致！
    const tweetId = mediaContext?.tweetId || 'tweet';

    let md = '';
    mediaList.forEach((m, i) => {
      switch (m.type) {
        case 'photo':
          if (currentConfig?.autoDownloadImages) {
            // 已下载：OB wiki link（纯文件名，OB 全局搜索 vault 内匹配）
            const ext = m.url.includes('format=png') ? 'png' : 'jpg';
            const filename = `${tweetId}_${i + 1}.${ext}`;
            md += `![[${filename}]]\n\n`;
          } else {
            // 未下载：HTML img 嵌入在线链接（OB 阅读模式可预览）
            const alt = m.alt || '图片';
            md += `<img src="${m.url}" alt="${alt}" style="max-width:100%;border-radius:12px;">\n\n`;
          }
          break;
        case 'video':
          md += `🎬 **视频**`;
          if (m.duration) md += ` (${Math.floor(m.duration / 60)}:${String(m.duration % 60).padStart(2, '0')})`;
          md += '\n\n';
          if (currentConfig?.autoDownloadVideos) {
            // 已下载：OB wiki link（纯文件名，OB 全局搜索 vault 内匹配）
            const filename = `${tweetId}_video_${i + 1}.mp4`;
            md += `![[${filename}]]\n\n`;
          } else {
            // 未下载：HTML 嵌入
            if (m.variants && m.variants.length > 0) {
              const best = m.variants[0];
              md += `<video src="${best.url}" controls poster="${m.thumbnailUrl || ''}" style="max-width:100%;border-radius:12px;"></video>\n\n`;
            } else {
              // variants 为空时用推文嵌入 iframe（保证视频可播放）
              md += `<iframe src="https://platform.twitter.com/embed/Tweet.html?id=${tweetId}" width="100%" height="400" style="border:none;border-radius:12px;" allowfullscreen></iframe>\n\n`;
            }
          }
          break;
        case 'gif':
          md += `🎞️ **GIF 动图**\n\n`;
          if (currentConfig?.autoDownloadVideos) {
            // 已下载：OB wiki link（纯文件名，OB 全局搜索 vault 内匹配）
            const filename = `${tweetId}_video_${i + 1}.gif.mp4`;
            md += `![[${filename}]]\n\n`;
          } else {
            // 未下载：HTML 嵌入
            if (m.variants && m.variants.length > 0) {
              md += `<video src="${m.variants[0].url}" autoplay loop muted playsinline style="max-width:100%;border-radius:12px;"></video>\n\n`;
            } else {
              // variants 为空时用推文嵌入 iframe
              md += `<iframe src="https://platform.twitter.com/embed/Tweet.html?id=${tweetId}" width="100%" height="400" style="border:none;border-radius:12px;" allowfullscreen></iframe>\n\n`;
            }
          }
          break;
      }
    });

    return md;
  }

  // ============================================================
  // 第六部分：图片 Base64 嵌入
  // ============================================================

  async function processMarkdownImages(markdown, config) {
    if (!config.embedImages) return markdown;

    const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
    const matches = [...markdown.matchAll(imageRegex)];

    if (matches.length === 0) return markdown;

    showToast(_t('content.toast.embedImages', { count: matches.length }), 'info');

    for (const match of matches) {
      const [fullMatch, alt, url] = match;

      // 跳过已经是 Base64 的图片
      if (url.startsWith('data:')) continue;

      // 跳过非 twimg 图片（避免处理外部图片导致错误）
      if (!url.includes('twimg.com') && !url.includes('pbs.twimg.com')) continue;

      try {
        const base64 = await downloadAndConvertImage(url, config);
        if (base64) {
          markdown = markdown.replace(fullMatch, `![${alt}](${base64})`);
        }
      } catch (e) {
        log('图片嵌入失败:', url, e);
      }
    }

    return markdown;
  }

  // 下载图片并转为 Base64
  async function downloadAndConvertImage(url, config) {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';

      img.onload = function () {
        try {
          const canvas = document.createElement('canvas');
          let width = img.naturalWidth;
          let height = img.naturalHeight;

          // 限制最大宽度
          if (config.imageMaxWidth && width > config.imageMaxWidth) {
            height = Math.round(height * (config.imageMaxWidth / width));
            width = config.imageMaxWidth;
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);

          const base64 = canvas.toDataURL('image/jpeg', config.imageQuality || 0.9);
          resolve(base64);
        } catch (e) {
          log('Canvas 转换失败:', e);
          resolve(null);
        }
      };

      img.onerror = function () {
        log('图片加载失败:', url);
        resolve(null);
      };

      img.src = url;
    });
  }

  // ============================================================
  // 第六(b)部分：翻译模块
  // ============================================================

  // 检测文本是否为中文
  function isChinese(text) {
    if (!text) return true;
    const cleaned = text.replace(/[\s\n\r@#\d.,!?;:'"()\[\]{}<>\/\\|`~\-_=+*&^%$@!？，。、；：""''（）【】《》…—\u200b-\u200f\u2028-\u202f\uFEFF]/g, '');
    if (cleaned.length === 0) return true;
    // 统计中文字符占比
    const chineseChars = cleaned.match(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g) || [];
    return chineseChars.length / cleaned.length > 0.3;
  }

  // 翻译 Markdown 文本（保留 Markdown 语法结构）
  async function translateMarkdown(markdown, config) {
    if (!config.enableTranslation) return markdown;

    // 提取需要翻译的纯文本段落（跳过 frontmatter、代码块、链接、图片引用等）
    const lines = markdown.split('\n');
    const translationMap = []; // [{ lineIndex, originalText, translatedText }]

    let inFrontmatter = false;
    let inCodeBlock = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // 跳过 frontmatter
      if (line.trim() === '---') {
        if (i === 0 || inFrontmatter) { inFrontmatter = !inFrontmatter; continue; }
      }
      if (inFrontmatter) continue;

      // 跳过代码块
      if (line.trim().startsWith('```')) { inCodeBlock = !inCodeBlock; continue; }
      if (inCodeBlock) continue;

      // 跳过：标题标记、分隔线、表格、空行、HTML标签、图片引用
      if (/^(\s*$|---$|\|.*\||<[^>]+>|!\[\[|!\[)/.test(line.trim())) continue;

      // 提取可翻译文本（去掉 Markdown 标记）
      let cleanText = line
        .replace(/^#{1,6}\s+/, '')     // 去标题标记
        .replace(/^>\s*/, '')          // 去引用标记
        .replace(/^[-*]\s+/, '')       // 去列表标记
        .replace(/^\d+\.\s+/, '')      // 去有序列表标记
        .replace(/\*\*([^*]+)\*\*/g, '$1')  // 去粗体
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')  // 去链接保留文字
        .trim();

      if (cleanText.length > 0 && !isChinese(cleanText)) {
        translationMap.push({ lineIndex: i, originalText: cleanText });
      }
    }

    if (translationMap.length === 0) return markdown;

    // 合并所有待翻译文本，用分隔符连接后一次性翻译（减少API调用）
    // 使用纯数字+符号组合，Google Translate 不会修改这种格式
    const SEPARATOR = '\n|~|0x7C|~|\n';
    const SPLIT_REGEX = /\|~\|0x7C\|~\|/;
    const targetLang = config.translationTargetLang || 'zh-CN';

    // LRU 缓存：检查每段文本是否已缓存
    const uncachedItems = [];
    const cachedResults = new Map(); // lineIndex → translatedText
    for (const item of translationMap) {
      const cacheKey = `${targetLang}:${item.originalText}`;
      if (translationCache.has(cacheKey)) {
        cachedResults.set(item.lineIndex, translationCache.get(cacheKey));
        // LRU: 移到最新位置
        translationCache.delete(cacheKey);
        translationCache.set(cacheKey, cachedResults.get(item.lineIndex));
      } else {
        uncachedItems.push(item);
      }
    }

    log(`翻译缓存命中 ${cachedResults.size} 段，待翻译 ${uncachedItems.length} 段`);

    // 如果全部命中缓存，直接应用
    let translated = [];
    if (uncachedItems.length === 0) {
      // 全部来自缓存
      translated = translationMap.map(t => cachedResults.get(t.lineIndex) || t.originalText);
    } else {
      // 需要调 API 翻译未缓存的部分
      const allText = uncachedItems.map(t => t.originalText).join(SEPARATOR);

      try {
        const cachedHint = cachedResults.size > 0 ? _t('content.toast.translatingCached', { count: cachedResults.size }) : '';
        showToast(_t('content.toast.translating', { count: uncachedItems.length, cached: cachedHint }), 'info');

        const response = await sendMessageAsync({
          action: 'translateText',
          text: allText,
          targetLang: targetLang
        });

        if (!response.success || !response.translatedText) {
          log('翻译失败:', response.error);
          return markdown;
        }

        // 拆分翻译结果
        let apiTranslated = response.translatedText.split(SPLIT_REGEX);

        // 降级逐段翻译
        if (apiTranslated.length !== uncachedItems.length) {
          log('分隔符拆分数量不匹配，降级为逐段翻译');
          apiTranslated = [];
          for (const item of uncachedItems) {
            try {
              const singleResp = await sendMessageAsync({
                action: 'translateText',
                text: item.originalText,
                targetLang: targetLang
              });
              apiTranslated.push(singleResp.success ? singleResp.translatedText : item.originalText);
            } catch (e) {
              apiTranslated.push(item.originalText);
            }
          }
        }

        // 写入缓存
        for (let k = 0; k < uncachedItems.length && k < apiTranslated.length; k++) {
          const cacheKey = `${targetLang}:${uncachedItems[k].originalText}`;
          translationCache.set(cacheKey, apiTranslated[k].trim());
          // LRU 淘汰
          if (translationCache.size > TRANSLATION_CACHE_MAX) {
            const oldest = translationCache.keys().next().value;
            translationCache.delete(oldest);
          }
        }

        // 合并缓存 + API 结果
        let apiIdx = 0;
        translated = translationMap.map(t => {
          if (cachedResults.has(t.lineIndex)) {
            return cachedResults.get(t.lineIndex);
          }
          return apiTranslated[apiIdx++]?.trim() || t.originalText;
        });
      } catch (error) {
        log('翻译出错:', error);
        return markdown;
      }
    }

    // 应用翻译结果
    const resultLines = [...lines];
    for (let j = 0; j < translationMap.length && j < translated.length; j++) {
      const { lineIndex } = translationMap[j];
      const translatedText = translated[j]?.trim();

      if (!translatedText || translatedText === translationMap[j].originalText) continue;

      if (config.translationMode === 'replace') {
        const leadingMarks = lines[lineIndex].match(/^(\s*(?:#{1,6}\s+|>\s*|[-*]\s+|\d+\.\s+)?)/);
        resultLines[lineIndex] = (leadingMarks ? leadingMarks[1] : '') + translatedText;
      } else {
        resultLines[lineIndex] = lines[lineIndex] + '\n> **译文：** ' + translatedText;
      }
    }

    return resultLines.join('\n');
  }

  // ============================================================
  // 第七部分：媒体下载
  // ============================================================

  // 下载媒体文件
  // 重要：文件名规则必须与 convertMediaToMd() 完全一致！
  // 按推文逐个处理，避免 Thread 合并导致索引不匹配。
  async function downloadMedia(tweetData, config) {
    const downloads = [];
    const downloadErrors = [];
    const author = tweetData.author.username;
    const folder = config.mediaDownloadFolder || 'X下载附件';

    // 统计所有可下载的媒体数量
    let totalPhotos = 0;
    let totalVideos = 0;
    function countMedia(mediaList) {
      if (!mediaList) return;
      for (const m of mediaList) {
        if (m.type === 'photo') totalPhotos++;
        if (m.type === 'video' || m.type === 'gif') totalVideos++;
      }
    }
    // 统计主推文/thread/回复中的媒体
    if (tweetData.type === 'thread' && tweetData.thread) {
      for (const tweet of tweetData.thread) countMedia(tweet.media);
    } else {
      countMedia(tweetData.media);
    }
    if (tweetData.replies) {
      for (const reply of tweetData.replies) countMedia(reply.media);
    }

    log('[下载] 检测到媒体: 图片=' + totalPhotos + ', 视频=' + totalVideos +
        ', autoImg=' + config.autoDownloadImages + ', autoVid=' + config.autoDownloadVideos);

    // 注意：API 视频主动检测已在 handleSave 步骤 1b 中提前完成
    // 这确保了 convertMediaToMd 生成的 ![[xxx_video_1.mp4]] 引用和下载文件名一致

    // 如果没有可下载的媒体，直接返回
    if (totalPhotos === 0 && totalVideos === 0) {
      log('[下载] 未检测到可下载的媒体');
      return 0;
    }

    // 计算实际要下载的数量
    const willDownload = (config.autoDownloadImages ? totalPhotos : 0) +
                         (config.autoDownloadVideos ? totalVideos : 0);
    if (willDownload === 0) {
      log('[下载] 有媒体但自动下载未开启对应类型');
      return 0;
    }

    // 辅助：下载单个媒体组（一条推文的所有媒体）
    // tweetId fallback 必须与 convertMediaToMd 保持一致！
    async function downloadMediaGroup(mediaList, groupAuthor, groupTweetId) {
      groupTweetId = groupTweetId || 'tweet';
      for (let i = 0; i < mediaList.length; i++) {
        const m = mediaList[i];

        if (m.type === 'photo' && config.autoDownloadImages) {
          const ext = m.url.includes('format=png') ? 'png' : 'jpg';
          const filename = `${folder}/@${groupAuthor}/${groupTweetId}_${i + 1}.${ext}`;
          log('[下载] 图片:', filename, 'url:', m.url?.substring(0, 60));
          downloads.push(
            sendMessageAsync({ action: 'downloadFile', url: m.url, filename: filename })
              .then(result => {
                if (!result.success) {
                  downloadErrors.push('图片 ' + (i+1) + ': ' + result.error);
                }
                return result;
              })
          );
        }

        if ((m.type === 'video' || m.type === 'gif') && config.autoDownloadVideos) {
          console.info('[X Saver] 检测到视频/GIF, type:', m.type, ', variants:', m.variants?.length || 0, ', tweetId:', m.tweetId);
          // 兜底：如果缓存中没有视频 URL，通过 background.js 调 X API 获取
          if (!m.variants || m.variants.length === 0) {
            let fallbackId = m.tweetId || groupTweetId;
            // 如果 fallbackId 是生成的临时 ID（tw_xxx），API 调用必定失败
            // 尝试从页面 URL 获取真实推文 ID
            if (!fallbackId || fallbackId.startsWith('tw_') || fallbackId === 'tweet') {
              const urlMatch = window.location.pathname.match(/\/status\/(\d+)/);
              if (urlMatch) fallbackId = urlMatch[1];
            }
            console.info('[X Saver] 视频缓存未命中，调用 API 兜底, fallbackId:', fallbackId);
            try {
              const result = await sendMessageAsync({ action: 'fetchVideoVariants', tweetId: fallbackId, discoveredOperationIds: getDiscoveredOperationIds() });
              console.info('[X Saver] API 兜底结果:', JSON.stringify({ success: result.success, variantsCount: result.variants?.length, error: result.error }));
              if (result.success && result.variants && result.variants.length > 0) {
                m.variants = result.variants;
                getVideoCache().set(fallbackId, result.variants);
                console.info('[X Saver] API 兜底成功，获取到', result.variants.length, '个清晰度');
              } else {
                console.warn('[X Saver] API 兜底失败:', result.error || '无 variants');
              }
            } catch (e) {
              console.error('[X Saver] API 兜底异常:', e);
            }
          }

          if (m.variants && m.variants.length > 0) {
            let selectedUrl = '';
            if (config.videoQuality === 'highest') {
              selectedUrl = m.variants[0].url;
            } else if (config.videoQuality === 'lowest') {
              selectedUrl = m.variants[m.variants.length - 1].url;
            } else {
              selectedUrl = await showQualityPicker(m.variants);
            }
            if (selectedUrl) {
              const ext = m.type === 'gif' ? 'gif.mp4' : 'mp4';
              const filename = `${folder}/@${groupAuthor}/${groupTweetId}_video_${i + 1}.${ext}`;
              log('[下载] 视频:', filename);
              downloads.push(
                sendMessageAsync({ action: 'downloadFile', url: selectedUrl, filename: filename })
                  .then(result => {
                    if (!result.success) {
                      downloadErrors.push('视频 ' + (i+1) + ': ' + result.error);
                    }
                    return result;
                  })
              );
            }
          } else {
            downloadErrors.push('视频 ' + (i+1) + ': 无法获取下载地址');
          }
        }
      }
    }

    // Thread 模式：按每条推文独立处理
    if (tweetData.type === 'thread' && tweetData.thread) {
      for (const tweet of tweetData.thread) {
        if (tweet.media && tweet.media.length > 0) {
          await downloadMediaGroup(tweet.media, author, tweet.id || tweetData.id);
        }
      }
    } else {
      // 单条推文
      if (tweetData.media && tweetData.media.length > 0) {
        await downloadMediaGroup(tweetData.media, author, tweetData.id);
      }
    }

    // 回复中的媒体也要下载
    if (tweetData.replies && tweetData.replies.length > 0) {
      for (const reply of tweetData.replies) {
        if (reply.media && reply.media.length > 0) {
          await downloadMediaGroup(reply.media, reply.author?.username || author, reply.id || 'reply');
        }
      }
    }

    // 等待所有下载任务完成
    if (downloads.length > 0) {
      showToast(_t('content.toast.downloadingMedia', { count: downloads.length }), 'info');
      const results = await Promise.allSettled(downloads);
      const success = results.filter(r => r.status === 'fulfilled' && r.value?.success).length;
      const failed = downloads.length - success;
      // 重要：即使所有下载任务成功，也要检查 downloadErrors
      // 原因：视频URL获取失败不会产生download任务，但会记录到downloadErrors
      // 场景：推文有1张图+1个视频 → 图片下载成功(downloads=1) + 视频URL获取失败(downloadErrors=1)
      if (failed > 0 || downloadErrors.length > 0) {
        const allErrors = [...downloadErrors];
        results.forEach((r) => {
          if (r.status !== 'fulfilled' || !r.value?.success) {
            allErrors.push(r.value?.error || r.reason?.message || '下载失败');
          }
        });
        showToast(allErrors.slice(0, 3).join('; ') || '部分媒体下载失败', 'warning');
      }
    } else if (willDownload > 0) {
      // downloads 为空但应该有下载——视频URL全部获取失败
      log('[下载] 异常: 预期下载 ' + willDownload + ' 个文件但 downloads 数组为空');
      showToast(downloadErrors.length > 0
        ? downloadErrors.slice(0, 2).join('; ')
        : '媒体下载失败', 'warning');
    }

    return downloads.length;
  }

  // 视频清晰度选择弹窗
  function showQualityPicker(variants) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'x-saver-overlay';
      overlay.innerHTML = `
        <div class="x-saver-quality-picker">
          <h3>${_t('content.quality.title')}</h3>
          <div class="x-saver-quality-options">
            ${variants.map((v, i) => {
        const bitrateMbps = v.bitrate ? (v.bitrate / 1000000).toFixed(1) + ' Mbps' : '未知';
        const resolution = v.url.match(/\/(\d+x\d+)\//)?.[1] || '';
        return `<button class="x-saver-quality-btn" data-index="${i}">
                  ${resolution ? resolution + ' - ' : ''}${bitrateMbps}
                </button>`;
      }).join('')}
          </div>
          <button class="x-saver-cancel-btn">${_t('content.quality.cancel')}</button>
        </div>
      `;

      // 点击遮罩背景关闭（只在直接点击 overlay 时触发，不影响 picker 内部）
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          overlay.remove();
          resolve('');
        }
      });

      overlay.querySelector('.x-saver-cancel-btn').onclick = () => {
        overlay.remove();
        resolve('');
      };

      overlay.querySelectorAll('.x-saver-quality-btn').forEach(btn => {
        btn.onclick = () => {
          const idx = parseInt(btn.dataset.index);
          overlay.remove();
          resolve(variants[idx].url);
        };
      });

      document.body.appendChild(overlay);
    });
  }

  // ============================================================
  // 第八部分：保存逻辑
  // ============================================================

  // 主保存函数
  async function handleSave(bookmarkButton) {
    // 保存锁：防止快速连续点击导致并发保存
    if (isSaving) {
      showToast(_t('content.toast.savingInProgress'), 'info');
      return;
    }
    isSaving = true;

    try {
      // 找到推文 article
      const article = XExtractor.findTweetArticle(bookmarkButton);
      if (!article) {
        showToast(_t('content.toast.noTweet'), 'error');
        return;
      }

      // 加载配置
      try {
        currentConfig = await new Promise((resolve, reject) => {
          chrome.storage.sync.get(DEFAULT_CONFIG, (result) => {
            if (chrome.runtime.lastError) {
              reject(new Error('配置加载失败: ' + chrome.runtime.lastError.message));
            } else {
              resolve(result);
            }
          });
        });
      } catch (configError) {
        log('配置加载失败，使用默认配置:', configError);
        currentConfig = { ...DEFAULT_CONFIG };
      }

      if (!currentConfig.pluginEnabled) {
        if (bookmarkButton) triggerOriginalBookmark(bookmarkButton);
        return;
      }

      // 检查是否至少有一个保存目标
      const hasSaveTarget = currentConfig.saveToObsidian ||
        (currentConfig.saveToNotion && currentConfig.notionToken && currentConfig.notionDatabaseId) ||
        (currentConfig.saveToFeishu && currentConfig.feishuAppId) ||
        currentConfig.exportHtml;

      // 自动下载也算一种有效操作（不需要保存目标也能单独下载媒体）
      const hasDownloadTarget = currentConfig.autoDownloadImages || currentConfig.autoDownloadVideos;

      if (!hasSaveTarget && !hasDownloadTarget) {
        showToast(_t('content.toast.noTarget'), 'warning');
        return;
      }

      showToast(_t('content.toast.saving'), 'info');

      // 1. 提取推文数据
      let tweetData;
      try {
        tweetData = XExtractor.extractTweet(article);
      } catch (extractError) {
        showToast(_t('content.toast.extractFailed', { error: extractError.message }), 'error');
        return;
      }
      if (!tweetData) {
        showToast(_t('content.toast.extractEmpty'), 'error');
        return;
      }

      // 1b. 视频主动检测：如果 DOM 没有检测到视频，通过 API 主动检查
      //     必须在生成 Markdown 之前完成，确保 ![[xxx_video_1.mp4]] 引用正确
      if (currentConfig.autoDownloadVideos && tweetData.id && /^\d+$/.test(tweetData.id)) {
        const hasVideo = tweetData.media && tweetData.media.some(m => m.type === 'video' || m.type === 'gif');
        if (!hasVideo) {
          console.info('[X Saver] DOM 未检测到视频，主动调 API 检查, tweetId:', tweetData.id);
          try {
            const result = await sendMessageAsync({ action: 'fetchVideoVariants', tweetId: tweetData.id, discoveredOperationIds: getDiscoveredOperationIds() });
            if (result.success && result.variants && result.variants.length > 0) {
              console.info('[X Saver] API 发现视频！变体数:', result.variants.length);
              if (!tweetData.media) tweetData.media = [];
              tweetData.media.push({
                type: 'video',
                variants: result.variants,
                thumbnailUrl: '',
                duration: 0,
                tweetId: tweetData.id
              });
            } else {
              console.info('[X Saver] API 确认该推文没有视频');
            }
          } catch (e) {
            console.warn('[X Saver] API 视频检查异常:', e);
          }
        }
      }

      // 2. 提取回复（如果开启，失败不阻断主流程）
      if (currentConfig.saveReplies) {
        try {
          const replies = XExtractor.extractReplies(article);
          const limit = currentConfig.saveAllReplies ? Infinity : currentConfig.replyCount;
          tweetData.replies = replies.slice(0, limit);
        } catch (replyError) {
          log('提取回复失败，跳过:', replyError);
          tweetData.replies = [];
        }
      }

      // 3. 初始化 Turndown
      if (!turndownService) {
        try {
          turndownService = createTurndownService();
        } catch (tdError) {
          log('Turndown 初始化失败:', tdError);
        }
      }

      // 4. 转换为 Markdown
      let markdown;
      try {
        markdown = convertToMarkdown(tweetData, currentConfig);
      } catch (mdError) {
        showToast(_t('content.toast.mdFailed', { error: mdError.message }), 'error');
        return;
      }

      // 5. 媒体下载提前启动（不依赖翻译结果，与后续处理并行）
      let mediaDownloadPromise = null;
      if (currentConfig.autoDownloadImages || currentConfig.autoDownloadVideos) {
        mediaDownloadPromise = downloadMedia(tweetData, currentConfig).catch(err => {
          log('媒体下载出错:', err);
          showToast(_t('content.toast.mediaFailed') || '媒体下载失败: ' + (err.message || ''), 'warning');
          return 0;
        });
      }

      // 6. 图片 Base64 嵌入（失败不阻断，回退到链接模式）
      if (currentConfig.embedImages) {
        try {
          markdown = await processMarkdownImages(markdown, currentConfig);
        } catch (b64Error) {
          log('Base64 嵌入失败，使用链接模式:', b64Error);
        }
      }

      // 7. 链接预览增强（失败不阻断）
      if (currentConfig.enableLinkPreview) {
        try {
          markdown = enhanceExternalLinks(markdown);
        } catch (linkError) {
          log('链接预览增强失败，跳过:', linkError);
        }
      }

      // 8. 翻译（失败不阻断，返回原文）
      if (currentConfig.enableTranslation) {
        try {
          markdown = await translateMarkdown(markdown, currentConfig);
        } catch (transError) {
          log('翻译失败，使用原文:', transError);
        }
      }

      // 9. 并行保存到 Notion/飞书/HTML（不含 Obsidian）
      //    Obsidian 必须最后执行：window.location.href 会触发页面跳转，
      //    如果并行执行会杀死其他正在进行的异步操作
      const saveTasks = [];
      const saveLabels = [];

      if (currentConfig.saveToNotion && currentConfig.notionToken && currentConfig.notionDatabaseId) {
        saveTasks.push(saveToNotion(markdown, tweetData, currentConfig));
        saveLabels.push('Notion');
      }

      if (currentConfig.saveToFeishu && currentConfig.feishuAppId) {
        saveTasks.push(saveToFeishu(markdown, tweetData, currentConfig));
        saveLabels.push('飞书');
      }

      if (currentConfig.exportHtml) {
        saveTasks.push(exportToHtml(markdown, tweetData, currentConfig));
        saveLabels.push('HTML');
      }

      // 10. 先等待网络保存（Notion/飞书/HTML），不含媒体下载
      let saveSucceeded = 0;
      let saveFailed = 0;
      const failedTargets = [];
      let mediaCount = 0;

      if (saveTasks.length > 0) {
        const results = await Promise.allSettled(saveTasks);
        for (let i = 0; i < results.length; i++) {
          if (results[i].status === 'fulfilled') {
            saveSucceeded++;
          } else {
            saveFailed++;
            failedTargets.push(saveLabels[i]);
            log(`${saveLabels[i]} 保存失败:`, results[i].reason);
          }
        }
      }

      // 10b. 等待媒体下载完成（单独等待，确保不被其他任务影响）
      if (mediaDownloadPromise) {
        try {
          const downloadResult = await mediaDownloadPromise;
          if (typeof downloadResult === 'number') {
            mediaCount = downloadResult;
          }
        } catch (e) {
          log('媒体下载最终异常:', e);
        }
      }

      // 11. Obsidian 最后执行（页面跳转前确保其他保存和下载已完成）
      if (currentConfig.saveToObsidian) {
        try {
          await saveToObsidian(markdown, tweetData, currentConfig);
          saveSucceeded++;
        } catch (obError) {
          saveFailed++;
          failedTargets.push('Obsidian');
          log('Obsidian 保存失败:', obError);
        }
      }

      // 12. 显示结果
      const totalTargets = saveSucceeded + saveFailed;
      if (totalTargets === 0 && mediaCount > 0) {
        // 仅下载模式（没有保存目标，但有媒体下载）
        showToast(_t('content.toast.mediaDownloadDone', { count: mediaCount }), 'success');
      } else if (totalTargets === 0 && mediaCount === 0 && hasDownloadTarget) {
        // 仅下载模式但没有媒体可下载
        showToast(_t('content.toast.noMediaFound'), 'info');
      } else if (saveFailed === 0) {
        const msg = mediaCount > 0
          ? _t('content.toast.saveSuccessMedia', { count: totalTargets, media: mediaCount })
          : _t('content.toast.saveSuccess', { count: totalTargets });
        showToast(msg, 'success');
      } else if (saveSucceeded > 0) {
        showToast(_t('content.toast.savePartial', { success: saveSucceeded, total: totalTargets, failed: failedTargets.join(', ') }), 'warning');
      } else {
        showToast(_t('content.toast.saveAllFailed', { failed: failedTargets.join(', ') }), 'error');
      }

      // 13. Obsidian URI 跳转（所有操作完成后再跳转）
      //     延迟 1500ms：确保 Chrome 下载管理器已接收所有下载任务
      //     且 toast 有时间显示给用户
      if (currentConfig.saveToObsidian && pendingObsidianUri) {
        setTimeout(() => {
          window.location.href = pendingObsidianUri;
          pendingObsidianUri = null;
        }, 1500);
      }

    } catch (error) {
      log('保存出错:', error);
      showToast(_t('content.toast.saveFailed', { error: error.message || 'Unknown error' }), 'error');
    } finally {
      isSaving = false;
    }
  }

  // Obsidian URI 暂存（延迟跳转，避免杀死其他并行保存）
  let pendingObsidianUri = null;

  // 保存到 Obsidian（构建 URI 并暂存，不直接跳转）
  async function saveToObsidian(markdown, tweetData, config) {
    const author = tweetData.author?.username || 'unknown';
    const titleSnippet = (tweetData.content?.text || '').substring(0, 50).replace(/\n/g, ' ');
    let fileName = sanitizeFilename(`@${author} - ${titleSnippet || tweetData.id}`);

    if (tweetData.type === 'thread') {
      fileName = sanitizeFilename(`@${author} - Thread - ${titleSnippet || tweetData.id}`);
    }

    if (!fileName || fileName.trim().length === 0) {
      throw new Error('文件名生成失败');
    }

    const vaultParam = config.vaultName ? `&vault=${encodeURIComponent(config.vaultName)}` : '';
    const filePath = config.folderPath
      ? `${config.folderPath}/${fileName}.md`
      : `${fileName}.md`;

    if (config.useAdvancedUri) {
      // Advanced URI 模式：内容写入剪贴板
      try {
        await navigator.clipboard.writeText(markdown);
      } catch (clipError) {
        throw new Error('剪贴板写入失败，请检查浏览器权限: ' + clipError.message);
      }
      pendingObsidianUri = `obsidian://advanced-uri?filepath=${encodeURIComponent(filePath)}&clipboard=true&mode=overwrite${vaultParam}`;
    } else {
      // 普通 URI 模式
      // 检查 URI 长度（浏览器通常限制 2MB，markdown 太长时回退到 Advanced URI）
      const content = encodeURIComponent(markdown);
      if (content.length > 1800000) {
        log('内容过长，自动切换到 Advanced URI 模式');
        try {
          await navigator.clipboard.writeText(markdown);
          pendingObsidianUri = `obsidian://advanced-uri?filepath=${encodeURIComponent(filePath)}&clipboard=true&mode=overwrite${vaultParam}`;
        } catch (clipError) {
          throw new Error('内容过长且剪贴板写入失败: ' + clipError.message);
        }
      } else {
        pendingObsidianUri = `obsidian://new?file=${encodeURIComponent(filePath)}&content=${content}&overwrite=true${vaultParam}`;
      }
    }

    log('已准备 Obsidian URI:', fileName);
  }

  // 保存到 Notion（通过 background.js 代理）
  async function saveToNotion(markdown, tweetData, config) {
    // 前置校验
    if (!config.notionToken || config.notionToken.trim().length < 10) {
      throw new Error('Notion Token 未配置或格式错误');
    }
    if (!config.notionDatabaseId || config.notionDatabaseId.trim().length < 10) {
      throw new Error('Notion Database ID 未配置或格式错误');
    }

    let response;
    try {
      response = await sendMessageAsync({
        action: 'saveToNotion',
        data: {
          token: config.notionToken,
          databaseId: config.notionDatabaseId,
          title: `@${tweetData.author?.username || 'unknown'}: ${(tweetData.content?.text || '').substring(0, 80)}`,
          url: tweetData.url || '',
          author: `@${tweetData.author?.username || 'unknown'}`,
          tags: tweetData.content?.entities?.hashtags || [],
          savedDate: getISODate(),
          likes: tweetData.metadata?.likes || 0,
          retweets: tweetData.metadata?.retweets || 0,
          type: tweetData.type === 'thread' ? 'Thread' : tweetData.type === 'article' ? '长文章' : '推文',
          content: markdown,
          propMapping: {
            title: config.notionPropTitle,
            url: config.notionPropUrl,
            author: config.notionPropAuthor,
            tags: config.notionPropTags,
            savedDate: config.notionPropSavedDate,
            likes: config.notionPropLikes,
            retweets: config.notionPropRetweets,
            type: config.notionPropType
          }
        }
      });
    } catch (commError) {
      throw new Error('Notion 通信失败：扩展可能需要刷新，请尝试刷新页面或重新加载扩展');
    }

    if (!response || !response.success) {
      // background.js 已提供友好的错误消息（含 HTTP 状态码分类和网络错误分类）
      throw new Error(response?.error || 'Notion 保存失败：未知错误');
    }

    log('已保存到 Notion');
  }

  // 保存到飞书（通过 background.js 代理）
  async function saveToFeishu(markdown, tweetData, config) {
    // 前置校验
    if (!config.feishuAppId || !config.feishuAppSecret) {
      throw new Error('飞书 App ID 或 App Secret 未配置');
    }
    if (!config.feishuAppToken || !config.feishuTableId) {
      throw new Error('飞书多维表格 Token 或表格 ID 未配置');
    }

    let response;
    try {
      response = await sendMessageAsync({
        action: 'saveToFeishu',
        data: {
          apiDomain: config.feishuApiDomain || 'feishu',
          appId: config.feishuAppId,
          appSecret: config.feishuAppSecret,
          appToken: config.feishuAppToken,
          tableId: config.feishuTableId,
          title: `@${tweetData.author?.username || 'unknown'}: ${(tweetData.content?.text || '').substring(0, 80)}`,
          url: tweetData.url || '',
          author: `@${tweetData.author?.username || 'unknown'}`,
          content: markdown.substring(0, 10000),
          likes: tweetData.metadata?.likes || 0,
          retweets: tweetData.metadata?.retweets || 0,
          savedTime: getBeijingTime(),
          type: tweetData.type || 'tweet',
          uploadAttachment: config.feishuUploadAttachment,
          uploadHtml: config.feishuUploadHtml,
          markdown: config.feishuUploadAttachment ? markdown : '',
          htmlContent: config.feishuUploadHtml ? generateHtmlContent(markdown, tweetData) : ''
        }
      });
    } catch (commError) {
      throw new Error('飞书通信失败：扩展可能需要刷新，请尝试刷新页面或重新加载扩展');
    }

    if (!response || !response.success) {
      // background.js 已提供友好的错误消息（含飞书错误码分类和网络错误分类）
      throw new Error(response?.error || '飞书保存失败：未知错误');
    }

    log('已保存到飞书');
  }

  // 导出为 HTML 文件
  async function exportToHtml(markdown, tweetData, config) {
    let htmlContent;
    try {
      htmlContent = generateHtmlContent(markdown, tweetData);
    } catch (genError) {
      throw new Error(`HTML 生成失败: ${genError.message}`);
    }

    if (!htmlContent || htmlContent.length < 100) {
      throw new Error('HTML 内容生成为空');
    }

    const author = tweetData.author?.username || 'unknown';
    const snippet = sanitizeFilename((tweetData.content?.text || '').substring(0, 50));
    const filename = `${config.htmlExportFolder || 'X导出'}/@${author}_${tweetData.id || 'unknown'}_${snippet}.html`;

    let response;
    try {
      response = await sendMessageAsync({
        action: 'downloadHtml',
        content: htmlContent,
        filename: filename
      });
    } catch (commError) {
      throw new Error(`HTML 下载通信失败: ${commError.message}`);
    }

    if (!response || !response.success) {
      const errMsg = response?.error || '未知错误';
      if (errMsg.includes('download')) {
        throw new Error('Chrome 下载 API 失败，请检查下载设置');
      }
      throw new Error(`HTML 导出失败: ${errMsg}`);
    }

    log('已导出 HTML');
  }

  // ============================================================
  // 第九部分：HTML 生成（完整离线页面）
  // ============================================================

  // HTML 转义工具（防 XSS）
  function escapeHtml(str) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return String(str || '').replace(/[&<>"']/g, c => map[c]);
  }

  function generateHtmlContent(markdown, tweetData) {
    // 使用 marked.js 转换 Markdown → HTML
    let bodyHtml = '';
    if (typeof marked !== 'undefined') {
      marked.setOptions({ breaks: true, gfm: true });
      // 去掉 Frontmatter
      const cleanMd = markdown.replace(/^---\n[\s\S]*?\n---\n*/, '');
      bodyHtml = marked.parse(cleanMd);
    } else {
      // 简单的 Markdown → HTML 回退
      bodyHtml = markdown
        .replace(/^---\n[\s\S]*?\n---\n*/, '')
        .replace(/^### (.*$)/gm, '<h3>$1</h3>')
        .replace(/^## (.*$)/gm, '<h2>$1</h2>')
        .replace(/^# (.*$)/gm, '<h1>$1</h1>')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/!\[(.*?)\]\((.*?)\)/g, '<img src="$2" alt="$1" loading="lazy">')
        .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2">$1</a>')
        .replace(/\n\n/g, '</p><p>')
        .replace(/\n/g, '<br>');
      bodyHtml = '<p>' + bodyHtml + '</p>';
    }

    const author = tweetData.author;
    const meta = tweetData.metadata;
    const isThread = tweetData.type === 'thread';

    return `<!DOCTYPE html>
<html lang="zh-CN" data-theme="x-dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="theme-color" content="#000000">
<meta name="description" content="@${escapeHtml(author.username)} 的推文 - 由 X Saver 保存">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='80' font-size='80'>📌</text></svg>">
<title>@${escapeHtml(author.username)} - X Saver</title>
<style>
:root { --bg: #000; --text: #e7e9ea; --text-secondary: #71767b; --accent: #1d9bf0; --border: #2f3336; --card-bg: #16181c; --hover: #1d1f23; }
[data-theme="x-light"] { --bg: #fff; --text: #0f1419; --text-secondary: #536471; --accent: #1d9bf0; --border: #eff3f4; --card-bg: #f7f9f9; --hover: #f0f0f0; }
[data-theme="x-dark"] { --bg: #000; --text: #e7e9ea; --text-secondary: #71767b; --accent: #1d9bf0; --border: #2f3336; --card-bg: #16181c; --hover: #1d1f23; }
[data-theme="x-dim"] { --bg: #15202b; --text: #f7f9f9; --text-secondary: #8b98a5; --accent: #1d9bf0; --border: #38444d; --card-bg: #1e2732; --hover: #283340; }
[data-theme="sakura"] { --bg: #fff5f5; --text: #2d2d2d; --text-secondary: #666; --accent: #e91e63; --border: #fce4ec; --card-bg: #fff0f3; --hover: #ffe0e6; }
[data-theme="ocean"] { --bg: #0a1628; --text: #c8d6e5; --text-secondary: #576574; --accent: #48dbfb; --border: #1e3a5f; --card-bg: #0d2137; --hover: #14325a; }

* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: var(--bg); color: var(--text); line-height: 1.6; max-width: 600px; margin: 0 auto; padding: 16px; }

.toolbar { position: sticky; top: 0; background: var(--bg); border-bottom: 1px solid var(--border); padding: 8px 0; margin-bottom: 16px; z-index: 100; display: flex; gap: 8px; flex-wrap: wrap; }
.toolbar button { background: var(--card-bg); color: var(--text); border: 1px solid var(--border); border-radius: 20px; padding: 4px 12px; font-size: 12px; cursor: pointer; transition: all 0.2s; }
.toolbar button:hover, .toolbar button.active { background: var(--accent); color: #fff; border-color: var(--accent); }

.author-card { display: flex; align-items: center; gap: 12px; padding: 16px; background: var(--card-bg); border-radius: 16px; border: 1px solid var(--border); margin-bottom: 16px; }
.author-card img { width: 48px; height: 48px; border-radius: 50%; }
.author-card .info { flex: 1; }
.author-card .name { font-weight: 700; font-size: 15px; }
.author-card .username { color: var(--text-secondary); font-size: 14px; }
.author-card .badge { display: inline-block; background: var(--accent); color: #fff; font-size: 11px; padding: 1px 6px; border-radius: 4px; margin-left: 4px; }

.meta-card { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; padding: 12px; background: var(--card-bg); border-radius: 12px; border: 1px solid var(--border); margin-bottom: 16px; text-align: center; }
.meta-card .stat { display: flex; flex-direction: column; }
.meta-card .stat-value { font-weight: 700; font-size: 16px; color: var(--accent); }
.meta-card .stat-label { font-size: 12px; color: var(--text-secondary); }

.content { padding: 16px 0; font-size: 15px; word-break: break-word; }
.content img { max-width: 100%; border-radius: 12px; margin: 8px 0; cursor: pointer; transition: transform 0.3s; }
.content img:hover { transform: scale(1.02); }
.content h1, .content h2, .content h3 { margin-top: 24px; margin-bottom: 8px; }
.content a { color: var(--accent); text-decoration: none; }
.content a:hover { text-decoration: underline; }
.content blockquote { border-left: 3px solid var(--accent); padding: 8px 16px; margin: 12px 0; background: var(--card-bg); border-radius: 0 8px 8px 0; color: var(--text-secondary); }
.content code { background: var(--card-bg); padding: 2px 6px; border-radius: 4px; font-size: 13px; }
.content pre { background: var(--card-bg); padding: 16px; border-radius: 8px; overflow-x: auto; margin: 12px 0; position: relative; }
.content pre code { background: none; padding: 0; }
.content table { width: 100%; border-collapse: collapse; margin: 12px 0; }
.content th, .content td { border: 1px solid var(--border); padding: 8px 12px; text-align: left; }
.content th { background: var(--card-bg); font-weight: 600; }

.copyable-wrapper { position: relative; }
.copy-btn { position: absolute; top: 6px; right: 6px; background: var(--border); color: var(--text-secondary); border: none; border-radius: 6px; padding: 3px 10px; font-size: 11px; cursor: pointer; opacity: 0; transition: opacity 0.2s, background 0.2s; z-index: 10; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
.copyable-wrapper:hover .copy-btn, .content pre:hover > .copy-btn { opacity: 1; }
.copy-btn:hover { background: var(--accent); color: #fff; }
.copy-btn.copied { background: #00ba7c; color: #fff; opacity: 1; }
.content details { background: var(--card-bg); border-radius: 8px; padding: 12px; margin: 8px 0; border: 1px solid var(--border); }
.content details summary { cursor: pointer; font-weight: 600; }
.content video, .content iframe { max-width: 100%; border-radius: 12px; margin: 8px 0; }

.thread-indicator { display: inline-block; background: var(--accent); color: #fff; font-size: 12px; padding: 2px 8px; border-radius: 12px; margin-bottom: 8px; }

.footer { padding: 16px 0; border-top: 1px solid var(--border); margin-top: 24px; text-align: center; color: var(--text-secondary); font-size: 12px; }
.footer a { color: var(--accent); }

/* Lightbox */
.lightbox { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.9); z-index: 1000; justify-content: center; align-items: center; cursor: zoom-out; }
.lightbox.show { display: flex; }
.lightbox img { max-width: 95%; max-height: 95%; object-fit: contain; }

/* Toast 弹窗通知 */
.html-toast { position: fixed; top: 20px; left: 50%; transform: translateX(-50%) translateY(-20px); padding: 10px 24px; border-radius: 8px; color: #fff; font-size: 14px; z-index: 9999; opacity: 0; transition: opacity 0.3s, transform 0.3s; pointer-events: none; box-shadow: 0 4px 16px rgba(0,0,0,0.3); font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
.html-toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
.html-toast.success { background: #00ba7c; }
.html-toast.error { background: #f4212e; }
.html-toast.info { background: #1d9bf0; }
.html-toast.warning { background: #ffd400; color: #000; }

@media print { .toolbar, .html-toast { display: none; } body { max-width: 100%; } }
</style>
</head>
<body>

<div class="toolbar">
  <button data-theme="x-dark" class="active">暗黑</button>
  <button data-theme="x-light">明亮</button>
  <button data-theme="x-dim">夜间</button>
  <button data-theme="sakura">樱花</button>
  <button data-theme="ocean">海洋</button>
  <button onclick="window.print()">PDF</button>
  <button id="btn-copy-text">复制文本</button>
  <button id="btn-open-original" onclick="window.open('${escapeHtml(tweetData.url)}','_blank')">原文</button>
</div>

<div class="author-card">
  ${author.avatar ? `<img src="${escapeHtml(author.avatar)}" alt="@${escapeHtml(author.username)}">` : ''}
  <div class="info">
    <div class="name">${escapeHtml(author.displayName)}${author.verified ? '<span class="badge">✓</span>' : ''}</div>
    <div class="username">@${escapeHtml(author.username)}</div>
  </div>
  ${isThread ? '<span class="thread-indicator">🧵 Thread</span>' : ''}
</div>

<div class="meta-card">
  <div class="stat"><span class="stat-value">${formatNumber(meta.likes)}</span><span class="stat-label">点赞</span></div>
  <div class="stat"><span class="stat-value">${formatNumber(meta.retweets)}</span><span class="stat-label">转发</span></div>
  <div class="stat"><span class="stat-value">${formatNumber(meta.replies)}</span><span class="stat-label">回复</span></div>
  <div class="stat"><span class="stat-value">${formatNumber(meta.views)}</span><span class="stat-label">浏览</span></div>
</div>

<div class="content">
${bodyHtml}
</div>

<div class="footer">
  <p>原文: <a href="${escapeHtml(tweetData.url)}">${escapeHtml(tweetData.url)}</a></p>
  <p>发布: ${escapeHtml(meta.createdAt)} | 保存: ${escapeHtml(getBeijingTime())}</p>
  <p>由 X Saver 导出</p>
</div>

<div class="lightbox" id="lightbox"><img id="lightbox-img" src="" alt=""></div>

<script>
// 主题切换
document.querySelectorAll('.toolbar button[data-theme]').forEach(btn => {
  btn.addEventListener('click', function() {
    document.documentElement.setAttribute('data-theme', this.dataset.theme);
    document.querySelectorAll('.toolbar button[data-theme]').forEach(b => b.classList.remove('active'));
    this.classList.add('active');
    localStorage.setItem('x-saver-theme', this.dataset.theme);
  });
});
const saved = localStorage.getItem('x-saver-theme');
if (saved) {
  document.documentElement.setAttribute('data-theme', saved);
  document.querySelectorAll('.toolbar button[data-theme]').forEach(b => {
    b.classList.toggle('active', b.dataset.theme === saved);
  });
}

// 图片 Lightbox
const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightbox-img');
document.querySelectorAll('.content img').forEach(img => {
  img.style.cursor = 'zoom-in';
  img.addEventListener('click', function() {
    lightboxImg.src = this.src;
    lightbox.classList.add('show');
  });
});
lightbox.addEventListener('click', function() {
  this.classList.remove('show');
});

// Toast 弹窗通知系统
function showHtmlToast(msg, type) {
  type = type || 'success';
  var old = document.querySelector('.html-toast');
  if (old) old.remove();
  var t = document.createElement('div');
  t.className = 'html-toast ' + type;
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(function() { t.classList.add('show'); });
  setTimeout(function() {
    t.classList.remove('show');
    setTimeout(function() { t.remove(); }, 300);
  }, type === 'error' ? 4000 : 2000);
}

// 通用复制函数
function copyToClipboard(text, successMsg) {
  successMsg = successMsg || '已复制到剪贴板';
  navigator.clipboard.writeText(text).then(function() {
    showHtmlToast(successMsg, 'success');
  }).catch(function() {
    var ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); showHtmlToast(successMsg, 'success'); }
    catch(e) { showHtmlToast('复制失败，请手动选中复制', 'error'); }
    document.body.removeChild(ta);
  });
}

// 复制全文
document.getElementById('btn-copy-text').addEventListener('click', function() {
  var content = document.querySelector('.content').innerText;
  copyToClipboard(content, '全文已复制到剪贴板');
});

// 代码块复制按钮
document.querySelectorAll('.content pre').forEach(function(pre) {
  var btn = document.createElement('button');
  btn.className = 'copy-btn';
  btn.textContent = '复制';
  btn.addEventListener('click', function(e) {
    e.stopPropagation();
    var code = pre.querySelector('code') || pre;
    copyToClipboard(code.innerText || code.textContent, '代码已复制');
  });
  pre.appendChild(btn);
});

// 表格复制按钮
document.querySelectorAll('.content table').forEach(function(table) {
  var wrapper = document.createElement('div');
  wrapper.className = 'copyable-wrapper';
  table.parentNode.insertBefore(wrapper, table);
  wrapper.appendChild(table);
  var btn = document.createElement('button');
  btn.className = 'copy-btn';
  btn.textContent = '复制表格';
  btn.addEventListener('click', function(e) {
    e.stopPropagation();
    var rows = table.querySelectorAll('tr');
    var tsv = Array.from(rows).map(function(row) {
      return Array.from(row.querySelectorAll('th, td')).map(function(cell) { return cell.innerText.trim(); }).join('\\t');
    }).join('\\n');
    copyToClipboard(tsv, '表格已复制（可直接粘贴到Excel）');
  });
  wrapper.appendChild(btn);
});

// 离线检测
if (!navigator.onLine) {
  showHtmlToast('当前离线 - 外部图片/视频可能无法加载', 'warning');
}
window.addEventListener('online', function() {
  showHtmlToast('网络已恢复，正在刷新...', 'info');
  setTimeout(function() { location.reload(); }, 1000);
});
window.addEventListener('offline', function() {
  showHtmlToast('网络已断开', 'warning');
});
</script>
</body>
</html>`;
  }

  // ============================================================
  // 第十部分：UI 组件
  // ============================================================

  // Toast 通知
  function showToast(message, type = 'info') {
    // 移除旧 toast
    document.querySelectorAll('.x-saver-toast').forEach(t => t.remove());

    const colors = {
      success: '#00ba7c',
      error: '#f4212e',
      warning: '#ffd400',
      info: '#1d9bf0'
    };

    const toast = document.createElement('div');
    toast.className = 'x-saver-toast';
    toast.style.cssText = `
      position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
      background: ${colors[type] || colors.info}; color: #fff;
      padding: 10px 20px; border-radius: 8px; font-size: 14px;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      z-index: 99999; box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      animation: xSaverFadeIn 0.3s ease;
      max-width: 90vw; text-align: center;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);

    // 添加动画样式
    if (!document.getElementById('x-saver-toast-style')) {
      const style = document.createElement('style');
      style.id = 'x-saver-toast-style';
      style.textContent = `
        @keyframes xSaverFadeIn { from { opacity: 0; transform: translateX(-50%) translateY(-20px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }
        @keyframes xSaverFadeOut { from { opacity: 1; } to { opacity: 0; transform: translateX(-50%) translateY(-20px); } }
      `;
      document.head.appendChild(style);
    }

    // 自动消失
    setTimeout(() => {
      toast.style.animation = 'xSaverFadeOut 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, type === 'error' ? 5000 : 3000);
  }

  // ============================================================
  // 第十一部分：书签按钮劫持
  // ============================================================

  // 双击检测状态
  let lastClickTime = 0;
  let lastClickTarget = null;
  const DOUBLE_CLICK_THRESHOLD = 300; // ms

  // 判断是否为书签按钮
  function isBookmarkButton(element) {
    if (!element) return false;

    // 向上查找按钮元素
    const button = element.closest('button') || element;
    if (button.tagName !== 'BUTTON') return false;

    // 检查 data-testid
    const testId = button.getAttribute('data-testid') || '';
    if (testId === 'bookmark' || testId === 'removeBookmark') return true;

    // 检查 aria-label
    const label = (button.getAttribute('aria-label') || '').toLowerCase();
    if (label.includes('bookmark') || label.includes('书签') || label.includes('收藏')) return true;

    // 检查是否在推文操作区域内
    const actionGroup = button.closest('[role="group"]');
    if (!actionGroup) return false;

    // 检查按钮内的 SVG 图标路径（书签图标特征）
    const svg = button.querySelector('svg');
    if (svg) {
      const pathD = svg.querySelector('path')?.getAttribute('d') || '';
      // X 书签图标的 path 特征
      if (pathD.includes('M4') && pathD.includes('l8') && pathD.includes('V3')) return true;
      // 备用检测：图标容器有 bookmark 相关特征
      const svgParent = svg.closest('div');
      if (svgParent && svgParent.querySelector('[data-testid*="bookmark"]')) return true;
    }

    return false;
  }

  // 触发原生书签功能
  function triggerOriginalBookmark(button) {
    // 创建并分发原生点击事件
    const nativeEvent = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      view: window
    });
    // 标记为原生事件，避免再次拦截
    nativeEvent.__xSaverNative = true;
    button.dispatchEvent(nativeEvent);
  }

  // 全局点击事件监听器
  function setupBookmarkHijack() {
    document.addEventListener('click', function (event) {
      // 跳过我们自己派发的原生事件
      if (event.__xSaverNative) return;

      // 检查是否点击了书签按钮
      const target = event.target;
      const bookmarkBtn = target.closest('button');

      if (!isBookmarkButton(target) && !isBookmarkButton(bookmarkBtn)) return;

      const button = isBookmarkButton(target) ? target.closest('button') || target : bookmarkBtn;

      // 阻止默认行为
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      const now = Date.now();

      // 双击检测
      if (lastClickTarget === button && (now - lastClickTime) < DOUBLE_CLICK_THRESHOLD) {
        // 双击 → 原生书签功能
        log('双击检测：触发原生书签');
        lastClickTime = 0;
        lastClickTarget = null;
        triggerOriginalBookmark(button);
        return;
      }

      // 记录本次点击
      lastClickTime = now;
      lastClickTarget = button;

      // 延迟执行，等待可能的双击
      setTimeout(() => {
        if (lastClickTarget === button && lastClickTime === now) {
          // 单击确认 → 保存
          log('单击确认：执行保存');
          lastClickTarget = null;
          handleSave(button);
        }
      }, DOUBLE_CLICK_THRESHOLD);
    }, true); // 使用捕获阶段，确保在 X 原生处理器之前
  }

  // 快捷键支持（使用 event.code 而非 event.key，确保非英语键盘布局也能触发）
  function setupKeyboardShortcut() {
    document.addEventListener('keydown', function (event) {
      // Ctrl+Shift+S (Windows/Linux/Mac)
      // 注意：Mac 上用 Ctrl（非 Cmd），避免与系统 Cmd+Shift+S 冲突
      if (event.ctrlKey && event.shiftKey && event.code === 'KeyS') {
        event.preventDefault();
        event.stopPropagation();

        // 查找当前页面的主推文
        const article = document.querySelector('article[data-testid="tweet"]');
        if (article) {
          handleSave(null);
        } else {
          showToast(_t('content.toast.noTweetOnPage'), 'warning');
        }
      }
    });

    // 同时监听 chrome.commands API 消息（从 background.js 转发）
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request && request.action === 'triggerSave') {
        const article = document.querySelector('article[data-testid="tweet"]');
        if (article) {
          handleSave(null);
          sendResponse({ success: true });
        } else {
          showToast(_t('content.toast.noTweetOnPage'), 'warning');
          sendResponse({ success: false, error: 'No tweet found' });
        }
        return true;
      }
    });
  }

  // ============================================================
  // 第十二部分：初始化
  // ============================================================

  async function init() {
    console.info('[X Saver] Content Script V1.1.0 初始化...',
      'videoCache:', !!window.__xSaverVideoCache,
      'i18n:', typeof initI18n);

    // 初始化 i18n（加载用户语言偏好）
    if (typeof initI18n === 'function') {
      try {
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('initI18n 超时')), 5000);
          initI18n((lang) => {
            clearTimeout(timeout);
            resolve(lang);
          });
        });
      } catch (e) {
        console.warn('[X Saver] i18n 初始化失败，使用默认语言:', e.message);
      }
    }

    // 加载配置
    currentConfig = await new Promise(resolve => {
      chrome.storage.sync.get(DEFAULT_CONFIG, resolve);
    });

    if (!currentConfig.pluginEnabled) {
      log('插件已禁用');
      return;
    }

    // 视频 URL 拦截已由 detector.js 在主世界中完成，无需额外设置

    // 设置书签按钮劫持
    setupBookmarkHijack();

    // 设置快捷键
    setupKeyboardShortcut();

    log('X Saver 初始化完成');
  }

  // 监听页面变化事件（来自 detector.js）
  window.addEventListener('x-saver-page-change', function (event) {
    log('页面变化:', event.detail);
    // 页面变化时不需要重新初始化，事件监听器已经是全局的
  });

  // 启动
  init();

})();
