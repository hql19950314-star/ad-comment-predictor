/**
 * 繁星-视频分析 - 后端服务器 v5.16.0 (Gemini 版)
 *
 * 功能：
 * 1. 接收视频文件上传（支持 200MB+）
 * 2. Gemini 原生视频理解（无需抽帧）
 * 3. Stage 1: 视觉结构化分析 + 时间轴分节点（台词/旁白/画面）
 * 4. Stage 2: 按时间节点生成 Seedance 2.0 提示词 + 舆情风险评估
 * 5. Stage 3: 提示词发射 — 按画风/优化方向重新生成
 * 6. Gemini Vision 图片分析 → AI绘画复刻提示词
 * 7. Gemini / Imagen 图片生成（分析后可生图）
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
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-pro';
const GEMINI_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-lite';
// 图片生成模型：使用 Gemini 原生图片生成模型
const GEMINI_IMAGE_GEN_MODEL = process.env.GEMINI_IMAGE_GEN_MODEL || 'gemini-2.0-flash-exp';

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

const imageStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `image-${Date.now()}-${Math.round(Math.random() * 1E9)}${ext}`);
  }
});
const imageUpload = multer({
  storage: imageStorage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (req, file, cb) => {
    const validExts = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (validExts.includes(ext) || file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('不支持的图片格式，请上传 JPG/PNG/WebP/GIF'));
    }
  }
});

// ── Static Files ─────────────────────────────────────────────────────────────
app.use(express.static(__dirname));

// ── Health ───────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'star-video-analyzer', version: '5.16.0', timestamp: new Date().toISOString(), imageAnalysis: true, imageGeneration: true });
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
    if (!visualData || !timeline) {
      return res.status(400).json({ error: '缺少必要参数' });
    }

    console.log(`\n[${new Date().toISOString()}] 🚀 提示词发射`);
    console.log(`画风: ${artStyle || '保持原画风'}, 优化: ${(optimizeDirections || []).join(', ')}`);

    const result = await stage3_launchPrompt(visualData, timeline, originalPrompt, artStyle, optimizeDirections || [], userTemplate);

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('❌ 发射失败:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── Image Generation Endpoint (Pollinations.ai - Free) ─────────────────────
app.post('/api/generate-image', async (req, res) => {
  try {
    const { prompt, aspectRatio, quality } = req.body;
    if (!prompt) return res.status(400).json({ error: '提示词不能为空' });

    console.log('\n[' + new Date().toISOString() + '] 🎨 图片生成开始 (Pollinations.ai)');
    console.log('提示词: ' + prompt.substring(0, 80) + '...');
    console.log('比例: ' + aspectRatio + ', 质量: ' + quality);

    const imageData = await generateImageWithPollinations(prompt, aspectRatio, quality);
    console.log('✅ 图片生成完成\n');
    res.json({ success: true, image: imageData });

  } catch (error) {
    console.error('❌ 图片生成失败:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

async function generateImageWithPollinations(prompt, aspectRatio, quality) {
  const aspectMap = { '1:1': [1024, 1024], '16:9': [1280, 720], '9:16': [720, 1280], '4:3': [1024, 768], '3:4': [768, 1024] };
  const qualityMap = { '1k': 1, '2k': 1.5, '4k': 2 };

  let [w, h] = aspectMap[aspectRatio] || [1024, 1024];
  const scale = qualityMap[(quality || '').toLowerCase()] || 1;
  w = Math.round(w * scale);
  h = Math.round(h * scale);

  const fullPrompt = encodeURIComponent(prompt + ', high quality, detailed, masterpiece');
  const url = 'https://image.pollinations.ai/prompt/' + fullPrompt + '?width=' + w + '&height=' + h + '&nologo=true';

  console.log('  [Pollinations] WxH: ' + w + 'x' + h);

  return new Promise((resolve, reject) => {
    require('https').get(url, (response) => {
      if (response.statusCode >= 400) {
        reject(new Error('HTTP ' + response.statusCode));
        return;
      }
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const base64 = buffer.toString('base64');
        const isPNG = buffer[0] === 0x89 && buffer[1] === 0x50;
        const mime = isPNG ? 'image/png' : 'image/jpeg';
        console.log('  [Pollinations] OK: ' + (buffer.length / 1024).toFixed(1) + 'KB');
        resolve('data:' + mime + ';base64,' + base64);
      });
    }).on('error', reject);
  });
}

// ── Image Analysis Endpoint (Gemini Vision) ────────────────────────────────
app.post('/api/analyze-image', imageUpload.single('image'), async (req, res) => {
  let imagePath = null;
  try {
    if (!req.file) return res.status(400).json({ error: '请上传图片文件' });
    imagePath = req.file.path;

    const aspectRatio = req.body.aspectRatio || '1:1';
    const quality = req.body.quality || 'medium';
    const customPrompt = req.body.customPrompt || '';

    console.log(`\n[${new Date().toISOString()}] 🖼️ Gemini 图片分析开始`);
    console.log(`文件: ${req.file.originalname} (${(req.file.size / 1024 / 1024).toFixed(2)} MB)`);
    console.log(`参数: 比例=${aspectRatio}, 清晰度=${quality}`);

    const imageBuffer = fs.readFileSync(imagePath);
    const imageBase64 = imageBuffer.toString('base64');
    const imageMimeType = req.file.mimetype || 'image/jpeg';

    const qualityMap = { low: '低清/草图感', medium: '标准清晰', high: '高清/精细' };

    const prompt = `你是一个专业的AI绘画复刻专家。你的任务是根据用户提供的参考图片，生成高质量的AI绘画复刻提示词。

【核心原则】
1. 提示词要具体、精确、有画面感，能准确还原参考图的构图、风格、色调
2. 使用中文描述，语言自然流畅，避免生硬的关键词堆砌
3. 关注细节：光影、质感、构图、色彩、氛围
4. 按以下结构输出：主体描述 → 场景环境 → 动作/姿态 → 风格/画质 → 色调/光影 → 补充细节
5. 不要出现"AI"、"人工智能"、"提示词"等元描述词汇
6. 保持描述的客观性，如实地描述图中可见内容

【目标参数】
- 图片比例：${aspectRatio}
- 清晰度要求：${qualityMap[quality] || quality}${customPrompt ? '\n- 用户额外要求：' + customPrompt : ''}

【输出格式】
请严格按以下 JSON 格式返回（不要 markdown 代码块）：
{
  "prompt": "完整的中文复刻描述，一段流畅的文字，包含主体、场景、风格、色调、光影、氛围等关键信息，适合直接用于AI绘画工具",
  "breakdown": {
    "主体": "画面主体的详细描述",
    "场景": "背景/环境描述",
    "动作": "人物动作/姿态（如无人物写'无'）",
    "风格": "画风/视觉风格",
    "色调": "色调/配色描述",
    "光影": "光影效果描述",
    "细节": "值得注意的细节特征"
  }
}

请仔细观察图片中的每一个视觉元素，确保复刻描述能忠实还原原图的精髓。`;

    const imageModel = GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-lite';
    const imageApiPath = `/v1beta/models/${imageModel}:generateContent?key=${GEMINI_API_KEY}`;
    console.log(`  图片分析请求: ${imageApiPath.replace(GEMINI_API_KEY, '***')}`);
    const response = await geminiRequest(imageApiPath, {
      contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType: imageMimeType, data: imageBase64 } }] }],
      generationConfig: { maxOutputTokens: 2000, temperature: 0.7 }
    });

    const text = response.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Gemini 图片分析返回为空');

    let result;
    try { result = JSON.parse(cleanJsonResponse(text)); }
    catch (e) {
      console.error('  → JSON 解析失败，使用纯文本 fallback');
      result = { prompt: text.replace(/```json?\s*/g, '').replace(/```/g, '').trim(), breakdown: {} };
    }

    if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
    console.log('✅ Gemini 图片分析完成\n');
    res.json({ success: true, data: result });

  } catch (error) {
    console.error('❌ 图片分析失败:', error.message);
    if (imagePath && fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
    res.status(500).json({ success: false, error: error.message, hint: getErrorHint(error.message) });
  }
});

app.post('/api/analyze-image-iterate', async (req, res) => {
  try {
    const { previousPrompt, modifyInstruction, aspectRatio, quality, breakdown } = req.body;
    if (!previousPrompt || !modifyInstruction) {
      return res.status(400).json({ error: '缺少必要参数' });
    }

    console.log(`\n[${new Date().toISOString()}] 🔄 Gemini 图片迭代分析`);
    console.log(`修改指令: ${modifyInstruction}`);

    const qualityMap = { low: '低清/草图感', medium: '标准清晰', high: '高清/精细' };

    const prompt = `请根据修改指令，调整以下复刻提示词。

【原始提示词】
${previousPrompt}

${breakdown ? `【原始分析】\n${JSON.stringify(breakdown, null, 2)}` : ''}

【修改指令】
${modifyInstruction}

【目标参数】
- 图片比例：${aspectRatio || '1:1'}
- 清晰度要求：${qualityMap[quality || medium] || '标准清晰'}

请输出调整后的完整 JSON（不要 markdown 代码块）：
{
  "prompt": "调整后的完整中文复刻描述",
  "breakdown": {
    "主体": "调整后的主体描述",
    "场景": "调整后的场景描述",
    "动作": "调整后的动作描述",
    "风格": "调整后的风格描述",
    "色调": "调整后的色调描述",
    "光影": "调整后的光影描述",
    "细节": "调整后的细节描述"
  }
}`;

    const response = await geminiRequest(
      `/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 2000, temperature: 0.7 }
      }
    );

    const text = response.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Gemini 迭代返回为空');

    let result;
    try { result = JSON.parse(cleanJsonResponse(text)); }
    catch (e) {
      result = { prompt: text.replace(/```json?\s*/g, '').replace(/```/g, '').trim(), breakdown: breakdown || {} };
    }

    console.log('✅ 迭代完成\n');
    res.json({ success: true, data: result });

  } catch (error) {
    console.error('❌ 迭代失败:', error.message);
    res.status(500).json({ success: false, error: error.message, hint: getErrorHint(error.message) });
  }
});



