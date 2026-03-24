# X Saver

Chrome Extension (Manifest V3) - 一键保存 X/Twitter 推文到 Obsidian / Notion / 飞书 / HTML，支持媒体文件下载。

## 功能特性

- **多平台保存**：Obsidian、Notion、飞书、本地 HTML
- **媒体下载**：图片、视频（含最高画质自动选择）
- **国际化**：中文 / English
- **快捷键**：可自定义键盘快捷键触发保存
- **动态 GraphQL 发现**：自动从 X 页面发现最新 operationId，确保视频获取稳定性
- **多层视频回退**：REST API → GraphQL（拦截） → GraphQL（JS 发现） → GraphQL（硬编码兜底）

## 安装

1. 下载本仓库代码
2. 打开 Chrome，进入 `chrome://extensions/`
3. 开启「开发者模式」
4. 点击「加载已解压的扩展程序」，选择本项目文件夹

## 配置

点击扩展图标 → 选项页面，配置：

- **Obsidian**：Vault 名称、文件夹路径
- **Notion**：API Token、Database ID
- **飞书**：App ID、App Secret、文件夹 Token
- **媒体下载**：开关、下载路径

## 文件结构

```
├── manifest.json      # 扩展清单
├── background.js      # Service Worker（API 调用、视频获取）
├── content.js         # 内容脚本（页面交互、数据提取）
├── detector.js        # 主世界脚本（拦截 fetch/XHR 获取视频 URL）
├── i18n.js            # 国际化翻译
├── options.html       # 选项页面
├── options.js         # 选项页面逻辑
├── icons/             # 扩展图标
├── lib/               # 第三方库
└── styles/            # 样式文件
```

## 版本

- **v1.1** - 动态 GraphQL operationId 发现、多层视频回退、Bug 修复
- **v1.0** - 初始版本

## License

MIT
