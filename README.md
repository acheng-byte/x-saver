# X Saver · 推文保存工具

X (Twitter) 一键保存推文到 Obsidian + 飞书多维表格的 Tampermonkey/ScriptCat 用户脚本。

## 一键安装

```
https://raw.githubusercontent.com/acheng-byte/x-saver/main/x-saver.user.js
```

在 Tampermonkey 或 ScriptCat 中点击「安装」即可。

---

## 功能

- **单击点赞按钮** → 保存推文（双击 = 原生点赞）
- 保存目标：Obsidian（Advanced URI）、飞书多维表格
- 自动提取：正文、图片、视频、投票、引用推文、长文（Twitter Article）
- 正文中所有 URL 自动转为可点击链接
- 评论/回复保存（通过拦截 X 自身的 GraphQL 响应，零额外请求）
- 图片备份到媒体服务器（可选，需自建）
- 推文属性写入 Obsidian YAML frontmatter（中文字段名）
- 重复保存同一推文自动覆盖（不新建）
- 历史记录（500 条）+ 一键跳转至对应笔记
- 总开关 + 设置面板 + 配置导入导出

---

## 使用方法

### 操作方式

| 操作 | 效果 |
|------|------|
| 单击点赞 | 保存推文到 Obsidian / 飞书 |
| 双击点赞 | 原生点赞（不保存） |
| 脚本菜单 → 打开设置 | 配置所有选项 |
| 脚本菜单 → 历史记录 | 查看保存历史，点击跳转笔记 |

### 评论保存

进入推文详情页（URL 含 `/status/`），页面加载后回复会被自动缓存。然后单击点赞保存，设置中打开「保存评论」即可包含回复内容。

---

## 配置说明

打开设置面板（脚本菜单 → 打开设置）进行配置，或导入 `x-saver-config.json`。

### Obsidian

| 字段 | 说明 |
|------|------|
| Vault 名称 | 留空则使用默认 Vault |
| 保存文件夹 | 默认 `X收集箱`，推文保存在此目录下 |
| 使用 Advanced URI | 需安装 Obsidian Advanced URI 插件（推荐开启，支持覆盖写入） |

### 飞书多维表格

| 字段 | 说明 |
|------|------|
| App ID / App Secret | 飞书开放平台创建的应用凭证 |
| App Token | 多维表格的 Base ID（URL 中的 `GevW...` 部分） |
| Table ID | 表格 ID（URL 中的 `tbl...` 部分） |
| 字段名称 | 与多维表格实际列名保持一致 |

> **获取 App Token**：如果多维表格在飞书知识库（wiki）里，URL 中的 node token 不是 App Token。需调用飞书 API `GET /open-apis/wiki/v2/spaces/get_node?token={node_token}` 获取真正的 `obj_token`。

### 图片模式

| 模式 | 说明 |
|------|------|
| `link`（默认） | 图片直接引用 X 的 CDN 外链，无需服务器 |
| `download` | 图片备份到你的**媒体服务器**，笔记引用服务器 URL |

> **注意**：`download` 模式不是下载到本地电脑，而是下载到你配置的服务器端点（`serverEndpoint`）。服务器收到请求后把图片存储在服务器磁盘上，并返回可访问的 URL 供笔记引用。详见「媒体服务器」章节。

### 视频模式

| 模式 | 说明 |
|------|------|
| `iframe`（默认） | 嵌入 Twitter 官方 oEmbed 播放器 iframe，自适应宽度 |
| `link` | 仅插入原推文链接 |

---

## 媒体服务器（可选）

图片下载功能需要一台运行服务端脚本的服务器。

### 工作原理

```
userscript → POST /download → Flask 服务 → 下载图片到服务器磁盘
                                         → 返回 https://your-server/files/X媒体/xxx.jpg
笔记内容 → ![图片1](https://your-server/files/X媒体/xxx.jpg)
```

图片存储在**服务器**上，笔记通过 URL 引用。只要服务器在线，Obsidian 就能显示图片。

### 配置项

| 字段 | 说明 |
|------|------|
| 服务端地址 | 例如 `https://media.example.com/download` |
| 服务端 Token | 与服务器端 `TOKEN` 变量一致 |
| 媒体文件夹 | 服务器上的子目录名，默认 `X媒体` |

### 部署参考（Flask）

```python
# 需要：pip install flask requests
python3 /path/to/app.py  # 监听 127.0.0.1:18080
```

Nginx 反代示例：
```nginx
location /download {
    proxy_pass http://127.0.0.1:18080/download;
}
location /files/ {
    alias /var/www/x-media/;  # 图片实际存储目录（需 nginx 可读）
}
```

---

## 生成的笔记格式

```markdown
---
作者: "显示名 (@handle)"
账号: "@handle"
链接: "https://x.com/handle/status/..."
推文ID: "..."
发布时间: "2026-04-18 10:30"
保存时间: "2026-04-18 18:00"
点赞: "1.2K"
转发: "345"
回复: "67"
tags: ["标签1", "标签2"]
含视频: true
---

推文正文，[链接](https://example.com) 自动可点击。

![图片1](https://pbs.twimg.com/media/...)

> **[@被引用用户](https://x.com/用户)**
> 被引用推文内容
>
> [查看原推](https://x.com/...)

---
[原推文](https://x.com/...) · @handle · 2026-04-18 10:30
```

---

## 版本记录

| 版本 | 说明 |
|------|------|
| v0.0.5 | 属性名中文化、URL 可点击、GraphQL 评论缓存、图片下载修复、多项 bug 修复 |
| v0.0.4 | 服务器图片下载、飞书去重、历史记录跳转 |
| v0.0.3 | 点赞按钮拦截、评论保存、元数据面板 |
| v0.0.2 | 飞书多维表格支持、北京时间修正 |
| v0.0.1 | 初始版本，Obsidian 保存 |

---

## License

MIT · 作者：[阿成](https://github.com/acheng-byte)
