/**
 * 繁星-视频分析 - 后端服务器 (Gemini 版)
 *
 * 功能：
 * 1. 接收视频文件上传（支持 200MB+）
 * 2. Gemini 原生视频理解（无需抽帧）
 * 3. Stage 1: 视觉结构化分析
 * 4. Stage 2: 按用户模板生成 Seedance 2.0 提示词
 * 5. 舆情风险评估
 */

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error('❌ 错误: 未设置 GEMINI_API_KEY 环境变量');
  process.exit(1);
}
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '200mb' }));

const uploadDir = path.join(os.tmpdir(), 'star-video-uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.mp4';
    cb(null, `video-${Date.now()}-${Math.round(Math.random() * 1E9)}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const validExts = ['.mp4', '.mov', '.webm', '.avi'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (validExts.includes(ext) || file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('不支持的文件格式，请上传 MP4/MOV/WebM/AVI'));
    }
  }
});

// ── Static Files ─────────────────────────────────────────────────────────────
app.use(express.static(__dirname));

// ── Health ───────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'star-video-analyzer', version: '3.0.0', timestamp: new Date().toISOString() });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ── Analyze Endpoint ─────────────────────────────────────────────────────────
app.post('/api/analyze', upload.single('video'), async (req, res) => {
  const startTime = Date.now();
  let videoPath = null;

  try {
    if (!req.file) return res.status(400).json({ error: '请上传视频文件' });
    videoPath = req.file.path;

    // 解析请求体（Prompt 模板）
    let userPromptTemplate = null;
    try {
      if (req.body.promptTemplate) {
        userPromptTemplate = JSON.parse(req.body.promptTemplate);
      }
    } catch (e) {
      // ignore
    }

    console.log(`\n[${new Date().toISOString()}] 🌟 繁星视频分析开始`);
    console.log(`文件: ${req.file.originalname} (${(req.file.size / 1024 / 1024).toFixed(2)} MB)`);

    // Step 1: 读取视频
    console.log('Step 1: 读取视频文件...');
    const videoBuffer = fs.readFileSync(videoPath);
    const videoBase64 = videoBuffer.toString('base64');
    const videoMimeType = req.file.mimetype || 'video/mp4';

    // Step 2: Stage 1 视觉分析
    console.log('Step 2: Stage 1 视觉分析...');
    const visualData = await stage1_visualAnalysis(videoBase64, videoMimeType);

    // Step 3: Stage 2 生成 Seedance 提示词 + 舆情风险
    console.log('Step 3: Stage 2 生成提示词与舆情评估...');
    const result = await stage2_generatePromptAndRisk(visualData, userPromptTemplate);

    // 清理临时文件
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
    if (videoPath && fs.existsSync(videoPath)) fs.unlinkSync(videoPath);

    const statusCode = error.response?.status || 500;
    res.status(statusCode).json({
      success: false,
      error: error.message,
      hint: getErrorHint(error.message)
    });
  }
});

// ═══════════════════════════════════════════════════════════════
//  Gemini API 调用
// ═══════════════════════════════════════════════════════════════

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
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function cleanJsonResponse(text) {
  if (typeof text !== 'string') return text;
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (match) return match[1].trim();
  const objMatch = text.match(/(\{[\s\S]*\})/);
  if (objMatch) return objMatch[1].trim();
  return text.trim();
}

function getErrorHint(msg) {
  if (msg.includes('PERMISSION_DENIED')) return 'Gemini API 访问被拒绝，请检查 API Key';
  if (msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota')) return 'API 配额用尽，请检查账单或稍后重试';
  if (msg.includes('UNAVAILABLE') || msg.includes('high demand')) return 'Gemini 服务繁忙，请稍后重试';
  if (msg.includes('timeout')) return '请求超时，视频可能过大，请尝试压缩后重试';
  return '请检查网络连接或稍后重试';
}

// ── Stage 1: 视觉结构化分析 ─────────────────────────────────────────────────
async function stage1_visualAnalysis(videoBase64, videoMimeType) {
  const prompt = `你是一个专业的广告与视频内容分析师。仔细观看这个视频，从内容创作和营销角度进行深度分析。

返回纯 JSON（不要 markdown 代码块）：
{
  "product": "产品/品牌名（看不出写'未知'）",
  "category": "分类（游戏/美妆/食品/汽车/服饰/APP/教育/金融/电商/其他）",
  "scene": "场景描述（20字内）",
  "mainContent": "视频主要内容和剧情（50字内）",
  "sellingPoints": ["核心卖点1", "卖点2", "卖点3"],
  "visualStyle": "视觉风格（二次元/实拍/3D渲染/手绘/拼贴/电影感/纪录片风格等）",
  "colorTone": "主色调描述",
  "mood": "情绪氛围（热血/温馨/悬疑/搞笑/奢华/小清新/强节奏/感人等）",
  "targetAudience": "目标人群（年龄+性别+特征）",
  "adTechnique": "广告手法（明星代言/剧情植入/对比展示/UGC感/福利诱导/情感共鸣/悬念营销等）",
  "controversialElements": ["可能引发争议的元素1", "元素2（没有写[]）"],
  "textOnScreen": ["屏幕文字1", "文字2（没有写[]）"],
  "audioElements": "音频特点（BGM风格/有无台词/口播关键词）",
  "shotComposition": "镜头构成（固定/手持/运镜/特写+全景组合等）",
  "videoQuality": "制作质量（专业TVC/UGC感/短视频风/微电影等）"
}`;

  const response = await geminiRequest(
    `/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      contents: [{
        parts: [
          { text: prompt },
          { inlineData: { mimeType: videoMimeType, data: videoBase64 } }
        ]
      }],
      generationConfig: { maxOutputTokens: 2000, temperature: 0.3 }
    }
  );

  const text = response.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Stage 1: Gemini 返回为空');

  try {
    const result = JSON.parse(cleanJsonResponse(text));
    console.log(`  → Stage 1 完成: ${result.product} / ${result.category} / ${result.visualStyle}`);
    return result;
  } catch (e) {
    console.error('  → Stage 1 解析失败:', text.substring(0, 300));
    throw new Error('Stage 1: 无法解析视觉分析结果');
  }
}

