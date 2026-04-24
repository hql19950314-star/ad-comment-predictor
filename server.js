/**
 * 繁星-视频分析 - 后端服务器 v4.0 (Gemini 版)
 *
 * 功能：
 * 1. 接收视频文件上传（支持 200MB+）
 * 2. Gemini 原生视频理解（无需抽帧）
 * 3. Stage 1: 视觉结构化分析 + 时间轴分节点（台词/旁白/画面）
 * 4. Stage 2: 按时间节点生成 Seedance 2.0 提示词 + 舆情风险评估
 * 5. Stage 3: 提示词发射 — 按画风/优化方向重新生成
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
  res.json({ status: 'ok', service: 'star-video-analyzer', version: '4.0.0', timestamp: new Date().toISOString() });
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

    let userPromptTemplate = null;
    try {
      if (req.body.promptTemplate) userPromptTemplate = JSON.parse(req.body.promptTemplate);
    } catch (e) { /* ignore */ }

    console.log(`\n[${new Date().toISOString()}] 🌟 繁星视频分析开始`);
    console.log(`文件: ${req.file.originalname} (${(req.file.size / 1024 / 1024).toFixed(2)} MB)`);

    // Step 1: 读取视频
    console.log('Step 1: 读取视频文件...');
    const videoBuffer = fs.readFileSync(videoPath);
    const videoBase64 = videoBuffer.toString('base64');
    const videoMimeType = req.file.mimetype || 'video/mp4';

    // Step 2: Stage 1 视觉分析（含时间轴）
    console.log('Step 2: Stage 1 视觉分析 + 时间轴...');
    const analysisData = await stage1_visualAnalysis(videoBase64, videoMimeType);

    // Step 3: Stage 2 生成提示词 + 舆情
    console.log('Step 3: Stage 2 生成时间轴提示词与舆情评估...');
    const result = await stage2_generatePromptAndRisk(analysisData, userPromptTemplate);

    // 清理
    if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`✅ 分析完成，耗时 ${elapsed} 秒\n`);

    res.json({ success: true, elapsed: parseFloat(elapsed), data: result });

  } catch (error) {
    console.error('❌ 分析失败:', error.message);
    if (videoPath && fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
    const statusCode = error.response?.status || 500;
    res.status(statusCode).json({ success: false, error: error.message, hint: getErrorHint(error.message) });
  }
});

