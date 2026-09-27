# 论文一键排版助手（网页版）v1.10.0

浏览器打开即用。论文只在本地浏览器处理，不上传服务器。

## 使用

- **在线版**：https://paper-formatter-59aq.onrender.com —— 支持「输入期刊名 → 在线查找」：联网搜索期刊官网投稿须知、抓取解析（带来源标注），核对后可保存为模板
- **单文件离线版**：`dist/paper-formatter-standalone.html`（237KB，零依赖，离线双击即用，方便转发；离线打开时「在线查找」不可用，会提示改用在线版或手动粘贴）

## 功能

1. 粘贴投稿须知（中/英文）→ 自动解析 → 要求清单确认 → 一键排版
2. 输入期刊名 → **在线查找**（联网搜官网投稿须知→抓取→解析→确认→保存为模板）或按内置规则推荐通用模板+参考文献格式
3. 内置 4 套模板：中文学术期刊通用、中文课程论文/学位论文、APA 7th、英文期刊通用
4. 参考文献：9 种标准库（GB/T 7714、APA 7th、MLA 9th、Chicago 17th、IEEE、Vancouver、Harvard、AMA 11th），手动选+示例预览；自动推荐（期刊/投稿须知/学科）；格式转换（低置信度条目不转、只标注）
5. 格式检查：图片 DPI、图表引用双向核对、参考文献双向核对+编号连续性、字数卡线、标点混用、声明缺失、公式编号连续性
6. 一键生成：匿名审稿版（候选勾选确认+清文档作者属性）、审稿行号、标题页
7. 导出 docx；PDF 通过浏览器"打印→另存为 PDF"（有文字指引）

## 在线版后端（server/index.js，零依赖）

在线版由 Node 服务同时提供静态页面与 API：

- `GET /api/search?q=期刊名` —— 后端联网搜索投稿须知候选页（标题/网址/摘要 JSON）
- `GET /api/fetch?url=...` —— 抓取页面正文文本（JSON，含 SSRF 防护：仅 http/https、禁内网 IP、跳转逐跳检查、超时与大小限制）

```bash
node server/index.js        # 本地启动，PORT 环境变量指定端口
```

## 开发

```bash
node build.mjs          # 打包 dist/paper-formatter-standalone.html
node tests/test-logic.mjs   # 纯逻辑单元测试（28项）
```

端到端测试 `tests/test-docx-e2e.mjs` 需 jsdom + jszip（`npm i jsdom jszip` 后 `node tests/test-docx-e2e.mjs`，24项）。

## 注意事项

- 在线查找依赖后端联网搜索+抓取：搜不到、抓取失败时会明确报错并提示手动粘贴；解析结果必须人工核对后才生效，绝不按期刊名编造具体格式要求。
- docx 采用保守写法，WPS/Office 均可打开；不承诺两者像素级一致。
- 参考文献转换绝不编造信息；解析不确定的条目保留原文并标注。
