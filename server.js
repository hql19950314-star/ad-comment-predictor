/**
 * 广告评论预测系统 - 后端代理服务器 (Gemini 版)
 * 
 * 功能：
 * 1. 接收视频文件上传（支持 200MB+）
 * 2. 直接上传视频到 Gemini API（原生视频理解，无需抽帧）
 * 3. 两阶段分析：视觉理解 → 人设驱动评论生成
 * 4. 返回结构化分析结果
 * 
 * 启动：node server.js
 * 端口：默认 3000
 */

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');

// Gemini API 配置（从环境变量读取，Render 上可设置）
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'AIzaSyAzJvAFev6wwIuAT-_BCtigsGGS_rElzLA';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '200mb' }));

// 临时文件存储
const uploadDir = path.join(os.tmpdir(), 'ad-predictor-uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname) || '.mp4';
    cb(null, `video-${uniqueSuffix}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB
  fileFilter: (req, file, cb) => {
    const validTypes = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-msvideo'];
    const validExts = ['.mp4', '.mov', '.webm', '.avi'];
    const ext = path.extname(file.originalname).toLowerCase();
    
    if (validTypes.includes(file.mimetype) || validExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('不支持的文件格式，请上传 MP4/MOV/WebM/AVI 文件'));
    }
  }
});

// ── Static Files (serve index.html) ──────────────────────────────────────────────
app.use(express.static(__dirname));

// ── Health Check ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'ad-predictor-server',
    version: '2.0.0-gemini',
    timestamp: new Date().toISOString()
  });
});

// ── Redirect root to index.html ───────────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ── Video Analysis Endpoint ───────────────────────────────────────────────────
app.post('/api/analyze', upload.single('video'), async (req, res) => {
  const startTime = Date.now();
  let videoPath = null;
  
  try {
    // 验证请求
    if (!req.file) {
      return res.status(400).json({ error: '请上传视频文件' });
    }
    
    videoPath = req.file.path;
    
    console.log(`\n[${new Date().toISOString()}] 开始分析视频`);
    console.log(`文件: ${req.file.originalname}`);
    console.log(`大小: ${(req.file.size / 1024 / 1024).toFixed(2)} MB`);
    
    // Step 1: 读取视频并转 base64
    console.log('Step 1: 读取视频文件...');
    const videoBuffer = fs.readFileSync(videoPath);
    const videoBase64 = videoBuffer.toString('base64');
    const videoMimeType = req.file.mimetype || 'video/mp4';
    console.log(`视频编码完成，base64 大小: ${(videoBase64.length / 1024 / 1024).toFixed(2)} MB`);
    
    // Step 2: 调用 Gemini API
    console.log('Step 2: 调用 Gemini API 分析视频...');
    const result = await analyzeWithGemini(videoBase64, videoMimeType, req.file.originalname);
    
    // Step 3: 清理临时文件
    if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`✅ 分析完成，耗时 ${elapsed} 秒\n`);
    
    res.json({
      success: true,
      elapsed: parseFloat(elapsed),
      data: result
    });
    
  } catch (error) {
    console.error('❌ 分析失败:', error.message);
    
    // 清理临时文件
    if (videoPath && fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
    
    // 返回详细错误
    const statusCode = error.response?.status || 500;
    const errorMsg = error.response?.data?.message || error.message;
    
    res.status(statusCode).json({
      success: false,
      error: errorMsg,
      hint: getErrorHint(errorMsg)
    });
  }
});

// ═══════════════════════════════════════════════════════════════
//  Gemini API 调用 - 原生视频理解
// ═══════════════════════════════════════════════════════════════

/**
 * Gemini API 原生请求（不用 axios，直接用 https）
 */
function geminiRequest(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const options = {
      hostname: 'generativelanguage.googleapis.com',
      path: path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };
    
    const req = https.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => responseData += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(responseData);
          if (res.statusCode >= 400) {
            reject(new Error(parsed.error?.message || `HTTP ${res.statusCode}`));
          } else {
            resolve(parsed);
          }
        } catch (e) {
          reject(new Error(`解析响应失败: ${responseData.substring(0, 200)}`));
        }
      });
    });
    
    req.on('error', (e) => reject(e));
    req.write(data);
    req.end();
  });
}

/**
 * 两阶段分析：Stage 1 视觉理解 → Stage 2 评论生成
 */
async function analyzeWithGemini(videoBase64, videoMimeType, filename) {
  console.log('\n📊 开始 Gemini 两阶段分析...');
  
  // Stage 1: 视觉理解（直接上传视频）
  const visualData = await stage1_visualAnalysis(videoBase64, videoMimeType);
  
  // Stage 2: 人设驱动评论生成
  const commentData = await stage2_generateComments(visualData, filename);
  
  console.log('✅ 两阶段分析完成!\n');
  return commentData;
}

/**
 * Stage 1: 用 Gemini 直接理解视频内容
 */
async function stage1_visualAnalysis(videoBase64, videoMimeType) {
  const prompt = `你是一个冷峻的广告分析师。仔细观看这个广告视频，分析画面、声音、节奏、台词。

返回纯 JSON（不要markdown代码块）：
{
  "product": "产品/品牌名（看不出就写'未知'）",
  "category": "分类（游戏/美妆/食品/汽车/服饰/APP/教育/金融/其他）",
  "scene": "场景描述（30字内，描述视频内容和剧情）",
  "sellingPoints": ["卖点1", "卖点2", "卖点3"],
  "visualStyle": "视觉风格（如：二次元/实拍/3D渲染/手绘/拼贴等）",
  "colorTone": "主色调（如：粉紫渐变/黑白/高饱和暖色等）",
  "mood": "情绪氛围（如：热血/温馨/悬疑/搞笑/奢华等）",
  "targetAudience": "目标人群推测（如：18-25岁女性/30+男性/学生党等）",
  "adTechnique": "广告手法（如：明星代言/剧情植入/对比展示/UGC感/福利诱导等）",
  "controversialElements": ["可能引发争议的元素1", "元素2"],
  "textOnScreen": ["屏幕上的文字1", "文字2"],
  "brandMention": "是否提到品牌名（是/否/隐含）",
  "audioElements": "音频元素（BGM风格/台词关键词/音效特点）"
}`;

  console.log('  → Stage 1: 上传视频到 Gemini 分析...');
  
  const response = await geminiRequest(
    `/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      contents: [{
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType: videoMimeType,
              data: videoBase64
            }
          }
        ]
      }],
      generationConfig: {
        maxOutputTokens: 2000,
        temperature: 0.3
      }
    }
  );
  
  const text = response.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Stage 1: Gemini 返回为空');
  
  console.log('  → Stage 1 原始响应:', text.substring(0, 200) + '...');
  
  // 解析 JSON
  try {
    const cleaned = cleanJsonResponse(text);
    const result = JSON.parse(cleaned);
    console.log('  → Stage 1 完成:', result.product, '/', result.category);
    return result;
  } catch (e) {
    console.error('  → Stage 1 解析失败，原始数据:', text);
    throw new Error('Stage 1: 无法解析视觉分析结果');
  }
}