// ═══════════════════════════════════════════════════════════════
//  Gemini API 调用
// ═══════════════════════════════════════════════════════════════

function geminiRequest(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    // 自动追加 API Key（如果路径中尚未包含）
    const finalPath = path.includes('?key=') ? path : `${path}${path.includes('?') ? '&' : '?'}key=${GEMINI_API_KEY}`;
    const options = {
      hostname: 'generativelanguage.googleapis.com',
      path: finalPath,
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
  const prompt = `你是一个专业的视频内容分析师。仔细观看这个视频，进行深度结构化分析。

【核心原则】
优先保证分析准确、角色清晰、台词归属明确、镜头信息完整。

【要求】
1. 15秒内视频，时长、镜头运动严格跟视频一致，严格口型与台词100%精准匹配；超过15秒视频，不要写镜头时长。
2. 输出以"分析准确、信息完整"为最高优先级，不要为了文案流畅牺牲角色、镜头、动作、台词、表情、语气等关键信息；无法确认的信息要保守描述，不要乱写。
3. 多角色时，必须明确区分角色之间的互动、动作、台词、表情和语气，避免角色指代混乱。
4. 必须严格区分"角色真实口播台词""旁白/画外音""路人议论""字幕文案"四类信息。
5. 只有当视频中能明确看到角色口型与台词同步时，才能把该句判定为该角色真实口播台词。
6. 若画面中没有明确口型对应，或该句更像介绍语、评论语、背景解说、群体议论，则优先标注为"旁白/画外音/路人议论"，不要强行归到角色头上。
7. 若视频中出现字幕文字，但无法确认是否被说出，要区分"字幕文案"与"实际口播台词"，不得混写。
8. 若视频中明确出现同一角色在连续画面里发生可见的服装变化、造型变化、特效换装、形象升级或由旧造型过渡到新造型，必须明确识别并写出这是"换装/变装/造型切换/特效变身"中的哪一种，不得漏掉。
9. 只有当能够确认是同一角色在连续画面中完成造型变化时，才能标记为换装或变装；如果只是不同角色切换、不同人物出场、不同镜头拼接、不同场景切换，则不得误判为同一角色变装。
10. 最终输出为中文。

返回纯 JSON（不要 markdown 代码块）：
{
  "overallStyle": {
    "artStyle": "整体画风（如实拍/二次元/3D渲染/水墨/像素/赛博朋克/日系动漫等）",
    "quality": "画质特点（如电影级/高清/颗粒感/低像素等）",
    "atmosphere": "整体氛围（如紧张/温馨/搞笑/悬疑/热血等）"
  },
  "characters": [
    {
      "name": "角色1（能辨认写名称，否则写角色A/B/C）",
      "features": "角色特征描述",
      "appearance": "服装/外观描述",
      "expression": "表情特征",
      "personality": "气质/性格"
    }
  ],
  "scene": {
    "type": "场景类型",
    "keyElements": "关键元素",
    "lighting": "光影特点",
    "spatialAtmosphere": "空间氛围"
  },
  "storyboard": [
    {
      "shotNumber": 1,
      "timeRange": "0:00-0:03",
      "shotType": "特写/近景/中景/全景/远景",
      "cameraMovement": "固定/推/拉/摇/移/跟/升降",
      "lightAndMood": "光效方向，氛围描述",
      "action": "明确写清角色1/角色2分别做了什么；若存在换装/变装/造型切换过程，必须直接写出",
      "dialogue": "明确写清谁说了什么；角色真实口播需写清说话角色；非角色口播要标注为旁白/画外音/路人议论/字幕文案",
      "expression": "明确写清角色表情变化",
      "tone": "明确写清说话语气；旁白/议论/字幕也要按实际性质标注",
      "emotionRhythm": "紧张/舒缓/压抑/欢快/悬疑等"
    }
  ],
  "product": "产品/品牌名（看不出写'未知'）",
  "category": "分类（游戏/美妆/食品/汽车/服饰/APP/教育/金融/电商/其他）",
  "mainContent": "视频主要内容和剧情（50字内）",
  "sellingPoints": ["核心卖点1", "卖点2", "卖点3"],
  "targetAudience": "目标人群（年龄+性别+特征）",
  "adTechnique": "广告手法（明星代言/剧情植入/对比展示/UGC感/福利诱导/情感共鸣/悬念营销等）",
  "controversialElements": ["可能引发争议的元素1", "元素2（没有写[]）"],
  "textOnScreen": ["屏幕文字1", "文字2（没有写[]）"],
  "audioElements": "音频特点（BGM风格/有无台词/口播关键词）",
  "videoQuality": "制作质量（专业TVC/UGC感/短视频风/微电影等）"
}

注意：
- storyboard 至少分4-8个分镜，根据视频实际时长和内容变化来划分
- 每个分镜必须精确到时间区间（如"0:05-0:12"）
- dialogue 字段必须严格区分四类：角色口播/旁白画外音/路人议论/字幕文案，不要混淆
- 无法确认的信息要保守描述，不要乱写`;

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
    console.log(`  → Stage 1 完成: ${result.product} / ${result.category} / 分镜${result.storyboard?.length || 0}个 / 角色${result.characters?.length || 0}个`);
    return result;
  } catch (e) {
    console.error('  → Stage 1 JSON parse failed, cleaned (first 300 chars): ' + cleaned.substring(0, 300));
    throw new Error('Stage 1: 无法解析视觉分析结果');
  }
}

