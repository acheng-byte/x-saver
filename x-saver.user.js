// ==UserScript==
// @name         X Saver · 推文保存工具
// @namespace    https://github.com/acheng-byte
// @version      0.0.5
// @description  X平台一键保存推文到Obsidian+飞书 · 总开关/投票/引用/长文/标签多选/评论/视频URL
// @author       阿成
// @homepageURL  https://github.com/acheng-byte
// @icon         https://www.google.com/s2/favicons?sz=64&domain=x.com
// @match        https://x.com/*
// @match        https://twitter.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @connect      open.feishu.cn
// @connect      open.larksuite.com
// @connect      *
// @run-at       document-end
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';

  // ============================================================
  // 总开关
  // ============================================================
  const ENABLED_KEY = 'xs_master_enabled';
  function isEnabled()    { return GM_getValue(ENABLED_KEY, true); }
  function setEnabled(v)  { GM_setValue(ENABLED_KEY, v); }

  // ============================================================
  // 模块0: 日志 & 历史 (LogModule)
  // ============================================================
  const LogModule = (function () {
    const LOG_KEY = 'xs_log', HIST_KEY = 'xs_history';

    function _bjTime() {
      const now = new Date();
      const bj  = new Date(now.getTime() + (now.getTimezoneOffset() + 480) * 60000);
      return bj.toISOString().replace('T', ' ').substring(0, 19);
    }
    function _getArr(key, max) {
      try { return JSON.parse(GM_getValue(key, '[]')); } catch { return []; }
    }
    function _setArr(key, arr, max) {
      if (arr.length > max) arr.length = max;
      GM_setValue(key, JSON.stringify(arr));
    }

    function log(level, msg, detail = '') {
      const arr = _getArr(LOG_KEY);
      arr.unshift({ time: _bjTime(), level, msg, detail: String(detail).substring(0, 300) });
      _setArr(LOG_KEY, arr, 500);
      (level === 'error' ? console.error : console.log)(`[X Saver] ${msg}`, detail);
    }

    function addHistory(data) {
      const arr = _getArr(HIST_KEY);
      arr.unshift({
        time:     _bjTime(),
        url:      data.tweetUrl || '',
        author:   `@${data.handle || ''}`,
        name:     data.displayName || '',
        text:     (data.text || '').substring(0, 80).replace(/\n/g, ' '),
        hasImg:   (data.images || []).length > 0,
        hasVid:   !!data.hasVideo,
        fileName: data.fileName || '',
      });
      _setArr(HIST_KEY, arr, 500);
    }

    function removeHistoryAt(idx) {
      const arr = _getArr(HIST_KEY);
      arr.splice(idx, 1);
      GM_setValue(HIST_KEY, JSON.stringify(arr));
    }

    function getLogs()    { return _getArr(LOG_KEY); }
    function getHistory() { return _getArr(HIST_KEY); }
    function clearLogs()    { GM_setValue(LOG_KEY, '[]'); }
    function clearHistory() { GM_setValue(HIST_KEY, '[]'); }

    return { log, addHistory, removeHistoryAt, getLogs, getHistory, clearLogs, clearHistory };
  })();

  // ============================================================
  // 模块1: 配置管理 (ConfigModule)
  // ============================================================
  const ConfigModule = (function () {
    const D = {
      // 保存目标
      saveToObsidian: true,
      saveToFeishu:   false,

      // Obsidian
      vaultName:      '',
      folderPath:     'X收集箱',
      useAdvancedUri: true,

      // 飞书
      feishuApiDomain: 'feishu',
      feishuAppId:     'cli_a90e366e9c39dcd4',
      feishuAppSecret: 'UG5SBUn3M0TLlRvjoSGtcfCIot6Do2AT',
      feishuAppToken:  'GevWbDWu0aQTIYsm8e8cT2khnId',
      feishuTableId:   'tbl7Xw9AaxCpqJmZ',
      // 飞书字段名映射
      feishuFieldContent:   '内容',
      feishuFieldUrl:       '链接',
      feishuFieldAuthor:    '作者',
      feishuFieldHandle:    '账号',
      feishuFieldTime:      '发布时间',
      feishuFieldSavedDate: '保存日期',
      feishuFieldImages:    '图片URL',
      feishuFieldVideo:     '视频URL',
      feishuFieldTags:      '标签',
      feishuFieldComments:  '评论',

      // 媒体
      imageMode:         'link',   // link | download
      videoMode:         'iframe', // iframe | link
      serverEndpoint:    'https://media.acheng.eu.cc/download',
      serverToken:       '36fce70c0e32402564b7aa404ac09f6b867305ac859a4334bf1696fc238944d1',
      serverMediaFolder: 'X媒体',

      // 评论
      saveComments:  false,
      commentCount:  100,

      // 元数据字段开关
      meta_author:    true,
      meta_handle:    true,
      meta_url:       true,
      meta_tweet_id:  true,
      meta_time:      true,
      meta_saved:     true,
      meta_likes:     true,
      meta_retweets:  true,
      meta_replies:   true,
      meta_views:     false,
      meta_bookmarks: false,
      meta_hashtags:  true,
      meta_mentions:  false,
      meta_cashtags:  false,
      meta_has_video: true,
      meta_has_poll:  true,
      meta_is_reply:  true,
      meta_is_quote:  true,
      meta_type:      false,
    };

    function get(key) {
      if (key) return GM_getValue(key, D[key]);
      const c = {};
      for (const k in D) c[k] = GM_getValue(k, D[k]);
      return c;
    }
    function set(key, val)  { GM_setValue(key, val); }
    function setAll(cfg)    { for (const k in cfg) GM_setValue(k, cfg[k]); }
    function getDefault()   { return { ...D }; }
    function exportJson()   { return JSON.stringify(get(), null, 2); }
    function importJson(s)  {
      const p = JSON.parse(s);
      if (typeof p !== 'object') throw new Error('格式不正确');
      const v = {};
      for (const k in D) if (k in p) v[k] = p[k];
      setAll(v);
      return Object.keys(v).length;
    }
    function reset() { setAll(D); }

    return { get, set, setAll, getDefault, exportJson, importJson, reset };
  })();

  // ============================================================
  // 模块2: 工具函数 (UtilModule)
  // ============================================================
  const UtilModule = (function () {
    function getBeijingTime() {
      const now = new Date();
      const bj  = new Date(now.getTime() + (now.getTimezoneOffset() + 480) * 60000);
      return bj.toISOString().replace('T', ' ').substring(0, 19);
    }
    function sanitizeFileName(name) {
      return name
        // Obsidian / 文件系统禁用字符 → 下划线
        .replace(/[<>:"/\\|?*\[\]#%&\x00-\x1f\x7f]/g, '_')
        // 表情符号（Emoji）及其他非 BMP 字符 → 下划线
        .replace(/[\u{1F000}-\u{1FFFF}]/gu, '_')
        .replace(/[\u{2600}-\u{27BF}]/gu, '_')
        // 合并连续下划线
        .replace(/_+/g, '_')
        // 规范化空白
        .replace(/\s+/g, ' ')
        // 去掉首尾下划线和空格
        .replace(/^[_\s]+|[_\s]+$/g, '')
        .substring(0, 80)
        .trim();
    }
    function extractTweetId(url) {
      const m = url.match(/\/status\/(\d+)/);
      return m ? m[1] : '';
    }
    function formatDate(iso) {
      if (!iso) return '';
      const d  = new Date(iso);
      const bj = new Date(d.getTime() + (d.getTimezoneOffset() + 480) * 60000);
      return bj.toISOString().replace('T', ' ').substring(0, 16);
    }

    let _t = null;
    function showNotification(msg, type = 'info') {
      document.querySelector('.xs-notif')?.remove();
      if (_t) clearTimeout(_t);
      const c = { success:'#10b981', error:'#ef4444', info:'#3b82f6', warning:'#f59e0b' };
      const d = document.createElement('div');
      d.className = 'xs-notif';
      d.style.cssText = `position:fixed;top:60px;left:50%;transform:translateX(-50%);
        padding:10px 18px;background:${c[type]||c.info};color:#fff;border-radius:20px;
        font-size:13px;font-weight:500;z-index:999999;
        box-shadow:0 4px 20px rgba(0,0,0,.3);white-space:nowrap;pointer-events:none;
        animation:xsSlide .2s ease;`;
      d.textContent = msg;
      document.body.appendChild(d);
      _t = setTimeout(() => d.parentNode && d.remove(), 3000);
    }

    return { getBeijingTime, sanitizeFileName, extractTweetId, formatDate, showNotification };
  })();

  // ============================================================
  // 模块3: 内容提取 (ExtractModule)
  // ============================================================
  const ExtractModule = (function () {

    function extractTokens(text) {
      return {
        hashtags: [...new Set((text.match(/#[\w\u4e00-\u9fa5]+/g)||[]).map(t=>t.slice(1)))],
        mentions: [...new Set((text.match(/@\w+/g)||[]).map(t=>t.slice(1)))],
        cashtags: [...new Set((text.match(/\$[A-Z]{1,6}/g)||[]).map(t=>t.slice(1)))],
      };
    }

    function extractPoll(el) {
      const poll = el.querySelector('[data-testid="poll"]');
      if (!poll) return null;
      const options = [];
      poll.querySelectorAll('[role="progressbar"]').forEach(bar => {
        const label = bar.getAttribute('aria-label') || '';
        const m = label.match(/^(.+?)\s+([\d.]+%)/);
        if (m) {
          options.push({ label: m[1].trim(), pct: m[2] });
        } else {
          const spans = bar.querySelectorAll('span');
          if (spans.length >= 2) options.push({ label: spans[0].textContent.trim(), pct: spans[spans.length-1].textContent.trim() });
        }
      });
      const footer = poll.querySelector('span:last-child');
      return options.length ? { options, totalText: footer?.textContent.trim() || '' } : null;
    }

    function extractQuote(el) {
      const q = el.querySelector('[data-testid="quoteTweet"]');
      if (!q) return null;
      const textEl = q.querySelector('[data-testid="tweetText"]');
      const timeLink = q.querySelector('a[href*="/status/"]');
      const userEl = q.querySelector('[data-testid="User-Name"]');
      let handle = '', url = '', text = '';
      if (userEl) {
        for (const a of userEl.querySelectorAll('a[href^="/"]')) {
          const c = (a.getAttribute('href')||'').replace(/^\//,'').split('/')[0];
          if (c && c !== 'i') { handle = c; break; }
        }
      }
      if (timeLink) {
        const href = timeLink.getAttribute('href')||'';
        url = href.startsWith('http') ? href : 'https://x.com' + href;
      }
      if (textEl) text = textEl.innerText.trim();
      return { handle, url, text };
    }

    function extractArticle(el) {
      const readMore = el.querySelector('a[href*="/i/article/"], a[href*="/notes/"]');
      const body = el.querySelector('[data-testid="articleContent"], [data-testid="article"]');
      if (!readMore && !body) return null;
      return {
        url:  readMore?.href || '',
        text: body?.innerText.trim() || '',
      };
    }

    // 尝试提取视频实际 URL（能取到就取，取不到用推文 URL 代替）
    function extractVideoUrls(el, tweetUrl) {
      const urls = [];
      el.querySelectorAll('video[src], video source[src]').forEach(v => {
        const src = v.src || v.getAttribute('src');
        if (src && src.startsWith('http') && !urls.includes(src)) urls.push(src);
      });
      // HLS blob: 无法直接取，用推文 URL 作为引用
      if (urls.length === 0 && tweetUrl) urls.push(tweetUrl);
      return urls;
    }

    // 提取评论（当前页面可见的回复）
    function extractComments(maxCount = 100) {
      const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
      // 单推文页：第一篇是主推，其余是回复
      const replyArticles = articles.slice(1, maxCount + 1);
      if (replyArticles.length === 0) return [];

      return replyArticles.map((el, idx) => {
        const textEl = el.querySelector('[data-testid="tweetText"]');
        const text = textEl ? textEl.innerText.trim() : '';
        let handle = '';
        const userEl = el.querySelector('[data-testid="User-Name"]');
        if (userEl) {
          for (const a of userEl.querySelectorAll('a[href^="/"]')) {
            const c = (a.getAttribute('href')||'').replace(/^\//,'').split('/')[0];
            if (c && c !== 'i') { handle = c; break; }
          }
        }
        const timeEl = el.querySelector('time[datetime]');
        const time = timeEl ? timeEl.getAttribute('datetime') : '';
        const likeEl = el.querySelector('[data-testid="like"] span[data-testid="app-text-transition-container"]');
        const likes = likeEl ? likeEl.textContent.trim() : '';
        const imgCount = el.querySelectorAll('[data-testid="tweetPhoto"] img').length;

        return { idx: idx + 2, handle, text, time, likes, imgCount };
      }).filter(c => c.text || c.imgCount > 0);
    }

    // 主提取函数
    function extractTweet(articleEl) {
      const textEl = articleEl.querySelector('[data-testid="tweetText"]');
      const text   = textEl ? textEl.innerText.trim() : '';

      let displayName = '', handle = '';
      const userEl = articleEl.querySelector('[data-testid="User-Name"]');
      if (userEl) {
        const spans = userEl.querySelectorAll('span[dir="ltr"]');
        if (spans.length > 0) displayName = spans[0].textContent.trim();
        for (const a of userEl.querySelectorAll('a[href^="/"]')) {
          const c = (a.getAttribute('href')||'').replace(/^\//,'').split('/')[0];
          if (c && !c.includes('?') && c !== 'i' && c !== 'settings') { handle = c; break; }
        }
        if (!handle) {
          userEl.querySelectorAll('span').forEach(s => {
            if (!handle && s.textContent.trim().startsWith('@')) handle = s.textContent.trim().slice(1);
          });
        }
      }

      let tweetUrl = '';
      const tl = articleEl.querySelector('a[href*="/status/"]');
      if (tl) {
        const href = tl.getAttribute('href');
        tweetUrl = href.startsWith('http') ? href : 'https://x.com' + href;
      } else if (window.location.pathname.includes('/status/')) {
        tweetUrl = window.location.origin + window.location.pathname;
      }
      const tweetId = UtilModule.extractTweetId(tweetUrl);

      let tweetTime = '';
      const timeEl = articleEl.querySelector('time[datetime]');
      if (timeEl) tweetTime = timeEl.getAttribute('datetime') || '';

      // 图片
      const images = [];
      articleEl.querySelectorAll('[data-testid="tweetPhoto"] img, [data-testid="tweet-image"] img').forEach(img => {
        let src = img.src || '';
        src = src.replace(/[?&]name=\w+/g, '').replace(/[?&]format=\w+/g, '');
        if (src.includes('pbs.twimg.com')) src += (src.includes('?') ? '&' : '?') + 'name=large';
        if (src && !src.startsWith('data:') && !images.includes(src)) images.push(src);
      });

      const hasVideo = !!articleEl.querySelector(
        '[data-testid="videoPlayer"], video, [data-testid="videoComponent"], [data-testid="playButton"]'
      );
      const videoUrls = hasVideo ? extractVideoUrls(articleEl, tweetUrl) : [];

      function cnt(id) {
        const e = articleEl.querySelector(`[data-testid="${id}"] span[data-testid="app-text-transition-container"]`);
        return e ? e.textContent.trim() : '';
      }
      const likes = cnt('like'), retweets = cnt('retweet'), replies = cnt('reply');
      let views = '', bookmarks = '';
      const vEl = articleEl.querySelector('[aria-label*="views"], [aria-label*="Views"]');
      if (vEl) views = vEl.textContent.trim();
      const bEl = articleEl.querySelector('[data-testid="bookmark"] span[data-testid="app-text-transition-container"]');
      if (bEl) bookmarks = bEl.textContent.trim();

      const tokens  = extractTokens(text);
      const poll    = extractPoll(articleEl);
      const quote   = extractQuote(articleEl);
      const article = extractArticle(articleEl);
      const isReply = !!articleEl.closest('[aria-label*="Reply"]')
                   || articleEl.getAttribute('data-is-reply') === 'true';

      if (!text && images.length === 0 && !hasVideo && !article && !poll && !quote) return null;

      return {
        text, displayName, handle, tweetUrl, tweetId, tweetTime,
        images, hasVideo, videoUrls, likes, retweets, replies, views, bookmarks,
        hashtags: tokens.hashtags, mentions: tokens.mentions, cashtags: tokens.cashtags,
        poll, quote, article, isReply,
      };
    }

    return { extractTweet, extractComments };
  })();

  // ============================================================
  // 模块4: Markdown 转换 (ConvertModule)
  // ============================================================
  const ConvertModule = (function () {

    function tweetIframe(tweetId) {
      const src = `https://platform.twitter.com/embed/Tweet.html?id=${tweetId}&dnt=true`;
      return `\n<iframe src="${src}" style="border:none;width:100%;aspect-ratio:16/9;border-radius:12px;" allowfullscreen loading="lazy"></iframe>\n`;
    }

    // 投票 → Markdown 表格
    function pollMd(poll) {
      if (!poll?.options.length) return '';
      let md = '\n**📊 投票**\n\n| 选项 | 比例 |\n|---|---|\n';
      poll.options.forEach(o => { md += `| ${o.label} | ${o.pct} |\n`; });
      if (poll.totalText) md += `\n> ${poll.totalText}\n`;
      return md + '\n';
    }

    // 引用推文 → 块引用
    function quoteMd(quote) {
      if (!quote) return '';
      let md = `\n> **[@${quote.handle}](https://x.com/${quote.handle})**\n`;
      if (quote.text) quote.text.replace(/(https?:\/\/[^\s)>\]]+)/g, '[$1]($1)').split('\n').forEach(l => { md += `> ${l}\n`; });
      if (quote.url) md += `>\n> [查看原推](${quote.url})\n`;
      return md + '\n';
    }

    // Twitter Article
    function articleMd(article) {
      if (!article) return '';
      let md = '\n> 📄 **Twitter Article**\n';
      if (article.url) md += `> [阅读全文](${article.url})\n`;
      if (article.text) md += '\n' + article.text + '\n';
      return md + '\n';
    }

    // 评论 → Markdown
    function commentsMd(comments) {
      if (!comments?.length) return '';
      let md = `\n---\n\n## 💬 评论（共 ${comments.length} 条）\n\n`;
      comments.forEach(c => {
        md += `---\n\n**@${c.handle}**`;
        if (c.time) md += ` · ${UtilModule.formatDate(c.time)}`;
        if (c.likes) md += ` · ❤️ ${c.likes}`;
        md += '\n\n';
        if (c.text) md += c.text + '\n\n';
        if (c.imgCount > 0) md += `_(含 ${c.imgCount} 张图片)_\n\n`;
      });
      return md;
    }

    // YAML frontmatter
    function frontmatter(data, cfg) {
      // 转义 YAML 双引号字符串中的特殊字符
      const ys = s => `"${String(s || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

      const lines = ['---'];
      const m = cfg;
      if (m.meta_author   && (data.displayName||data.handle)) lines.push(`作者: ${ys(`${data.displayName} (@${data.handle})`)}`);
      if (m.meta_handle   && data.handle)      lines.push(`账号: ${ys('@' + data.handle)}`);
      if (m.meta_url      && data.tweetUrl)    lines.push(`链接: ${ys(data.tweetUrl)}`);
      if (m.meta_tweet_id && data.tweetId)     lines.push(`推文ID: ${ys(data.tweetId)}`);
      if (m.meta_time     && data.tweetTime)   lines.push(`发布时间: ${ys(UtilModule.formatDate(data.tweetTime))}`);
      if (m.meta_saved)                         lines.push(`保存时间: ${ys(UtilModule.getBeijingTime())}`);
      if (m.meta_likes    && data.likes)       lines.push(`点赞: "${data.likes}"`);
      if (m.meta_retweets && data.retweets)    lines.push(`转发: "${data.retweets}"`);
      if (m.meta_replies  && data.replies)     lines.push(`回复: "${data.replies}"`);
      if (m.meta_views    && data.views)       lines.push(`浏览: "${data.views}"`);
      if (m.meta_bookmarks&& data.bookmarks)   lines.push(`收藏: "${data.bookmarks}"`);
      if (m.meta_hashtags && data.hashtags.length) lines.push(`tags: [${data.hashtags.map(t=>ys(t)).join(', ')}]`);
      if (m.meta_mentions && data.mentions.length) lines.push(`提及: [${data.mentions.map(t=>ys(t)).join(', ')}]`);
      if (m.meta_cashtags && data.cashtags.length) lines.push(`股票代码: [${data.cashtags.map(t=>ys(t)).join(', ')}]`);
      if (m.meta_has_video&& data.hasVideo)    lines.push(`含视频: true`);
      if (m.meta_has_poll && data.poll)        lines.push(`含投票: true`);
      if (m.meta_is_reply && data.isReply)     lines.push(`是回复: true`);
      if (m.meta_is_quote && data.quote)       lines.push(`是引用: true`);
      if (m.meta_type) {
        const t = data.quote ? '引用' : data.isReply ? '回复' : '推文';
        lines.push(`类型: "${t}"`);
      }
      lines.push('---\n');
      return lines.join('\n');
    }

    function toMarkdown(data, cfg, localImagePaths, comments) {
      let md = frontmatter(data, cfg);

      if (data.text) md += data.text.replace(/(https?:\/\/[^\s)>\]]+)/g, '[$1]($1)') + '\n\n';
      if (data.article) md += articleMd(data.article);

      // 视频
      if (data.hasVideo) {
        if (cfg.videoMode === 'iframe' && data.tweetId) {
          md += tweetIframe(data.tweetId) + '\n';
        } else {
          md += `> 🎬 [点击查看视频](${data.tweetUrl})\n\n`;
        }
      }

      // 图片 —— 下载模式用本地路径，否则外链
      if (data.images.length > 0) {
        if (cfg.imageMode === 'download' && localImagePaths?.length > 0) {
          localImagePaths.forEach(p => { md += `![[${p}]]\n\n`; });
        } else {
          data.images.forEach((url, i) => { md += `![图片${i+1}](${url})\n\n`; });
        }
      }

      if (data.poll)  md += pollMd(data.poll);
      if (data.quote) md += quoteMd(data.quote);

      // 话题标签行
      if (data.hashtags.length > 0) {
        md += '\n' + data.hashtags.map(t => `#${t}`).join(' ') + '\n';
      }

      // 来源行
      const dt = UtilModule.formatDate(data.tweetTime);
      md += `\n---\n[原推文](${data.tweetUrl})`;
      if (data.handle) md += ` · @${data.handle}`;
      if (dt)          md += ` · ${dt}`;

      // 评论区
      if (comments?.length > 0) md += commentsMd(comments);

      return md;
    }

    function toFileName(data) {
      const d = data.tweetTime
        ? (() => {
            const dt = new Date(data.tweetTime);
            return new Date(dt.getTime() + (dt.getTimezoneOffset() + 480) * 60000).toISOString().substring(0, 10);
          })()
        : UtilModule.getBeijingTime().substring(0, 10);
      // 先剥离 emoji、URL 和特殊 Unicode，再交给 sanitizeFileName 统一处理
      const raw = (data.text || data.handle || 'tweet')
        .replace(/https?:\/\/\S+/g, '')
        .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')
        .replace(/[\u{2600}-\u{27BF}]/gu, '')
        .replace(/[\n\r]+/g, ' ')
        .trim()
        .substring(0, 40);
      return UtilModule.sanitizeFileName(raw || data.handle || 'tweet');
    }

    return { toMarkdown, toFileName };
  })();

  // ============================================================
  // 模块5: 保存功能 (SaveModule)
  // ============================================================
  const SaveModule = (function () {

    async function downloadImages(data, cfg) {
      if (!cfg.serverEndpoint) throw new Error('serverEndpoint 未配置');
      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method: 'POST', url: cfg.serverEndpoint,
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.serverToken||''}` },
          data: JSON.stringify({ tweetId: data.tweetId, tweetUrl: data.tweetUrl, imageUrls: data.images, mediaFolder: cfg.serverMediaFolder || 'X媒体' }),
          timeout: 30000,
          onload: r => {
            try { const d = JSON.parse(r.responseText); d.ok ? resolve(d.paths||[]) : reject(new Error(d.error||'服务器错误')); }
            catch { reject(new Error('响应解析失败')); }
          },
          onerror: () => reject(new Error('服务器连接失败')),
          ontimeout: () => reject(new Error('服务器超时')),
        });
      });
    }

    async function getFeishuToken(appId, appSecret, domain) {
      const base = domain === 'larksuite' ? 'https://open.larksuite.com' : 'https://open.feishu.cn';
      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method: 'POST', url: `${base}/open-apis/auth/v3/tenant_access_token/internal`,
          headers: { 'Content-Type': 'application/json' },
          data: JSON.stringify({ app_id: appId, app_secret: appSecret }),
          timeout: 10000,
          onload: r => {
            try { const d = JSON.parse(r.responseText); d.code === 0 ? resolve(d.tenant_access_token) : reject(new Error(`飞书Token: ${d.msg}`)); }
            catch (e) { reject(e); }
          },
          onerror: () => reject(new Error('飞书网络错误')),
          ontimeout: () => reject(new Error('飞书超时')),
        });
      });
    }

    async function saveToFeishu(data, markdown, comments, cfg) {
      if (!cfg.feishuAppId || !cfg.feishuAppSecret || !cfg.feishuAppToken || !cfg.feishuTableId) {
        throw new Error('飞书配置不完整');
      }
      const token = await getFeishuToken(cfg.feishuAppId, cfg.feishuAppSecret, cfg.feishuApiDomain);
      const base  = cfg.feishuApiDomain === 'larksuite' ? 'https://open.larksuite.com' : 'https://open.feishu.cn';
      const f     = (key, fb) => cfg[key] || fb;

      const fields = {};
      fields[f('feishuFieldContent',   '内容')]    = markdown;
      fields[f('feishuFieldUrl',       '链接')]    = data.tweetUrl;
      // 作者 = 显示名（单选字段，飞书单选传字符串），账号 = @handle（文本字段）
      fields[f('feishuFieldAuthor',    '作者')]    = data.displayName || `@${data.handle}`;
      fields[f('feishuFieldHandle',    '账号')]    = `@${data.handle}`;
      if (data.tweetTime) fields[f('feishuFieldTime', '发布时间')] = new Date(data.tweetTime).getTime();
      fields[f('feishuFieldSavedDate', '保存日期')] = Date.now();

      // 图片 URL（换行分隔）
      if (data.images.length > 0) fields[f('feishuFieldImages', '图片URL')] = data.images.join('\n');

      // 视频 URL（换行分隔，不能获取直链时存推文 URL）
      if (data.hasVideo && data.videoUrls.length > 0) {
        fields[f('feishuFieldVideo', '视频URL')] = data.videoUrls.join('\n');
      }

      // 标签 —— 多选字段格式：[{ "text": "tag" }]
      if (data.hashtags.length > 0) {
        fields[f('feishuFieldTags', '标签')] = data.hashtags.map(t => ({ text: t }));
      }

      // 评论（文本汇总）
      if (comments?.length > 0) {
        const commentText = comments.map(c =>
          `#${c.idx} @${c.handle}${c.time ? ' · ' + UtilModule.formatDate(c.time) : ''}\n${c.text}`
        ).join('\n\n---\n\n');
        fields[f('feishuFieldComments', '评论')] = commentText;
      }

      // 查找是否存在相同推文记录（按 URL 字段去重，存在则覆盖更新）
      const existingId = await new Promise(res => {
        const urlField = f('feishuFieldUrl', '链接');
        const filter   = encodeURIComponent(`CurrentValue.[${urlField}]="${data.tweetUrl}"`);
        GM_xmlhttpRequest({
          method: 'GET',
          url: `${base}/open-apis/bitable/v1/apps/${cfg.feishuAppToken}/tables/${cfg.feishuTableId}/records?filter=${filter}&page_size=1`,
          headers: { 'Authorization': `Bearer ${token}` },
          timeout: 10000,
          onload: r => {
            try { const d = JSON.parse(r.responseText); res(d?.data?.items?.[0]?.record_id || null); }
            catch { res(null); }
          },
          onerror:   () => res(null),
          ontimeout: () => res(null),
        });
      });

      return new Promise((resolve, reject) => {
        const isUpdate = !!existingId;
        GM_xmlhttpRequest({
          method: isUpdate ? 'PUT' : 'POST',
          url: isUpdate
            ? `${base}/open-apis/bitable/v1/apps/${cfg.feishuAppToken}/tables/${cfg.feishuTableId}/records/${existingId}`
            : `${base}/open-apis/bitable/v1/apps/${cfg.feishuAppToken}/tables/${cfg.feishuTableId}/records`,
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          data: JSON.stringify({ fields }),
          timeout: 15000,
          onload: r => {
            try { const d = JSON.parse(r.responseText); d.code === 0 ? resolve(d) : reject(new Error(`飞书: ${d.msg}`)); }
            catch (e) { reject(e); }
          },
          onerror: () => reject(new Error('飞书网络错误')),
          ontimeout: () => reject(new Error('飞书超时')),
        });
      });
    }

    function saveToObsidian(markdown, fileName, cfg) {
      GM_setClipboard(markdown);
      const fp = `${cfg.folderPath||'X收集箱'}/${fileName}.md`;
      let uri;
      if (cfg.useAdvancedUri) {
        const vault = encodeURIComponent(cfg.vaultName || '');
        const filepath = encodeURIComponent(fp);
        uri = `obsidian://adv-uri?vault=${vault}&filepath=${filepath}&mode=overwrite&clipboard=true`;
      } else {
        const vault = encodeURIComponent(cfg.vaultName || '');
        const file = encodeURIComponent(fp.replace(/\.md$/, ''));
        uri = `obsidian://new?vault=${vault}&file=${file}`;
      }
      window.location.href = uri;
    }

    async function save(articleEl) {
      const cfg  = ConfigModule.get();
      const data = ExtractModule.extractTweet(articleEl);

      if (!data) {
        UtilModule.showNotification('无法提取推文内容', 'error');
        LogModule.log('warn', '提取失败', (articleEl.outerHTML||'').substring(0, 200));
        return;
      }

      // 评论提取（仅单推文页有效）
      let comments = null;
      if (cfg.saveComments) {
        const count = parseInt(cfg.commentCount) || 100;
        const found = ExtractModule.extractComments(count);
        comments = found.length > 0 ? found : null;
        if (found.length === 0) LogModule.log('info', '未找到评论（请在单推文页使用）');
      }

      // 图片下载
      let localPaths = null;
      if (cfg.imageMode === 'download' && data.images.length > 0) {
        UtilModule.showNotification(`正在下载 ${data.images.length} 张图片...`, 'info');
        try { localPaths = await downloadImages(data, cfg); }
        catch (e) {
          LogModule.log('warn', '图片下载失败', e.message);
          UtilModule.showNotification('图片下载失败，已降级为外链', 'warning');
        }
      }

      const markdown = ConvertModule.toMarkdown(data, cfg, localPaths, comments);
      const fileName = ConvertModule.toFileName(data);
      data.fileName  = fileName; // 供历史记录跳转使用

      // 飞书
      if (cfg.saveToFeishu) {
        try {
          await saveToFeishu(data, markdown, comments, cfg);
          UtilModule.showNotification('已保存到飞书 ✓', 'success');
          LogModule.log('info', '飞书保存成功', data.tweetUrl);
        } catch (e) {
          LogModule.log('error', '飞书保存失败', e.message);
          UtilModule.showNotification(`飞书: ${e.message}`, 'error');
        }
      }

      LogModule.addHistory(data);

      // Obsidian（最后，触发跳转）
      if (cfg.saveToObsidian) {
        await new Promise(r => setTimeout(r, cfg.saveToFeishu ? 600 : 0));
        try { saveToObsidian(markdown, fileName, cfg); }
        catch (e) {
          LogModule.log('error', 'Obsidian失败', e.message);
          UtilModule.showNotification(`Obsidian: ${e.message}`, 'error');
        }
      }

      if (!cfg.saveToObsidian && !cfg.saveToFeishu) {
        UtilModule.showNotification('请在设置中启用保存目标', 'warning');
      }
    }

    return { save, saveToFeishu, saveToObsidian, getFeishuToken };
  })();

  // ============================================================
  // 模块6: 用户界面 (UIModule)
  // ============================================================
  const UIModule = (function () {
    const injected = new WeakSet();

    function injectStyles() {
      GM_addStyle(`
        @keyframes xsSlide { from{opacity:0;transform:translateX(-50%) translateY(-8px)} to{opacity:1;transform:translateX(-50%) translateY(0)} }
        .xs-save-btn { display:inline-flex;align-items:center;justify-content:center;cursor:pointer;color:rgb(113,118,123);padding:0 4px;border-radius:50%;transition:color .15s,background .15s;-webkit-tap-highlight-color:transparent;user-select:none; }
        .xs-save-btn:hover { color:#3b82f6;background:rgba(59,130,246,.1); }
        .xs-save-btn.xs-saved { color:#10b981; }
        .xs-save-btn svg { width:18px;height:18px;pointer-events:none; }
        .xs-overlay { position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:999998;display:flex;align-items:center;justify-content:center;padding:16px; }
        .xs-panel { border-radius:16px;padding:20px;width:100%;max-width:520px;max-height:88vh;overflow-y:auto;font-family:-apple-system,'Segoe UI',sans-serif;font-size:14px;box-shadow:0 20px 60px rgba(0,0,0,.5); }
        .xs-panel *{box-sizing:border-box;}
        .xs-panel input,.xs-panel select,.xs-panel textarea{width:100%;padding:8px 10px;border-radius:8px;font-size:13px;outline:none;background:inherit;color:inherit;}
        .xs-panel input:focus,.xs-panel select:focus{border-color:#3b82f6!important;}
        .xs-sec{font-weight:600;color:#3b82f6;margin:16px 0 8px;font-size:13px;}
        .xs-row{margin:10px 0;}
        .xs-lbl{font-weight:500;margin-bottom:4px;font-size:13px;}
        .xs-tip{font-size:11px;color:#94a3b8;margin-top:3px;}
        .xs-chk{display:flex;align-items:center;gap:8px;margin:8px 0;cursor:pointer;}
        .xs-chk input{width:15px;height:15px;flex-shrink:0;}
        .xs-tabs{display:flex;gap:0;margin-bottom:16px;border-bottom:1px solid #e2e8f0;}
        .xs-tab{padding:8px 12px;cursor:pointer;font-size:13px;font-weight:500;border-bottom:2px solid transparent;color:#64748b;}
        .xs-tab.active{color:#3b82f6;border-bottom-color:#3b82f6;}
        .xs-tc{display:none;}
        .xs-tc.active{display:block;}
        .xs-btn{padding:9px 14px;border:none;border-radius:9px;font-size:13px;font-weight:500;cursor:pointer;}
        .xs-pri{background:#3b82f6;color:#fff;}
        .xs-sec2{background:#f1f5f9;color:#0f172a;}
        .xs-log-item{padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:12px;}
        .xs-log-error{color:#ef4444;} .xs-log-warn{color:#f59e0b;} .xs-log-info{color:#64748b;}
        .xs-hist-item{padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:12px;}
        .xs-meta-grid{display:grid;grid-template-columns:1fr 1fr;gap:4px;}
        .xs-disabled-banner{background:#fef3c7;color:#92400e;padding:10px 14px;border-radius:10px;font-size:13px;font-weight:500;margin-bottom:14px;}
      `);
    }

    function injectSaveButton(el) {
      // 拦截点赞按钮（更易于在手机端找到）：单击=保存，双击=X原生点赞
      const likeBtn = el.querySelector('[data-testid="like"]');
      if (!likeBtn || likeBtn.dataset.xsHooked) return;
      likeBtn.dataset.xsHooked = '1';
      injected.add(el);

      let timer      = null;
      let ignoreNext = false;

      likeBtn.addEventListener('click', async e => {
        // 第二次合成点击（放行给 X 原生点赞）
        if (ignoreNext) { ignoreNext = false; return; }

        e.stopPropagation();
        e.preventDefault();

        if (timer) {
          // 双击：取消保存，放行给 X 原生点赞
          clearTimeout(timer); timer = null;
          ignoreNext = true;
          likeBtn.click();
          UtilModule.showNotification('已点赞 ❤️', 'info');
          return;
        }

        // 单击：350ms 后判定为保存操作
        timer = setTimeout(async () => {
          timer = null;
          likeBtn.style.opacity = '0.4';
          setTimeout(() => (likeBtn.style.opacity = ''), 1500);
          UtilModule.showNotification('正在保存...', 'info');
          try { await SaveModule.save(el); }
          catch (err) {
            LogModule.log('error', '保存异常', err.message);
            UtilModule.showNotification('保存失败', 'error');
          }
        }, 350);
      }, true); // capture 阶段拦截，先于 X 的监听器执行

      injected.add(el);
    }

    function processArticles() {
      document.querySelectorAll('article[data-testid="tweet"]').forEach(injectSaveButton);
    }

    function observeDOM() {
      let p = false;
      new MutationObserver(() => {
        if (p) return; p = true;
        requestAnimationFrame(() => { processArticles(); p = false; });
      }).observe(document.body, { childList: true, subtree: true });
    }

    // ── 设置面板 ──────────────────────────────────────────────
    function showSettings() {
      document.querySelector('.xs-overlay')?.remove();
      const cfg = ConfigModule.get();
      const enabled = isEnabled();
      const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      const bg = isDark ? '#1e2732' : '#fff', fg = isDark ? '#e7e9ea' : '#0f172a', bd = isDark ? '#2d3748' : '#e2e8f0';

      const overlay = document.createElement('div');
      overlay.className = 'xs-overlay';
      const panel = document.createElement('div');
      panel.className = 'xs-panel';
      panel.style.cssText = `background:${bg};color:${fg};`;

      const T = (l, k, t='text', ph='', tip='') => {
        const v = String(cfg[k]!==undefined?cfg[k]:'').replace(/"/g,'&quot;');
        return `<div class="xs-row"><div class="xs-lbl">${l}</div>
          <input type="${t}" data-key="${k}" value="${v}" placeholder="${ph}" style="border:1px solid ${bd};">
          ${tip?`<div class="xs-tip">${tip}</div>`:''}</div>`;
      };
      const C = (l, k, tip='') => `<label class="xs-chk"><input type="checkbox" data-key="${k}" ${cfg[k]?'checked':''}>
        <span>${l}${tip?`<div class="xs-tip">${tip}</div>`:''}</span></label>`;
      const S = (l, k, opts, tip='') => {
        const o = opts.map(([v,t])=>`<option value="${v}" ${cfg[k]===v?'selected':''}>${t}</option>`).join('');
        return `<div class="xs-row"><div class="xs-lbl">${l}</div>
          <select data-key="${k}" style="border:1px solid ${bd};">${o}</select>
          ${tip?`<div class="xs-tip">${tip}</div>`:''}</div>`;
      };

      const META = [
        ['meta_author','作者全名'],['meta_handle','@账号'],
        ['meta_url','推文链接'],['meta_tweet_id','推文ID'],
        ['meta_time','发布时间'],['meta_saved','保存时间'],
        ['meta_likes','点赞数'],['meta_retweets','转发数'],
        ['meta_replies','回复数'],['meta_views','浏览数'],
        ['meta_bookmarks','收藏数'],['meta_hashtags','话题标签'],
        ['meta_mentions','提及账号'],['meta_cashtags','股票代码'],
        ['meta_has_video','含视频'],['meta_has_poll','含投票'],
        ['meta_is_reply','是否回复'],['meta_is_quote','是否引用'],
        ['meta_type','推文类型'],
      ];
      const metaGrid = META.map(([k,l])=>
        `<label class="xs-chk"><input type="checkbox" data-key="${k}" ${cfg[k]?'checked':''}><span>${l}</span></label>`
      ).join('');

      panel.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
          <span style="font-size:17px;font-weight:700;">X Saver v0.0.4</span>
          <span id="xs-close" style="cursor:pointer;font-size:24px;opacity:.5;line-height:1;">×</span>
        </div>
        ${!enabled ? `<div class="xs-disabled-banner">⚠️ 脚本已禁用，点击"总开关"重新启用</div>` : ''}

        <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;padding:10px 12px;border-radius:10px;background:${isDark?'#2d3748':'#f8fafc'};">
          <span style="font-weight:600;font-size:13px;">总开关</span>
          <label class="xs-chk" style="margin:0;">
            <input type="checkbox" id="xs-master-toggle" ${enabled?'checked':''}>
            <span>${enabled ? '✅ 已启用' : '❌ 已禁用'}</span>
          </label>
        </div>

        <div class="xs-tabs">
          <div class="xs-tab active" data-tab="general">通用</div>
          <div class="xs-tab" data-tab="obsidian">Obsidian</div>
          <div class="xs-tab" data-tab="feishu">飞书</div>
          <div class="xs-tab" data-tab="meta">元数据</div>
          <div class="xs-tab" data-tab="log">日志</div>
          <div class="xs-tab" data-tab="history">历史</div>
        </div>

        <!-- 通用 -->
        <div class="xs-tc active" id="xs-tab-general">
          <div class="xs-sec">保存目标</div>
          ${C('保存到 Obsidian','saveToObsidian')}
          ${C('保存到飞书多维表格','saveToFeishu')}
          <div class="xs-sec">评论</div>
          ${C('保存评论（仅在单推文页有效）','saveComments','默认关闭，需在 x.com/user/status/xxx 页面使用')}
          ${T('保存条数','commentCount','number','100')}
          <div class="xs-sec">媒体</div>
          ${S('图片模式','imageMode',[['link','外链（pbs.twimg.com）'],['download','下载到服务器']])}
          ${S('视频模式','videoMode',[['iframe','iframe 嵌入（Obsidian 阅读模式可播放）'],['link','仅存链接/推文URL']],'使用 platform.twitter.com/embed 嵌入，无需下载')}
          <div class="xs-sec">服务器配置（图片下载模式）</div>
          ${T('端点 URL','serverEndpoint','text','https://your.server/x-media')}
          ${T('Token','serverToken','password')}
          ${T('媒体子文件夹','serverMediaFolder','text','X媒体')}
          <div class="xs-sec">配置管理</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
            <button class="xs-btn xs-sec2" id="xs-export">导出配置</button>
            <button class="xs-btn xs-sec2" id="xs-import">导入配置</button>
            <button class="xs-btn" style="background:#fef3c7;color:#92400e;" id="xs-reset">重置默认</button>
          </div>
        </div>

        <!-- Obsidian -->
        <div class="xs-tc" id="xs-tab-obsidian">
          ${T('Vault 名称','vaultName','text','留空=默认 Vault')}
          ${T('保存文件夹','folderPath','text','X收集箱')}
          ${C('使用 Advanced URI 插件（推荐）','useAdvancedUri','手机需安装 Advanced URI 社区插件')}
          <div class="xs-tip" style="margin-top:12px;padding:10px;background:${isDark?'#2d3748':'#f0f9ff'};border-radius:8px;line-height:1.6;">
            <strong>Obsidian 渲染说明</strong><br>
            • 视频：iframe 嵌入，阅读模式直接播放<br>
            • 图片：外链模式直接显示；下载模式用 <code>![[本地路径]]</code><br>
            • 投票：渲染为 Markdown 表格<br>
            • 引用推文：渲染为块引用（>&gt;）<br>
            • 标签：以 #tag 格式显示在正文末<br>
            • Twitter Article：显示原文链接
          </div>
        </div>

        <!-- 飞书 -->
        <div class="xs-tc" id="xs-tab-feishu">
          ${S('飞书域名','feishuApiDomain',[['feishu','飞书（国内）open.feishu.cn'],['larksuite','Lark（海外）open.larksuite.com']])}
          ${T('App ID','feishuAppId','text','cli_xxxxxxxxxxxxxxxx')}
          ${T('App Secret','feishuAppSecret','password')}
          ${T('多维表格 App Token','feishuAppToken','text','GVW9xxxxxxxxxxxx')}
          ${T('表格 ID','feishuTableId','text','tblxxxxxxxxxxxx')}
          <div class="xs-sec">字段名映射</div>
          <div class="xs-tip" style="margin-bottom:8px;">
            <strong>字段类型说明：</strong>作者=文本（显示名），账号=文本（@handle），发布时间=日期时间，标签=<strong>多选</strong>，图片URL/视频URL=文本（换行分隔），评论=文本
          </div>
          ${T('内容','feishuFieldContent','text','内容')}
          ${T('链接','feishuFieldUrl','text','链接')}
          ${T('作者（显示名）','feishuFieldAuthor','text','作者')}
          ${T('账号（@handle）','feishuFieldHandle','text','账号')}
          ${T('发布时间','feishuFieldTime','text','发布时间')}
          ${T('保存日期','feishuFieldSavedDate','text','保存日期')}
          ${T('图片URL','feishuFieldImages','text','图片URL')}
          ${T('视频URL','feishuFieldVideo','text','视频URL')}
          ${T('标签（多选字段）','feishuFieldTags','text','标签')}
          ${T('评论','feishuFieldComments','text','评论')}
          <div style="margin-top:12px;">
            <button class="xs-btn xs-sec2" id="xs-test-feishu">测试飞书连接</button>
          </div>
        </div>

        <!-- 元数据 -->
        <div class="xs-tc" id="xs-tab-meta">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
            <span class="xs-tip" style="margin:0;">选择写入 YAML frontmatter 的字段</span>
            <div style="display:flex;gap:6px;">
              <button class="xs-btn xs-sec2" id="xs-meta-all" style="padding:3px 10px;font-size:12px;">全选</button>
              <button class="xs-btn xs-sec2" id="xs-meta-none" style="padding:3px 10px;font-size:12px;">全不选</button>
            </div>
          </div>
          <div class="xs-meta-grid">${metaGrid}</div>
        </div>

        <!-- 日志 -->
        <div class="xs-tc" id="xs-tab-log">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <span style="font-size:13px;font-weight:500;">错误日志（最近500条）</span>
            <button class="xs-btn xs-sec2" style="padding:4px 10px;font-size:12px;" id="xs-clear-log">清空</button>
          </div>
          <div id="xs-log-list"></div>
        </div>

        <!-- 历史 -->
        <div class="xs-tc" id="xs-tab-history">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <span style="font-size:13px;font-weight:500;">保存历史（最近500条）</span>
            <button class="xs-btn xs-sec2" style="padding:4px 10px;font-size:12px;" id="xs-clear-hist">清空</button>
          </div>
          <div id="xs-hist-list"></div>
        </div>

        <div style="display:flex;gap:10px;margin-top:20px;">
          <button class="xs-btn xs-pri" id="xs-save-cfg" style="flex:1;">保存配置</button>
        </div>
      `;

      overlay.appendChild(panel);
      document.body.appendChild(overlay);

      // 标签切换
      panel.querySelectorAll('.xs-tab').forEach(tab => {
        tab.onclick = () => {
          panel.querySelectorAll('.xs-tab').forEach(t => t.classList.remove('active'));
          panel.querySelectorAll('.xs-tc').forEach(c => c.classList.remove('active'));
          tab.classList.add('active');
          document.getElementById(`xs-tab-${tab.dataset.tab}`)?.classList.add('active');
          if (tab.dataset.tab === 'log')     renderLogs();
          if (tab.dataset.tab === 'history') renderHistory();
        };
      });

      function renderLogs() {
        const el = document.getElementById('xs-log-list');
        const logs = LogModule.getLogs();
        if (!logs.length) { el.innerHTML = `<div class="xs-tip">暂无日志</div>`; return; }
        el.innerHTML = logs.map(l => `
          <div class="xs-log-item xs-log-${l.level}">
            <span style="opacity:.6;">${l.time}</span>
            <strong style="margin-left:6px;">${l.msg}</strong>
            ${l.detail ? `<div style="opacity:.7;margin-top:2px;">${l.detail}</div>` : ''}
          </div>`).join('');
      }

      function renderHistory() {
        const el = document.getElementById('xs-hist-list');
        const hist = LogModule.getHistory();
        if (!hist.length) { el.innerHTML = `<div class="xs-tip">暂无历史</div>`; return; }
        el.innerHTML = hist.map((h, i) => `
          <div class="xs-hist-item" data-idx="${i}">
            <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
              <span style="font-weight:500;color:#3b82f6;">${h.author}</span>
              <span style="color:#64748b;">${h.name}</span>
              ${h.hasImg ? '<span title="含图片">🖼️</span>' : ''}${h.hasVid ? '<span title="含视频">🎬</span>' : ''}
              <span style="opacity:.5;font-size:11px;margin-left:auto;">${h.time}</span>
            </div>
            <div style="opacity:.75;margin-top:2px;font-size:12px;">${h.text || '（无文字）'}</div>
            <div style="display:flex;gap:8px;margin-top:4px;align-items:center;">
              <a href="${h.url}" target="_blank" style="font-size:11px;color:#3b82f6;">原推文 ↗</a>
              ${h.fileName ? `<button class="xs-btn xs-hist-open" data-idx="${i}" style="padding:1px 8px;font-size:11px;" title="${h.fileName}">打开笔记</button>` : ''}
              <button class="xs-btn xs-hist-del" data-idx="${i}" style="padding:1px 8px;font-size:11px;background:#ef4444;color:#fff;border:none;cursor:pointer;border-radius:4px;">删除</button>
            </div>
          </div>`).join('');

        // 事件委托
        el.onclick = e => {
          const openBtn = e.target.closest('.xs-hist-open');
          const delBtn  = e.target.closest('.xs-hist-del');
          const cfg     = ConfigModule.get();
          if (openBtn) {
            const idx  = parseInt(openBtn.dataset.idx);
            const fn   = LogModule.getHistory()[idx]?.fileName;
            if (fn) {
              const fp = `${cfg.folderPath || 'X收集箱'}/${fn}.md`;
              const vault = encodeURIComponent(cfg.vaultName || '');
              const file = encodeURIComponent(fp.replace(/\.md$/, ''));
              window.open(`obsidian://open?vault=${vault}&file=${file}`);
            }
          }
          if (delBtn) {
            const idx = parseInt(delBtn.dataset.idx);
            LogModule.removeHistoryAt(idx);
            renderHistory();
          }
        };
      }

      // 事件绑定
      document.getElementById('xs-close').onclick = () => overlay.remove();
      overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };

      // 总开关
      document.getElementById('xs-master-toggle').onchange = function () {
        setEnabled(this.checked);
        UtilModule.showNotification(this.checked ? '✅ 脚本已启用，刷新页面生效' : '❌ 脚本已禁用', this.checked ? 'success' : 'warning');
      };

      document.getElementById('xs-save-cfg').onclick = () => {
        const n = {};
        panel.querySelectorAll('[data-key]').forEach(el => {
          n[el.getAttribute('data-key')] = el.type === 'checkbox' ? el.checked : el.value.trim();
        });
        ConfigModule.setAll(n);
        UtilModule.showNotification('配置已保存', 'success');
        overlay.remove();
      };

      document.getElementById('xs-export').onclick = () => {
        GM_setClipboard(ConfigModule.exportJson());
        UtilModule.showNotification('配置已复制到剪贴板', 'success');
      };

      document.getElementById('xs-import').onclick = () => {
        const json = prompt('粘贴配置 JSON：');
        if (!json) return;
        try {
          const count = ConfigModule.importJson(json);
          UtilModule.showNotification(`已导入 ${count} 项配置`, 'success');
          overlay.remove(); setTimeout(showSettings, 100);
        } catch (e) { UtilModule.showNotification(`导入失败: ${e.message}`, 'error'); }
      };

      document.getElementById('xs-reset').onclick = () => {
        if (!confirm('确认重置所有配置？')) return;
        ConfigModule.reset();
        UtilModule.showNotification('已重置为默认配置', 'success');
        overlay.remove(); setTimeout(showSettings, 100);
      };

      document.getElementById('xs-test-feishu').onclick = async () => {
        const id = panel.querySelector('[data-key="feishuAppId"]').value.trim();
        const secret = panel.querySelector('[data-key="feishuAppSecret"]').value.trim();
        const domain = panel.querySelector('[data-key="feishuApiDomain"]').value;
        if (!id || !secret) { UtilModule.showNotification('请填写 App ID 和 App Secret', 'warning'); return; }
        UtilModule.showNotification('测试中...', 'info');
        try { await SaveModule.getFeishuToken(id, secret, domain); UtilModule.showNotification('飞书连接成功 ✓', 'success'); }
        catch (e) { UtilModule.showNotification(`飞书失败: ${e.message}`, 'error'); }
      };

      document.getElementById('xs-clear-log').onclick  = () => { LogModule.clearLogs();    renderLogs();    UtilModule.showNotification('日志已清空', 'success'); };
      document.getElementById('xs-clear-hist').onclick = () => { LogModule.clearHistory(); renderHistory(); UtilModule.showNotification('历史已清空', 'success'); };

      const metaKeys = ['meta_author','meta_handle','meta_url','meta_tweet_id','meta_time','meta_saved',
        'meta_likes','meta_retweets','meta_replies','meta_views','meta_bookmarks','meta_hashtags',
        'meta_mentions','meta_cashtags','meta_has_video','meta_has_poll','meta_is_reply','meta_is_quote','meta_type'];
      document.getElementById('xs-meta-all').onclick  = () =>
        metaKeys.forEach(k => { const el = panel.querySelector(`[data-key="${k}"]`); if (el) el.checked = true; });
      document.getElementById('xs-meta-none').onclick = () =>
        metaKeys.forEach(k => { const el = panel.querySelector(`[data-key="${k}"]`); if (el) el.checked = false; });
    }

    function init() {
      // 总开关控制菜单项
      const enabled = isEnabled();
      GM_registerMenuCommand(enabled ? '🔴 禁用 X Saver' : '🟢 启用 X Saver', () => {
        setEnabled(!isEnabled());
        UtilModule.showNotification(isEnabled() ? '✅ 已启用，刷新生效' : '❌ 已禁用', 'info');
      });
      GM_registerMenuCommand('⚙️ 打开设置', showSettings);
      GM_registerMenuCommand('📋 历史记录', () => {
        showSettings();
        setTimeout(() => document.querySelector('.xs-tab[data-tab="history"]')?.click(), 80);
      });

      if (!enabled) {
        LogModule.log('info', 'X Saver 已禁用，跳过初始化');
        return;
      }

      injectStyles();
      setTimeout(processArticles, 1200);
      observeDOM();
      LogModule.log('info', 'X Saver v2.1.0 已启动');
    }

    return { init, showSettings };
  })();

  UIModule.init();

})();
