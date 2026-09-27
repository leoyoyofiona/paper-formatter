# 论文一键排版助手 · Render 部署

单文件纯前端应用，部署为 Render 静态站点即可。

## 部署步骤

1. 在 GitHub 新建一个仓库（例如 `paper-formatter`），把本目录的 3 个文件
   （`index.html`、`render.yaml`、`README.md`）传上去（网页端直接拖拽上传即可）。
2. 打开 [Render Dashboard](https://dashboard.render.com/) → **New** → **Blueprint**，
   选择刚才的仓库 → **Apply**。
3. 等待部署完成，得到地址 `https://paper-formatter.onrender.com`，打开即用。

备选（不用 Blueprint）：Render → **New** → **Static Site** → 选择仓库，
Build Command 留空，Publish Directory 填 `.` → Create Static Site。

## 说明

- 论文只在浏览器本地处理，不上传到服务器；Render 只负责下发这个 HTML 文件。
- 静态站点在免费额度内不会休眠，打开即用。
- 以后更新版本时，把新的 `index.html` 推到仓库，Render 会自动重新部署。