// ── Stage 2: 生成时间轴提示词 + 舆情风险评估 ───────────────────────────────
async function stage2_generatePromptAndRisk(visualData, userTemplate) {
  const defaultTemplate = {
    name: 'Seedance 2.0 标准模板',
    template: `0-x秒：[场景与画面描述]，[角色动作/剧情]，[镜头运动与景别]，[色调与光影氛围]\nx-y秒：[场景与画面描述]，[角色动作/剧情]，[镜头运动与景别]，[色调与光影氛围]\ny-z秒：[场景与画面描述]，[角色动作/剧情]，[镜头运动与景别]，[色调与光影氛围]`
  };

  const template = userTemplate || defaultTemplate;

  // 构建角色描述
  const charactersStr = (visualData.characters || []).map((c, i) =>
    `  角色${i+1}：${c.name}，${c.features}，${c.appearance}，${c.expression}，${c.personality}`
  ).join('\n');

  // 构建分镜脚本
  const storyboardStr = (visualData.storyboard || []).map((s, i) =>
    `  分镜${i+1} [${s.timeRange}]:\n    镜头: ${s.shotType}\n    运镜: ${s.cameraMovement}\n    光效/氛围: ${s.lightAndMood}\n    动作: ${s.action}\n    台词: ${s.dialogue}\n    表情: ${s.expression}\n    语气: ${s.tone}\n    情绪节奏: ${s.emotionRhythm}`
  ).join('\n');

  // 构建场景描述
  const sceneInfo = visualData.scene ? `${visualData.scene.type}，${visualData.scene.keyElements}，${visualData.scene.lighting}，${visualData.scene.spatialAtmosphere}` : '';

  // 构建整体风格
  const styleInfo = visualData.overallStyle ? `${visualData.overallStyle.artStyle}，${visualData.overallStyle.quality}，${visualData.overallStyle.atmosphere}` : '';

  const stage2Prompt = `你是一个顶尖的广告创意分析师和 AI 视频提示词工程师。

【整体风格】
${styleInfo}

【角色】
${charactersStr}

【场景】
${sceneInfo}

【视频分析结果】
- 产品：${visualData.product}
- 分类：${visualData.category}
- 主要内容：${visualData.mainContent}
- 卖点：${visualData.sellingPoints.join('、')}
- 目标人群：${visualData.targetAudience}
- 广告手法：${visualData.adTechnique}
- 争议点：${visualData.controversialElements?.join('、') || '无'}
- 制作质量：${visualData.videoQuality}
- 音频特点：${visualData.audioElements}

【分镜脚本】
${storyboardStr}

【你的任务】
1. 根据分镜脚本的每个分镜，生成对应时间段的 Seedance 2.0 提示词，确保提示词与该分镜的台词归属、画面、动作、镜头精确匹配
2. 生成一段整体提示词，将所有分镜串联成流畅的完整视频描述
3. 评估舆情风险

【用户提示词模板】
模板名称：${template.name}
模板内容：
${template.template}

【Seedance 提示词写作规范】
- 每个分镜的提示词必须包含：角色动作、台词归属（区分口播/旁白/议论/字幕）、镜头运动、色调和氛围
- 严格区分"角色真实口播台词""旁白/画外音""路人议论""字幕文案"四类信息
- 用自然流畅的中文描述，融入核心卖点
- 确保描述具体生动，适合 AI 视频模型理解
- 分镜之间的提示词要有过渡和连贯性

返回纯 JSON（不要 markdown 代码块）：
{
  "timelinePrompts": [
    {
      "timeRange": "0:00-0:03",
      "prompt": "该时间段的 Seedance 提示词，包含画面、动作、台词归属、镜头、氛围等"
    }
  ],
  "seedancePrompt": "完整的 Seedance 2.0 提示词，将所有分镜串联为一段完整、流畅、自然的中文描述，无markdown符号",
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
    console.log('  → Stage 2 完成，分镜提示词:', result.timelinePrompts?.length || 0, '个');
    return {
      visual: visualData,
      timeline: visualData.storyboard || [],
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
    `  分镜${i+1} [${t.timeRange}]:\n    镜头: ${t.shotType}\n    运镜: ${t.cameraMovement}\n    光效/氛围: ${t.lightAndMood}\n    动作: ${t.action}\n    台词: ${t.dialogue}\n    表情: ${t.expression}\n    语气: ${t.tone}\n    情绪节奏: ${t.emotionRhythm}`
  ).join('\n');

  const optimizeStr = optimizeDirections.length > 0
    ? `\n\n【优化方向】\n${optimizeDirections.map(d => `- ${d}`).join('\n')}\n\n请按照以上优化方向对提示词进行针对性优化。例如：\n- "强化冲突"：增加角色之间的对抗、矛盾、戏剧性冲突场景\n- "提升趣味"：增加搞笑桥段、意外转折、轻松活泼元素\n- "增加网络梗"：融入当下流行的网络热梗、表情包式画面、弹幕文化元素\n- "增强情感"：加深情感渲染，增加感人/热血/温馨的情感爆发点\n- "加快节奏"：缩短每个镜头时长，增加快速剪辑和转场\n- "提升质感"：加入电影级光影、高级配色、专业运镜描述`
    : '';

  const templateStr = userTemplate
    ? `\n\n【用户提示词模板】\n模板名称：${userTemplate.name}\n模板内容：\n${userTemplate.template}`
    : '';

  const styleBlock = artStyle
    ? `\n【目标画风】${artStyle}\n\n【你的任务】\n1. 将视频整体画风切换为「${artStyle}」风格\n2. 按优化方向对内容进行调整\n3. 为每个时间节点生成新的提示词，确保台词/旁白对应的画面在新画风下的合理呈现\n4. 生成完整的串联提示词\n\n【画风转换指南】\n- Q版/二次元：角色变为Q版大头小身，圆润可爱，线条简化，色彩明快\n- 写实：追求真实质感，注重光影细节，皮肤纹理真实，环境写实\n- 3D渲染：立体感强，材质质感突出，光影全局光照，类似皮克斯/梦工厂风格\n- 真人：真人出演，注重演员表情演技，服化道精致，自然光感\n- 赛博朋克：霓虹灯光，科技感，暗色调+高饱和度点缀，全息投影元素\n- 水墨风：中国水墨画风格，留白意境，笔触感，淡雅色调\n- 像素风：8-bit/16-bit 像素艺术，复古游戏感，低分辨率美学\n- 日系动漫：日式动画风格，大眼细脸，光影柔和，色彩饱和，表情夸张\n\n返回纯 JSON（不要 markdown 代码块）：\n{\n  "artStyle": "${artStyle}",\n  "timelinePrompts": [\n    {\n      "timeRange": "0:00-0:03",\n      "prompt": "该时间段在新画风+优化方向下的 Seedance 提示词"\n    }\n  ],\n  "seedancePrompt": "完整的重新生成的 Seedance 2.0 提示词，将所有时间节点在${artStyle}风格下串联为一段完整、流畅、自然的中文描述",\n  "changesSummary": "简述相比原提示词的主要变化（50字内）"\n}`
    : `\n【你的任务】\n1. 保持原视频的画风和视觉风格，仅按优化方向对内容进行调整\n2. 为每个时间节点生成优化后的提示词，保持原有画面风格\n3. 生成完整的串联提示词\n\n返回纯 JSON（不要 markdown 代码块）：\n{\n  "artStyle": "保持原画风",\n  "timelinePrompts": [\n    {\n      "timeRange": "0:00-0:03",\n      "prompt": "该时间段在优化方向下的 Seedance 提示词"\n    }\n  ],\n  "seedancePrompt": "完整的重新生成的 Seedance 2.0 提示词，保持原画风，将所有时间节点按优化方向串联为一段完整、流畅、自然的中文描述",\n  "changesSummary": "简述相比原提示词的主要变化（50字内）"\n}`;

  const stage3Prompt = `你是一个顶尖的 AI 视频提示词工程师。现在需要你根据用户的选择，重新生成完整的 Seedance 2.0 视频提示词。

【原始视频分析】
- 产品：${visualData.product}
- 分类：${visualData.category}
- 主要内容：${visualData.mainContent}
- 卖点：${visualData.sellingPoints?.join('、')}
- 目标人群：${visualData.targetAudience}
- 广告手法：${visualData.adTechnique}
- 整体风格：${visualData.overallStyle ? visualData.overallStyle.artStyle + '，' + visualData.overallStyle.atmosphere : ''}
- 角色：${(visualData.characters || []).map(c => c.name).join('、')}

【分镜脚本】
${timelineStr}

【原始提示词】
${originalPrompt}
${optimizeStr}${templateStr}${styleBlock}`;

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
  console.log('║   🌟 繁星-视频分析+图片分析  v5.16.0          ║');
  console.log('╠════════════════════════════════════════════╣');
  console.log('║   地址: http://localhost:3000                  ║');
  console.log('║   视频: gemini-2.5-pro                         ║');
  console.log('║   图片: gemini-2.5-flash-lite                ║');
  console.log('║   生图: Pollinations.ai (free)  ║');
  console.log('╚════════════════════════════════════════════╝\n');
});
