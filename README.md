# 寻找卧底AI

一个独立网页游戏：一局 3–6 个角色，其中只有 1 个是「潜伏的 AI（卧底）」，其余角色都坚信自己是人类。通过轮流发言和投票，把卧底揪出来。

- **参与模式**：你 + 2–5 个 AI，你是人类之一，亲手打字、投票找出卧底。
- **观战模式**：3–6 个纯 AI 自动互演，你全程零操作。
- **纯静态**：原生 HTML/CSS/JS，零依赖；浏览器**直连 DeepSeek 官方 API**（官方已支持 CORS），无需后端。
- **玩家自带 Key**：每个玩家粘贴自己的 DeepSeek API Key，只存各自浏览器本地，费用各自承担。

## 在线玩（推荐）

部署到 GitHub Pages 后，朋友直接打开链接即可玩，**不需要你的文件夹、不需要启动任何服务**。

部署方法见下方「[部署到 GitHub Pages](#部署到-github-pages)」。

## 本地预览

需要 Node.js（18+，推荐 20/24）。仅用于本地打开页面：

```sh
node server.mjs
```

浏览器打开 **http://127.0.0.1:8787**，粘贴你的 DeepSeek API Key（仅存浏览器 localStorage），点「开始游戏」。

> 游戏本身是纯静态页面，`server.mjs` 只是个静态文件服务器；浏览器里的 API 请求是**直连 `https://api.deepseek.com`** 的，不经过这个服务器。

## 部署到 GitHub Pages

### 方式 A · 网页上传（零门槛，无需 git）

1. 登录 github.com → 新建一个仓库（比如 `undercover-ai`，设为 Public）。
2. 进仓库 → **Add file → Upload files** → 把本目录 `public/` **文件夹里的内容**（`index.html`、`style.css`、`js/`、`.nojekyll`）全部拖进去 → Commit。
3. **Settings → Pages** → Source 选 **Deploy from a branch** → 分支 `main`、目录 **`/ (root)`** → Save。
4. 等 1–2 分钟，得到 `https://<你的用户名>.github.io/<仓库名>/`，发给朋友即可。

### 方式 B · 自动化（适合会 git / GitHub Desktop 的人）

1. 把整个项目推到一个 GitHub 仓库的 `main` 分支（已含 `.github/workflows/pages.yml`）。
2. **Settings → Pages** → Source 选 **GitHub Actions**。
3. 之后每次 `push` 到 `main` 都会自动发布，无需手动上传。

## 目录结构

```
server.mjs              本地静态预览服务器（可选）
public/                 网站根目录（部署的就是这里）
  index.html            三屏：设置 / 游戏 / 揭晓
  style.css
  .nojekyll             防止 GitHub Pages 用 Jekyll 处理
  js/game.js            纯逻辑状态机（可单测）
  js/prompts.js         提示词构造器
  js/api.js             DeepSeek 流式/非流式客户端（直连官方）
  js/characters.js      候选名、性格预设、头像配色
  js/store.js           localStorage（Key/模型/设置/战绩/断线续玩）
  js/ui.js              渲染与异步游戏循环
tests/logic.test.mjs    单元测试
.github/workflows/pages.yml   方式 B 的自动部署工作流
```

## 测试

```sh
node --test tests/logic.test.mjs
```

## 玩法与规则

1. 开局随机抽 1 名 AI 为卧底（只有它知道自己身份），全员只看到名字和头像。
2. 每轮每个存活角色轮流发言（AI 流式打字，像真人在敲字）。
3. 每 N 轮（默认 3，可配 1–5）投一次票，每人给出 ≤40 字理由；得票 >50% 者淘汰，无人过半则从并列最高票随机淘汰 1 人。
4. 被淘汰者留下一句遗言。
5. 胜负：卧底被投出 → 人类胜；卧底活到只剩 2 人 → AI 胜。
6. 揭晓后可为卧底与各角色生成复盘（可选，省 token 可跳过）。

## 配置

| 项 | 说明 |
|---|---|
| 模式 | 参与 / 观战 |
| 总人数 | 3–6 |
| 角色 | 名字（一键候选：汐汐/阿狸/阿冷/小满/阿凯/露露/星野/七夜）+ 性格（高冷/话痨/毒舌/温柔/中二/老实，可自定义） |
| 发言长度 | 极简25 / 简短60 / 中等120 / 长篇300 字，或 10–500 手动 |
| 投票间隔 | 每 1–5 轮一次（间隔越大越省 token） |
| API Key | 仅存浏览器 localStorage，直连 DeepSeek 官方；失败只提示，不碰你的数据 |
| 模型 | 默认 `deepseek-chat`，可改 |

## 隐私与安全

- 游戏是**纯静态**页面，浏览器**直连 `https://api.deepseek.com`**，请求不经过任何第三方服务器。
- API Key 只存在每个玩家自己的浏览器 localStorage，随每次请求由浏览器直接发给 DeepSeek 官方。
- 没有任何后端、不收集、不上传任何数据。