// ── Stage 2: 生成 Seedance 提示词 + 舆情风险评估 ─────────────────────────────
async function stage2_generatePromptAndRisk(visualData, userTemplate) {
  // 默认 Seedance 2.0 提示词模板
  const defaultTemplate = {
    name: 'Seedance 2.0 标准模板',
    template: `@图片1作为主体角色，@图片2（可选）作为次要角色或背景参考，\n@视频1作为镜头语言与运镜参考，\n@音频1作为背景音乐或配音参考，\n在[场景描述]中进行[主要动作/剧情]，\n[BGM风格]背景音乐，[色调描述]色调，[视觉风格]视觉风格，\n[额外描述：如镜头运动/表情特写/光影效果/氛围等]`
  };

  const template = userTemplate || defaultTemplate;

  const stage2Prompt = `你是一个顶尖的广告创意分析师和 AI 视频提示词工程师。

【视频分析结果】
- 产品：${visualData.product}
- 分类：${visualData.category}
- 场景：${visualData.scene}
- 主要内容：${visualData.mainContent}
- 卖点：${visualData.sellingPoints.join('、')}
- 视觉风格：${visualData.visualStyle}
- 主色调：${visualData.colorTone}
- 情绪氛围：${visualData.mood}
- 目标人群：${visualData.targetAudience}
- 广告手法：${visualData.adTechnique}
- 争议点：${visualData.controversialElements?.join('、') || '无'}
- 镜头构成：${visualData.shotComposition}
- 制作质量：${visualData.videoQuality}
- 音频特点：${visualData.audioElements}

【你的任务】
1. 根据分析结果，套用用户提供的提示词模板，生成完整的 Seedance 2.0 视频生成提示词
2. 评估这条视频内容在网络上的舆情风险

【用户提示词模板】
模板名称：${template.name}
模板内容：
${template.template}

【Seedance 提示词写作规范】
- 用自然流畅的中文描述视频画面和动作
- 融入 ${visualData.sellingPoints.join('、')} 等核心卖点
- 风格描述使用 ${visualData.visualStyle} + ${visualData.mood}
- 色调使用 ${visualData.colorTone}
- 注意运镜方式（${visualData.shotComposition}）
- 可加入光影、色温、构图等高级描述词
- 确保描述具体生动，适合 AI 视频模型理解

返回纯 JSON（不要 markdown 代码块）：
{
  "seedancePrompt": "生成的完整 Seedance 2.0 提示词（一段完整、流畅、自然的中文描述，无markdown符号）",
  "promptBreakdown": {
    "主体": "主体描述",
    "场景": "场景描述",
    "动作": "主要动作",
    "风格": "风格描述",
    "色调": "色调描述",
    "运镜": "运镜描述",
    "音乐": "音乐描述"
  },
  "riskAssessment": {
    "overall": "低风险/中风险/高风险",
    "score": 数字(0-100，越高越危险),
    "factors": ["风险因素1", "风险因素2"]
  },
  "舆情建议": ["舆情优化建议1", "建议2"]
}`;

  console.log('  → Stage 2: 生成 Seedance 提示词...');

  const response = await geminiRequest(
    `/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      contents: [{ parts: [{ text: stage2Prompt }] }],
      generationConfig: { maxOutputTokens: 4000, temperature: 0.7 }
    }
  );

  const text = response.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Stage 2: 生成返回为空');

  try {
    const result = JSON.parse(cleanJsonResponse(text));
    console.log('  → Stage 2 完成，提示词预览:', result.seedancePrompt?.substring(0, 80) + '...');
    return {
      visual: visualData,
      seedancePrompt: result.seedancePrompt,
      promptBreakdown: result.promptBreakdown || {},
      riskAssessment: result.riskAssessment || { overall: '未知', score: 50, factors: [] },
      suggestions: result.舆情建议 || []
    };
  } catch (e) {
    console.error('  → Stage 2 解析失败:', text.substring(0, 500));
    throw new Error('Stage 2: 无法解析生成结果');
  }
}

// ── Start ───────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('\n╔════════════════════════════════════════════╗');
  console.log('║   🌟 繁星-视频分析  Gemini 版              ║');
  console.log('╠════════════════════════════════════════════╣');
  console.log(`║   地址: http://localhost:${PORT.toString().padEnd(20)}║`);
  console.log('║   模型: ' + GEMINI_MODEL.padEnd(32) + '║');
  console.log('╚════════════════════════════════════════════╝\n');
});
