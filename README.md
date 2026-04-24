# ✨ 繁星-视频分析

Gemini 原生视频理解 + Seedance 2.0 提示词生成 + 舆情风险评估。

## 文件结构

```
ad-predictor-server/
├── package.json   # Node.js 依赖
├── server.js      # 后端服务（Gemini 视频分析）
├── index.html     # 前端界面
├── README.md
└── railway.json
```

## 快速开始

### 本地运行

```powershell
cd C:\Users\WinOS\.qclaw\workspace\ad-predictor-server
npm install
# 设置 API Key
$env:GEMINI_API_KEY="your_key"
npm start
# 浏览器打开 http://localhost:3000
```

### Railway 部署

1. Fork 或上传代码到 GitHub 仓库
2. 在 [Railway](https://railway.app) 创建新项目，关联 GitHub
3. 在项目 Variables 中添加 `GEMINI_API_KEY` 环境变量
4. 部署完成后访问 `https://你的项目名-production.up.railway.app`

## 主要功能

- 🎬 **视频 AI 分析** — Gemini 原生理解，无需抽帧
- ✨ **Seedance 提示词** — 自动生成可用的 Seedance 2.0 提示词
- 📝 **自定义模板** — 用户可上传自己的提示词模板
- 🛡️ **舆情风险评估** — 预测视频发布后的舆论风险

## API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查 |
| POST | `/api/analyze` | 分析视频 |

## 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `GEMINI_API_KEY` | ✅ | Google AI Studio API Key |
| `GEMINI_MODEL` | ❌ | 模型名称（默认 gemini-2.5-flash-lite）|
| `PORT` | ❌ | 端口（默认 3000）|

## 技术栈

- **后端**: Node.js + Express + Multer
- **AI**: Google Gemini（原生的视频理解）
- **前端**: 纯 HTML/CSS/JS

## Seedance 2.0 提示词格式

工具生成的提示词遵循 Seedance 2.0 的 `@素材标记` 语法：

```
@图片1作为主体角色，
@视频1作为镜头语言参考，
在{场景}中进行视频创作，
{视觉风格}，{色调}，{氛围}，
{运镜}，核心卖点：{卖点}，
{背景音乐}
```