// ── Prompt Launch Endpoint (Stage 3) ────────────────────────────────────────
app.post('/api/launch', async (req, res) => {
  try {
    const { visualData, timeline, originalPrompt, artStyle, optimizeDirections, userTemplate } = req.body;
    if (!visualData || !timeline || !artStyle) {
      return res.status(400).json({ error: '缺少必要参数' });
    }

    console.log(`\n[${new Date().toISOString()}] 🚀 提示词发射`);
    console.log(`画风: ${artStyle}, 优化: ${(optimizeDirections || []).join(', ')}`);

    const result = await stage3_launchPrompt(visualData, timeline, originalPrompt, artStyle, optimizeDirections || [], userTemplate);

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('❌ 发射失败:', error.message);
    res.status(500).json({ success: false, error: error.message });
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
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
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

// ── Stage 1: 视觉结构化分析 + 时间轴 ────────────────────────────────────────
async function stage1_visualAnalysis(videoBase64, videoMimeType) {
  const prompt = `你是一个专业的广告与视频内容分析师。仔细观看这个视频，从内容创作和营销角度进行深度分析。

【重要】你需要按视频的时间节点逐一分析，每个时间节点包含：时间区间、画面描述、人物台词/旁白/口播内容、动作描述。

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
  "videoQuality": "制作质量（专业TVC/UGC感/短视频风/微电影等）",
  "timeline": [
    {
      "timeRange": "0:00-0:03",
      "scene": "这个时间段的场景描述",
      "visual": "画面内容描述（人物、动作、表情、环境等）",
      "dialogue": "这个时间段人物的台词/旁白/口播内容（没有则写空字符串）",
      "action": "主要动作和运动描述",
      "camera": "镜头运动（推/拉/摇/移/固定/特写等）",
      "emotion": "这个时间段的情绪氛围"
    },
    {
      "timeRange": "0:03-0:08",
      "scene": "...",
      "visual": "...",
      "dialogue": "...",
      "action": "...",
      "camera": "...",
      "emotion": "..."
    }
  ]
}

注意：
- timeline 至少分4-8个节点，根据视频实际时长和内容变化来划分
- 每个节点必须精确到时间区间（如"0:05-0:12"）
- dialogue 字段必须写出人物说的台词、旁白、或口播的原文（尽量还原原话）
- 如果某段没有台词/旁白，dialogue 写空字符串""`;

  const response = await geminiRequest(
    `/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType: videoMimeType, data: videoBase64 } }] }],
      generationConfig: { maxOutputTokens: 4000, temperature: 0.3 }
    }
  );

  const text = response.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Stage 1: Gemini 返回为空');

  try {
    const result = JSON.parse(cleanJsonResponse(text));
    console.log(`  → Stage 1 完成: ${result.product} / ${result.category} / 时间轴${result.timeline?.length || 0}节点`);
    return result;
  } catch (e) {
    console.error('  → Stage 1 解析失败:', text.substring(0, 300));
    throw new Error('Stage 1: 无法解析视觉分析结果');
  }
}

// ── Stage 2: 生成时间轴提示词 + 舆情风险评估 ───────────────────────────────
async function stage2_generatePromptAndRisk(visualData, userTemplate) {
  const defaultTemplate = {
    name: 'Seedance 2.0 标准模板',
    template: `@图片1作为主体角色，@图片2（可选）作为次要角色或背景参考，\n@视频1作为镜头语言与运镜参考，\n@音频1作为背景音乐或配音参考，\n在[场景描述]中进行[主要动作/剧情]，\n[BGM风格]背景音乐，[色调描述]色调，[视觉风格]视觉风格，\n[额外描述：如镜头运动/表情特写/光影效果/氛围等]`
  };

  const template = userTemplate || defaultTemplate;
  const timelineStr = (visualData.timeline || []).map((t, i) =>
    `  节点${i+1} [${t.timeRange}]:\n    画面: ${t.visual}\n    台词/旁白: ${t.dialogue || '（无）'}\n    动作: ${t.action}\n    镜头: ${t.camera}\n    情绪: ${t.emotion}`
  ).join('\n');

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

【时间轴分析】
${timelineStr}

【你的任务】
1. 根据时间轴的每个节点，生成对应时间段的 Seedance 2.0 提示词，确保提示词与该时间段的台词/旁白、画面、动作精确匹配
2. 生成一段整体提示词，将所有节点串联成流畅的完整视频描述
3. 评估舆情风险

【用户提示词模板】
模板名称：${template.name}
模板内容：
${template.template}

【Seedance 提示词写作规范】
- 每个时间节点的提示词必须包含：该节点的场景、人物动作、台词旁白对应的画面感、镜头运动、色调和氛围
- 用自然流畅的中文描述，融入核心卖点
- 确保描述具体生动，适合 AI 视频模型理解
- 时间节点之间的提示词要有过渡和连贯性

返回纯 JSON（不要 markdown 代码块）：
{
  "timelinePrompts": [
    {
      "timeRange": "0:00-0:03",
      "prompt": "该时间段的 Seedance 提示词，包含画面、动作、台词对应画面感、镜头、氛围等"
    }
  ],
  "seedancePrompt": "完整的 Seedance 2.0 提示词，将所有时间节点串联为一段完整、流畅、自然的中文描述，无markdown符号",
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
    "score": 30,
    "factors": ["风险因素1", "风险因素2"]
  },
  "舆情建议": ["舆情优化建议1", "建议2"]
}`;

  console.log('  → Stage 2: 生成时间轴提示词...');

  const response = await geminiRequest(
    `/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      contents: [{ parts: [{ text: stage2Prompt }] }],
      generationConfig: { maxOutputTokens: 6000, temperature: 0.7 }
    }
  );

  const text = response.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Stage 2: 生成返回为空');

  try {
    const result = JSON.parse(cleanJsonResponse(text));
    console.log('  → Stage 2 完成，时间轴提示词:', result.timelinePrompts?.length || 0, '节点');
    return {
      visual: visualData,
      timeline: visualData.timeline || [],
      timelinePrompts: result.timelinePrompts || [],
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

// ── Stage 3: 提示词发射 — 按画风+优化方向重新生成 ──────────────────────────
async function stage3_launchPrompt(visualData, timeline, originalPrompt, artStyle, optimizeDirections, userTemplate) {
  const timelineStr = (timeline || []).map((t, i) =>
    `  节点${i+1} [${t.timeRange}]:\n    画面: ${t.visual}\n    台词/旁白: ${t.dialogue || '（无）'}\n    动作: ${t.action}\n    镜头: ${t.camera}\n    情绪: ${t.emotion}`
  ).join('\n');

  const optimizeStr = optimizeDirections.length > 0
    ? `\n\n【优化方向】\n${optimizeDirections.map(d => `- ${d}`).join('\n')}\n\n请按照以上优化方向对提示词进行针对性优化。例如：\n- "强化冲突"：增加角色之间的对抗、矛盾、戏剧性冲突场景\n- "提升趣味"：增加搞笑桥段、意外转折、轻松活泼元素\n- "增加网络梗"：融入当下流行的网络热梗、表情包式画面、弹幕文化元素\n- "增强情感"：加深情感渲染，增加感人/热血/温馨的情感爆发点\n- "加快节奏"：缩短每个镜头时长，增加快速剪辑和转场\n- "提升质感"：加入电影级光影、高级配色、专业运镜描述`
    : '';

  const templateStr = userTemplate
    ? `\n\n【用户提示词模板】\n模板名称：${userTemplate.name}\n模板内容：\n${userTemplate.template}`
    : '';

  const stage3Prompt = `你是一个顶尖的 AI 视频提示词工程师。现在需要你根据用户选择的画风和优化方向，重新生成完整的 Seedance 2.0 视频提示词。

【原始视频分析】
- 产品：${visualData.product}
- 分类：${visualData.category}
- 场景：${visualData.scene}
- 主要内容：${visualData.mainContent}
- 卖点：${visualData.sellingPoints?.join('、')}
- 目标人群：${visualData.targetAudience}
- 广告手法：${visualData.adTechnique}

【时间轴分析】
${timelineStr}

【原始提示词】
${originalPrompt}
${optimizeStr}${templateStr}

【目标画风】${artStyle}

【你的任务】
1. 将视频整体画风切换为「${artStyle}」风格
2. 按优化方向对内容进行调整
3. 为每个时间节点生成新的提示词，确保台词/旁白对应的画面在新画风下的合理呈现
4. 生成完整的串联提示词

【画风转换指南】
- Q版/二次元：角色变为Q版大头小身，圆润可爱，线条简化，色彩明快
- 写实：追求真实质感，注重光影细节，皮肤纹理真实，环境写实
- 3D渲染：立体感强，材质质感突出，光影全局光照，类似皮克斯/梦工厂风格
- 真人：真人出演，注重演员表情演技，服化道精致，自然光感
- 赛博朋克：霓虹灯光，科技感，暗色调+高饱和度点缀，全息投影元素
- 水墨风：中国水墨画风格，留白意境，笔触感，淡雅色调
- 像素风：8-bit/16-bit 像素艺术，复古游戏感，低分辨率美学

返回纯 JSON（不要 markdown 代码块）：
{
  "artStyle": "${artStyle}",
  "timelinePrompts": [
    {
      "timeRange": "0:00-0:03",
      "prompt": "该时间段在新画风+优化方向下的 Seedance 提示词"
    }
  ],
  "seedancePrompt": "完整的重新生成的 Seedance 2.0 提示词，将所有时间节点在${artStyle}风格下串联为一段完整、流畅、自然的中文描述",
  "changesSummary": "简述相比原提示词的主要变化（50字内）"
}`;

  console.log('  → Stage 3: 提示词发射...');

  const response = await geminiRequest(
    `/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      contents: [{ parts: [{ text: stage3Prompt }] }],
      generationConfig: { maxOutputTokens: 6000, temperature: 0.8 }
    }
  );

  const text = response.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Stage 3: 生成返回为空');

  try {
    const result = JSON.parse(cleanJsonResponse(text));
    console.log('  → Stage 3 完成，画风:', artStyle, '变化:', result.changesSummary);
    return {
      artStyle: result.artStyle || artStyle,
      timelinePrompts: result.timelinePrompts || [],
      seedancePrompt: result.seedancePrompt,
      changesSummary: result.changesSummary || ''
    };
  } catch (e) {
    console.error('  → Stage 3 解析失败:', text.substring(0, 500));
    throw new Error('Stage 3: 无法解析生成结果');
  }
}

// ── Start ───────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('\n╔════════════════════════════════════════════╗');
  console.log('║   🌟 繁星-视频分析  v4.0                   ║');
  console.log('╠════════════════════════════════════════════╣');
  console.log(`║   地址: http://localhost:${PORT.toString().padEnd(20)}║`);
  console.log('║   模型: ' + GEMINI_MODEL.padEnd(32) + '║');
  console.log('╚════════════════════════════════════════════╝\n');
});
