// ============================================================
// X Saver - detector.js
// 站点检测 + 动态脚本注入 + 主世界视频URL拦截
// Version: 1.1.0
// ============================================================

// ============================================================
// 第零部分：主世界 fetch/XHR 拦截器（必须最先执行）
// 通过 <script> 标签注入到页面主世界，拦截 X 的 API 响应
// 从中提取视频下载 URL，通过 postMessage 传回内容脚本世界
// ============================================================

(function injectMainWorldInterceptor() {
  // 仅在 X/Twitter 站点注入
  const h = window.location.hostname;
  if (h !== 'x.com' && h !== 'twitter.com' &&
      h !== 'mobile.x.com' && h !== 'mobile.twitter.com') return;

  const script = document.createElement('script');
  script.textContent = '(' + function() {
    if (window.__xSaverInterceptorActive) return;
    window.__xSaverInterceptorActive = true;

    // 递归提取推文对象中的视频 URL（限制递归深度防止栈溢出）
    function extractVideoUrls(data, depth) {
      if (!data || typeof data !== 'object') return;
      if ((depth || 0) > 30) return;
      var d = (depth || 0) + 1;
      var tweetId = data.rest_id || (data.legacy && data.legacy.id_str);
      var ext = (data.legacy ? data.legacy.extended_entities : null) || data.extended_entities;
      if (tweetId && ext && ext.media) {
        for (var i = 0; i < ext.media.length; i++) {
          var m = ext.media[i];
          if (m.video_info && m.video_info.variants) {
            var mp4 = m.video_info.variants
              .filter(function(v) { return v.content_type === 'video/mp4'; })
              .sort(function(a, b) { return (b.bitrate || 0) - (a.bitrate || 0); });
            if (mp4.length > 0) {
              window.postMessage({ type: '__xSaverVideo', tweetId: tweetId, variants: mp4 }, '*');
            }
          }
        }
      }
      if (Array.isArray(data)) {
        for (var j = 0; j < data.length; j++) extractVideoUrls(data[j], d);
      } else {
        var keys = Object.keys(data);
        for (var k = 0; k < keys.length; k++) {
          if (typeof data[keys[k]] === 'object' && data[keys[k]] !== null) {
            extractVideoUrls(data[keys[k]], d);
          }
        }
      }
    }

    // GraphQL 端点匹配
    function isGraphQLVideoEndpoint(url) {
      return url.indexOf('/graphql/') !== -1 && (
        url.indexOf('TweetDetail') !== -1 ||
        url.indexOf('TweetResultByRestId') !== -1 ||
        url.indexOf('UserTweets') !== -1 ||
        url.indexOf('HomeTimeline') !== -1 ||
        url.indexOf('SearchTimeline') !== -1 ||
        url.indexOf('Bookmarks') !== -1 ||
        url.indexOf('Likes') !== -1 ||
        url.indexOf('ListLatestTweetsTimeline') !== -1
      );
    }

    // 从 GraphQL URL 中提取 operationId（动态发现机制，参考 x2md）
    function extractGraphQLOperationId(url) {
      try {
        var match = url.match(/\/i\/api\/graphql\/([A-Za-z0-9_-]+)\/(TweetDetail|TweetResultByRestId)/);
        if (match) {
          window.postMessage({
            type: '__xSaverGraphQLOp',
            operationId: match[1],
            operationName: match[2]
          }, '*');
        }
      } catch(e) {}
    }

    // 拦截 fetch（安全包装，任何异常不影响原始 fetch 行为）
    var origFetch = window.fetch;
    window.fetch = function() {
      var args = arguments;
      var result;
      try {
        result = origFetch.apply(this, args);
      } catch(e) {
        throw e; // 保持原始行为
      }
      // 只在成功时拦截，不影响错误传播
      try {
        var url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
        // 提取 GraphQL operationId（无论是否是视频端点）
        extractGraphQLOperationId(url);
        result.then(function(response) {
          try {
            if (isGraphQLVideoEndpoint(url)) {
              response.clone().json().then(extractVideoUrls).catch(function(){});
            }
          } catch(e) {}
          return response;
        }).catch(function(){});
      } catch(e) {}
      return result;
    };

    // 拦截 XMLHttpRequest
    var origOpen = XMLHttpRequest.prototype.open;
    var origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method, url) {
      this.__xSaverUrl = url;
      // 提取 GraphQL operationId
      extractGraphQLOperationId(url);
      return origOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function() {
      var self = this;
      this.addEventListener('load', function() {
        try {
          if (self.__xSaverUrl && isGraphQLVideoEndpoint(self.__xSaverUrl)) {
            extractVideoUrls(JSON.parse(self.responseText));
          }
        } catch(e) {}
      });
      return origSend.apply(this, arguments);
    };
  } + ')()';

  (document.head || document.documentElement).appendChild(script);
  script.remove();

  // 在内容脚本世界中接收主世界发来的视频 URL
  window.__xSaverVideoCache = new Map();

  // 动态发现的 GraphQL operationId 缓存（参考 x2md）
  // 格式: { TweetDetail: ['id1','id2'], TweetResultByRestId: ['id3'] }
  window.__xSaverGraphQLOpCache = { TweetDetail: [], TweetResultByRestId: [] };

  window.addEventListener('message', function(event) {
    if (event.source !== window || !event.data) return;

    // 视频 URL 缓存
    if (event.data.type === '__xSaverVideo') {
      if (window.__xSaverVideoCache.size >= 200) {
        var firstKey = window.__xSaverVideoCache.keys().next().value;
        window.__xSaverVideoCache.delete(firstKey);
      }
      window.__xSaverVideoCache.set(event.data.tweetId, event.data.variants);
      return;
    }

    // GraphQL operationId 动态发现缓存
    if (event.data.type === '__xSaverGraphQLOp') {
      var opName = event.data.operationName;
      var opId = event.data.operationId;
      if (opName && opId && window.__xSaverGraphQLOpCache[opName]) {
        // 去重：如果已存在则不添加
        if (window.__xSaverGraphQLOpCache[opName].indexOf(opId) === -1) {
          // 新发现的 ID 放在最前面（优先使用最新发现的）
          window.__xSaverGraphQLOpCache[opName].unshift(opId);
          // 最多保留 5 个
          if (window.__xSaverGraphQLOpCache[opName].length > 5) {
            window.__xSaverGraphQLOpCache[opName].pop();
          }
        }
      }
      return;
    }
  });
})();

