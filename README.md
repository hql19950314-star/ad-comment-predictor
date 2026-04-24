# 广告评论预测系统 - 服务端版

支持大视频文件（最大 200MB）的后端代理版本。

## 📦 文件说明

```
ad-predictor-server/
├── package.json    # Node.js 依赖配置
├── server.js       # 后端服务器
├── index.html      # 前端界面
└── README.md       # 本文件
```

## 🚀 快速开始

### 1. 安装依赖

```powershell
cd C:\Users\WinOS\.qclaw\workspace\ad-predictor-server
npm install
```

### 2. 安装 FFmpeg

本程序依赖 FFmpeg 提取视频帧。

**Windows 安装方式（推荐）：**

```powershell
# 使用 winget（Windows 10/11 自带）
winget install Gyan.FFmpeg

# 或者使用 Chocolatey
choco install ffmpeg
```

**手动安装：**
1. 访问 https://www.gyan.dev/ffmpeg/builds/
2. 下载 "ffmpeg-release-essentials.zip"
3. 解压到 `C:\ffmpeg`
4. 添加 `C:\ffmpeg\bin` 到系统 PATH

**验证安装：**
```powershell
ffmpeg -version
```

### 3. 启动服务器

```powershell
npm start
```

看到以下输出表示启动成功：

```
╔════════════════════════════════════════════╗
║   🎬 广告评论预测系统 - 后端代理服务器     ║
╠════════════════════════════════════════════╣
║   地址: http://localhost:3000              ║
║   状态: 运行中                              ║
║   支持视频大小: 最大 200MB                 ║
╚════════════════════════════════════════════╝
```

### 4. 打开前端界面

直接双击打开 `index.html`，或在浏览器访问：

```
file:///C:/Users/WinOS/.qclaw/workspace/ad-predictor-server/index.html
```

## 🔧 配置 API Key

### 方式一：前端配置

1. 打开网页，点击右上角 ⚙️ 设置
2. 输入阿里云百炼 API Key
3. 点击保存

### 方式二：环境变量

```powershell
# Windows PowerShell（临时）
$env:QWEN_API_KEY="你的API Key"
npm start

# Windows CMD（临时）
set QWEN_API_KEY=你的API Key
npm start
```

## 📝 API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查 |
| POST | `/api/analyze` | 分析视频 |

### 示例请求

```bash
# 测试服务器状态
curl http://localhost:3000/health

# 分析视频
curl -X POST http://localhost:3000/api/analyze \
  -H "x-api-key: 你的API Key" \
  -F "video=@test.mp4"
```

## ⚠️ 常见问题

### FFmpeg not found

```
Error: spawn ffmpeg ENOENT
```

**解决：** 安装 FFmpeg 并添加到 PATH，或重启终端/电脑。

### 端口被占用

```
Error: listen EADDRINUSE: address already in use :::3000
```

**解决：** 修改端口：

```powershell
$env:PORT=3001
npm start
```

### API Key 无效

```
InvalidApiKey: Invalid API key provided
```

**解决：** 检查 API Key 是否正确复制，在 https://bailian.console.aliyun.com 重新获取。

### 视频提取帧失败

```
无法从视频中提取画面
```

**解决：**
- 确认视频文件有效（用播放器能正常播放）
- 尝试转换格式（用 HandBrake 转成 MP4 H.264）
- 检查视频编码是否受支持

## 🔒 安全说明

- API Key 存储在浏览器 localStorage，仅本机可访问
- 服务器默认监听 localhost，外部无法访问
- 生产环境建议添加认证和 HTTPS

## 📊 支持的视频格式

| 格式 | 扩展名 | 支持情况 |
|------|--------|----------|
| MP4 | .mp4 | ✅ 最佳 |
| MOV | .mov | ✅ 良好 |
| WebM | .webm | ✅ 良好 |
| AVI | .avi | ⚠️ 依赖编码 |

## 🛠️ 技术栈

- **后端**: Node.js + Express
- **视频处理**: FFmpeg + fluent-ffmpeg
- **AI 模型**: 阿里云百炼 Qwen-VL-Max
- **前端**: 纯 HTML/CSS/JS（无需构建）

---

有问题随时反馈！🎉