/**
 * Stage 2: 基于视觉分析结果，生成真实评论
 */
async function stage2_generateComments(visualData, filename) {
  const prompt = `你现在是抖音/B站/小红书的评论区模拟器。根据下面的广告信息，生成16条看起来完全像真人写的评论。

【广告信息】
- 产品：${visualData.product}
- 分类：${visualData.category}
- 画面描述：${visualData.scene}
- 卖点：${visualData.sellingPoints.join('、')}
- 视觉风格：${visualData.visualStyle}
- 主色调：${visualData.colorTone}
- 情绪氛围：${visualData.mood}
- 目标人群：${visualData.targetAudience}
- 广告手法：${visualData.adTechnique}
- 争议点：${visualData.controversialElements?.join('、') || '无'}
- 屏幕文字：${visualData.textOnScreen?.join('、') || '无'}
- 音频元素：${visualData.audioElements || '未知'}

【人设库 - 必须严格按这些人设写评论】

好评人设（4条，每人设1条）：
1. 「自来水」粉丝：语气激动，用大量感叹号和网络流行语，会主动安利
2. 「路人」好感：简短自然，像是随手刷到觉得不错留了一句
3. 「老用户」认可：用过类似产品的口吻，带个人体验感
4. 「审美」夸赞：关注画面美感/配色/音乐，不说产品本身

中评人设（4条，每人设1条）：
5. 「吃瓜」群众：中立吃瓜，可能提个问题或说句大实话
6. 「理性」分析：稍微分析一下但态度平和，不吹不黑
7. 「观望」用户：有点兴趣但还在犹豫，会问实际问题
8. 「对比」心态：拿别的东西做比较，语气随意

差评人设（4条，每人设1条）：
9. 「吐槽」型：毒舌但不恶毒，用反讽和段子吐槽
10. 「失望」型：期望值没达到，语气无奈
11. 「质疑」型：质疑真实性/效果/套路，带问号
12. 「无感」型：完全不感兴趣，一句话打发

恶评人设（4条，每人设1条）：
13. 「愤怒」消费者：感觉被骗过或对这类广告有强烈负面情绪
14. 「键盘侠」：攻击性强，上纲上线
15. 「跟风黑」：随大流骂，话不多但每句都扎心
16. 「阴阳怪气」：表面客气实际讽刺，高级黑

【写作规则 - 极其重要】
1. 每条评论必须像一个真人在手机上打出来的，不是AI写的文案
2. 禁止出现以下AI味词汇：堪称、封神、绝绝子、yyds（除非是特定人设）、不得不说、令人惊艳、眼前一亮、不得不赞、简直、无疑
3. 好评不要写成软文！真人好评通常是短句、口语化、可能有错别字或表情符号
4. 差评要有具体的吐槽点，不能泛泛地说"不好"
5. 可以包含：emoji、网络用语、缩写、口语、偶尔的语法不规范
6. 长度：大多数在5-40字之间，极少数可以长一点
7. 不要每条都提产品名，真人有时候会说"这个""它""这玩意儿"
8. likes 数值要合理分布：好评 500-8000，中评 80-1500，差评 50-800，恶评 30-500

返回纯 JSON（不要markdown代码块）：
{
  "analysis": {
    "adType": "${visualData.category}广告",
    "product": "${visualData.product}",
    "audience": "${visualData.targetAudience}",
    "tone": "${visualData.mood}",
    "keyElements": ${JSON.stringify(visualData.sellingPoints)},
    "riskPoints": ${JSON.stringify(visualData.controversialElements || [])},
    "summary": "基于画面分析的摘要"
  },
  "scores": {"good": 75, "mid": 12, "bad": 8, "evil": 5},
  "good": [{"text": "好评1", "likes": 数字}, {"text": "好评2", "likes": 数字}, {"text": "好评3", "likes": 数字}, {"text": "好评4", "likes": 数字}],
  "mid": [{"text": "中评1", "likes": 数字}, {"text": "中评2", "likes": 数字}, {"text": "中评3", "likes": 数字}, {"text": "中评4", "likes": 数字}],
  "bad": [{"text": "差评1", "likes": 数字}, {"text": "差评2", "likes": 数字}, {"text": "差评3", "likes": 数字}, {"text": "差评4", "likes": 数字}],
  "evil": [{"text": "恶评1", "likes": 数字}, {"text": "恶评2", "likes": 数字}, {"text": "恶评3", "likes": 数字}, {"text": "恶评4", "likes": 数字}],
  "risks": ["风险1", "风险2"],
  "suggestions": ["建议1", "建议2"]
}`;

  console.log('  → Stage 2: 调用 Gemini 生成评论...');
  
  const response = await geminiRequest(
    `/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: 4000,
        temperature: 0.9
      }
    }
  );
  
  const text = response.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Stage 2: 评论生成返回为空');
  
  console.log('  → Stage 2 评论预览:', text.substring(0, 150) + '...');
  
  // 解析 JSON
  try {
    const cleaned = cleanJsonResponse(text);
    return JSON.parse(cleaned);
  } catch (e) {
    console.error('  → Stage 2 解析失败，原始数据:', text.substring(0, 500));
    throw new Error('Stage 2: 无法解析评论数据');
  }
}

/**
 * 清理 AI 返回的 JSON（去除 markdown 代码块等）
 */
function cleanJsonResponse(text) {
  if (typeof text !== 'string') return text;
  // 尝试从 markdown 代码块提取
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (match) return match[1].trim();
  // 尝试找到最外层 JSON 对象
  const objMatch = text.match(/(\{[\s\S]*\})/);
  if (objMatch) return objMatch[1].trim();
  return text.trim();
}

/**
 * 错误提示
 */
function getErrorHint(errorMsg) {
  if (errorMsg.includes('PERMISSION_DENIED') || errorMsg.includes('denied access')) {
    return 'Gemini API 访问被拒绝，请检查 API Key 权限';
  }
  if (errorMsg.includes('RESOURCE_EXHAUSTED') || errorMsg.includes('quota')) {
    return 'Gemini API 配额用尽，请检查账单或等待配额恢复';
  }
  if (errorMsg.includes('UNAVAILABLE') || errorMsg.includes('high demand')) {
    return 'Gemini 服务繁忙，请稍后重试';
  }
  if (errorMsg.includes('timeout') || errorMsg.includes('超时')) {
    return '请求超时，视频可能过大，请尝试压缩后重试';
  }
  return '请检查网络连接或联系管理员';
}

// ── Start Server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('\n╔════════════════════════════════════════════╗');
  console.log('║   🎬 广告评论预测系统 - Gemini 版          ║');
  console.log('╠════════════════════════════════════════════╣');
  console.log(`║   地址: http://localhost:${PORT.toString().padEnd(20)}║`);
  console.log('║   状态: 运行中                              ║');
  console.log('║   支持视频大小: 最大 200MB                  ║');
  console.log(`║   Gemini 模型: ${GEMINI_MODEL.padEnd(24)}║`);
  console.log('╚════════════════════════════════════════════╝\n');
  console.log('API 端点:');
  console.log(`  GET  http://localhost:${PORT}/health`);
  console.log(`  POST http://localhost:${PORT}/api/analyze`);
  console.log('\n按 Ctrl+C 停止服务器\n');
});