// ============================================================
// 第一部分：站点检测与脚本注入
// ============================================================

(function () {
  'use strict';

  // 防止重复注入
  if (window.__xSaverDetectorLoaded) return;
  window.__xSaverDetectorLoaded = true;

  const DEBUG = false;
  function log(...args) {
    if (DEBUG) console.log('[X Saver Detector]', ...args);
  }

  // ============================================================
  // 页面类型检测
  // ============================================================

  const PAGE_TYPES = {
    TWEET_DETAIL: 'TWEET_DETAIL',   // 推文详情页 /user/status/123
    ARTICLE: 'ARTICLE',             // 长文章 /user/article/123 (X Articles / Twitter Notes)
    PROFILE: 'PROFILE',             // 用户主页 /user
    SEARCH: 'SEARCH',               // 搜索页 /search
    HOME: 'HOME',                   // 首页
    OTHER: 'OTHER'
  };

  function detectPageType() {
    const path = window.location.pathname;

    // 推文详情: /username/status/1234567890
    if (/^\/[^\/]+\/status\/\d+/.test(path)) {
      return PAGE_TYPES.TWEET_DETAIL;
    }

    // 长文章: /username/article/xxx 或 /i/article/xxx (Twitter Notes)
    if (/\/article\//.test(path)) {
      return PAGE_TYPES.ARTICLE;
    }

    // 搜索页
    if (/^\/search/.test(path)) {
      return PAGE_TYPES.SEARCH;
    }

    // 首页
    if (path === '/' || path === '/home') {
      return PAGE_TYPES.HOME;
    }

    // 用户主页: /username (无其他路径)
    if (/^\/[^\/]+\/?$/.test(path) && !path.startsWith('/i/')) {
      return PAGE_TYPES.PROFILE;
    }

    return PAGE_TYPES.OTHER;
  }

  // ============================================================
  // X/Twitter 站点验证
  // ============================================================

  function isXSite() {
    const hostname = window.location.hostname;
    return (
      hostname === 'x.com' ||
      hostname === 'twitter.com' ||
      hostname === 'mobile.x.com' ||
      hostname === 'mobile.twitter.com'
    );
  }

  // ============================================================
  // 脚本注入
  // ============================================================

  let scriptsInjected = false;
  let injectionRetryCount = 0;
  const MAX_INJECTION_RETRIES = 3;

  function requestScriptInjection(pageType) {
    if (scriptsInjected) {
      log('Scripts already injected, sending page change event');
      window.dispatchEvent(new CustomEvent('x-saver-page-change', {
        detail: { pageType: pageType, url: window.location.href }
      }));
      return;
    }

    log('Requesting script injection for page type:', pageType);

    chrome.runtime.sendMessage({
      action: 'injectContentScript',
      pageType: pageType,
      url: window.location.href
    }, (response) => {
      if (chrome.runtime.lastError) {
        log('Injection request error:', chrome.runtime.lastError.message);
        // 重试机制
        if (injectionRetryCount < MAX_INJECTION_RETRIES) {
          injectionRetryCount++;
          log('Retrying injection, attempt:', injectionRetryCount);
          setTimeout(() => requestScriptInjection(pageType), 1000 * injectionRetryCount);
        }
        return;
      }
      if (response && response.success) {
        scriptsInjected = true;
        injectionRetryCount = 0;
        log('Scripts injected successfully');
      }
    });
  }

  // ============================================================
  // SPA 导航监听（X 是 React SPA）
  // ============================================================

  let lastUrl = window.location.href;
  let lastPageType = null;

  function checkUrlChange() {
    const currentUrl = window.location.href;
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      const pageType = detectPageType();

      if (pageType !== lastPageType) {
        lastPageType = pageType;
        log('URL changed, new page type:', pageType);
      }

      // 无论页面类型是否改变，都通知（因为可能是不同的推文）
      requestScriptInjection(pageType);
    }
  }

  // 方式1: MutationObserver 监听 DOM 变化（防抖 300ms，避免高频触发）
  let mutationDebounceTimer = null;
  const observer = new MutationObserver(() => {
    if (mutationDebounceTimer) clearTimeout(mutationDebounceTimer);
    mutationDebounceTimer = setTimeout(checkUrlChange, 300);
  });

  // 方式2: popstate 事件（浏览器前进/后退）
  window.addEventListener('popstate', () => {
    setTimeout(checkUrlChange, 100);
  });

  // 方式3: 拦截 pushState / replaceState
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  history.pushState = function (...args) {
    originalPushState.apply(this, args);
    setTimeout(checkUrlChange, 100);
  };

  history.replaceState = function (...args) {
    originalReplaceState.apply(this, args);
    setTimeout(checkUrlChange, 100);
  };

  // ============================================================
  // 初始化
  // ============================================================

  function init() {
    if (!isXSite()) {
      log('Not an X/Twitter site, aborting');
      return;
    }

    log('X/Twitter site detected, initializing...');

    // 检查插件是否启用
    chrome.storage.sync.get({ pluginEnabled: true }, (config) => {
      if (!config.pluginEnabled) {
        log('Plugin is disabled');
        return;
      }

      // 检测当前页面类型
      const pageType = detectPageType();
      lastPageType = pageType;
      log('Initial page type:', pageType);

      // 请求注入主脚本
      requestScriptInjection(pageType);

      // 启动 MutationObserver 监听 SPA 路由变化
      observer.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true
      });
    });
  }

  // 等待 DOM 就绪
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
