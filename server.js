/**
 * 绻佹槦-瑙嗛鍒嗘瀽 - 鍚庣鏈嶅姟鍣?v4.0 (Gemini 鐗?
 *
 * 鍔熻兘锛?
 * 1. 鎺ユ敹瑙嗛鏂囦欢涓婁紶锛堟敮鎸?200MB+锛?
 * 2. Gemini 鍘熺敓瑙嗛鐞嗚В锛堟棤闇€鎶藉抚锛?
 * 3. Stage 1: 瑙嗚缁撴瀯鍖栧垎鏋?+ 鏃堕棿杞村垎鑺傜偣锛堝彴璇?鏃佺櫧/鐢婚潰锛?
 * 4. Stage 2: 鎸夋椂闂磋妭鐐圭敓鎴?Seedance 2.0 鎻愮ず璇?+ 鑸嗘儏椋庨櫓璇勪及
 * 5. Stage 3: 鎻愮ず璇嶅彂灏?鈥?鎸夌敾椋?浼樺寲鏂瑰悜閲嶆柊鐢熸垚
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
  console.error('鉂?閿欒: 鏈缃?GEMINI_API_KEY 鐜鍙橀噺');
  process.exit(1);
}
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';

const app = express();
const PORT = process.env.PORT || 3000;

// 鈹€鈹€ Middleware 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
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
      cb(new Error('涓嶆敮鎸佺殑鏂囦欢鏍煎紡锛岃涓婁紶 MP4/MOV/WebM/AVI'));
    }
  }
});

// 鈹€鈹€ Static Files 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
app.use(express.static(__dirname));

// 鈹€鈹€ Health 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'star-video-analyzer', version: '4.0.0', timestamp: new Date().toISOString() });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// 鈹€鈹€ Analyze Endpoint 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
app.post('/api/analyze', upload.single('video'), async (req, res) => {
  const startTime = Date.now();
  let videoPath = null;

  try {
    if (!req.file) return res.status(400).json({ error: '璇蜂笂浼犺棰戞枃浠? });
    videoPath = req.file.path;

    let userPromptTemplate = null;
    try {
      if (req.body.promptTemplate) userPromptTemplate = JSON.parse(req.body.promptTemplate);
    } catch (e) { /* ignore */ }

    console.log(`\n[${new Date().toISOString()}] 馃専 绻佹槦瑙嗛鍒嗘瀽寮€濮媊);
    console.log(`鏂囦欢: ${req.file.originalname} (${(req.file.size / 1024 / 1024).toFixed(2)} MB)`);

    // Step 1: 璇诲彇瑙嗛
    console.log('Step 1: 璇诲彇瑙嗛鏂囦欢...');
    const videoBuffer = fs.readFileSync(videoPath);
    const videoBase64 = videoBuffer.toString('base64');
    const videoMimeType = req.file.mimetype || 'video/mp4';

    // Step 2: Stage 1 瑙嗚鍒嗘瀽锛堝惈鏃堕棿杞达級
    console.log('Step 2: Stage 1 瑙嗚鍒嗘瀽 + 鏃堕棿杞?..');
    const analysisData = await stage1_visualAnalysis(videoBase64, videoMimeType);

    // Step 3: Stage 2 鐢熸垚鎻愮ず璇?+ 鑸嗘儏
    console.log('Step 3: Stage 2 鐢熸垚鏃堕棿杞存彁绀鸿瘝涓庤垎鎯呰瘎浼?..');
    const result = await stage2_generatePromptAndRisk(analysisData, userPromptTemplate);

    // 娓呯悊
    if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`鉁?鍒嗘瀽瀹屾垚锛岃€楁椂 ${elapsed} 绉抃n`);

    res.json({ success: true, elapsed: parseFloat(elapsed), data: result });

  } catch (error) {
    console.error('鉂?鍒嗘瀽澶辫触:', error.message);
    if (videoPath && fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
    const statusCode = error.response?.status || 500;
    res.status(statusCode).json({ success: false, error: error.message, hint: getErrorHint(error.message) });
  }
});

// 鈹€鈹€ Prompt Launch Endpoint (Stage 3) 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
app.post('/api/launch', async (req, res) => {
  try {
    const { visualData, timeline, originalPrompt, artStyle, optimizeDirections, userTemplate } = req.body;
    if (!visualData || !timeline || !artStyle) {
      return res.status(400).json({ error: '缂哄皯蹇呰鍙傛暟' });
    }

    console.log(`\n[${new Date().toISOString()}] 馃殌 鎻愮ず璇嶅彂灏刞);
    console.log(`鐢婚: ${artStyle}, 浼樺寲: ${(optimizeDirections || []).join(', ')}`);

    const result = await stage3_launchPrompt(visualData, timeline, originalPrompt, artStyle, optimizeDirections || [], userTemplate);

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('鉂?鍙戝皠澶辫触:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?
//  Gemini API 璋冪敤
// 鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺?

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
          reject(new Error(`瑙ｆ瀽鍝嶅簲澶辫触: ${responseData.substring(0, 200)}`));
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
  if (msg.includes('PERMISSION_DENIED')) return 'Gemini API 璁块棶琚嫆缁濓紝璇锋鏌?API Key';
  if (msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota')) return 'API 閰嶉鐢ㄥ敖锛岃妫€鏌ヨ处鍗曟垨绋嶅悗閲嶈瘯';
  if (msg.includes('UNAVAILABLE') || msg.includes('high demand')) return 'Gemini 鏈嶅姟绻佸繖锛岃绋嶅悗閲嶈瘯';
  if (msg.includes('timeout')) return '璇锋眰瓒呮椂锛岃棰戝彲鑳借繃澶э紝璇峰皾璇曞帇缂╁悗閲嶈瘯';
  return '璇锋鏌ョ綉缁滆繛鎺ユ垨绋嶅悗閲嶈瘯';
}

// 鈹€鈹€ Stage 1: 瑙嗚缁撴瀯鍖栧垎鏋?+ 鏃堕棿杞?鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
async function stage1_visualAnalysis(videoBase64, videoMimeType) {
  const prompt = `浣犳槸涓€涓笓涓氱殑骞垮憡涓庤棰戝唴瀹瑰垎鏋愬笀銆備粩缁嗚鐪嬭繖涓棰戯紝浠庡唴瀹瑰垱浣滃拰钀ラ攢瑙掑害杩涜娣卞害鍒嗘瀽銆?

銆愰噸瑕併€戜綘闇€瑕佹寜瑙嗛鐨勬椂闂磋妭鐐归€愪竴鍒嗘瀽锛屾瘡涓椂闂磋妭鐐瑰寘鍚細鏃堕棿鍖洪棿銆佺敾闈㈡弿杩般€佷汉鐗╁彴璇?鏃佺櫧/鍙ｆ挱鍐呭銆佸姩浣滄弿杩般€?

杩斿洖绾?JSON锛堜笉瑕?markdown 浠ｇ爜鍧楋級锛?
{
  "product": "浜у搧/鍝佺墝鍚嶏紙鐪嬩笉鍑哄啓'鏈煡'锛?,
  "category": "鍒嗙被锛堟父鎴?缇庡/椋熷搧/姹借溅/鏈嶉グ/APP/鏁欒偛/閲戣瀺/鐢靛晢/鍏朵粬锛?,
  "scene": "鍦烘櫙鎻忚堪锛?0瀛楀唴锛?,
  "mainContent": "瑙嗛涓昏鍐呭鍜屽墽鎯咃紙50瀛楀唴锛?,
  "sellingPoints": ["鏍稿績鍗栫偣1", "鍗栫偣2", "鍗栫偣3"],
  "visualStyle": "瑙嗚椋庢牸锛堜簩娆″厓/瀹炴媿/3D娓叉煋/鎵嬬粯/鎷艰创/鐢靛奖鎰?绾綍鐗囬鏍肩瓑锛?,
  "colorTone": "涓昏壊璋冩弿杩?,
  "mood": "鎯呯华姘涘洿锛堢儹琛€/娓╅Θ/鎮枒/鎼炵瑧/濂㈠崕/灏忔竻鏂?寮鸿妭濂?鎰熶汉绛夛級",
  "targetAudience": "鐩爣浜虹兢锛堝勾榫?鎬у埆+鐗瑰緛锛?,
  "adTechnique": "骞垮憡鎵嬫硶锛堟槑鏄熶唬瑷€/鍓ф儏妞嶅叆/瀵规瘮灞曠ず/UGC鎰?绂忓埄璇卞/鎯呮劅鍏遍福/鎮康钀ラ攢绛夛級",
  "controversialElements": ["鍙兘寮曞彂浜夎鐨勫厓绱?", "鍏冪礌2锛堟病鏈夊啓[]锛?],
  "textOnScreen": ["灞忓箷鏂囧瓧1", "鏂囧瓧2锛堟病鏈夊啓[]锛?],
  "audioElements": "闊抽鐗圭偣锛圔GM椋庢牸/鏈夋棤鍙拌瘝/鍙ｆ挱鍏抽敭璇嶏級",
  "shotComposition": "闀滃ご鏋勬垚锛堝浐瀹?鎵嬫寔/杩愰暅/鐗瑰啓+鍏ㄦ櫙缁勫悎绛夛級",
  "videoQuality": "鍒朵綔璐ㄩ噺锛堜笓涓歍VC/UGC鎰?鐭棰戦/寰數褰辩瓑锛?,
  "timeline": [
    {
      "timeRange": "0:00-0:03",
      "scene": "杩欎釜鏃堕棿娈电殑鍦烘櫙鎻忚堪",
      "visual": "鐢婚潰鍐呭鎻忚堪锛堜汉鐗┿€佸姩浣溿€佽〃鎯呫€佺幆澧冪瓑锛?,
      "dialogue": "杩欎釜鏃堕棿娈典汉鐗╃殑鍙拌瘝/鏃佺櫧/鍙ｆ挱鍐呭锛堟病鏈夊垯鍐欑┖瀛楃涓诧級",
      "action": "涓昏鍔ㄤ綔鍜岃繍鍔ㄦ弿杩?,
      "camera": "闀滃ご杩愬姩锛堟帹/鎷?鎽?绉?鍥哄畾/鐗瑰啓绛夛級",
      "emotion": "杩欎釜鏃堕棿娈电殑鎯呯华姘涘洿"
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

娉ㄦ剰锛?
- timeline 鑷冲皯鍒?-8涓妭鐐癸紝鏍规嵁瑙嗛瀹為檯鏃堕暱鍜屽唴瀹瑰彉鍖栨潵鍒掑垎
- 姣忎釜鑺傜偣蹇呴』绮剧‘鍒版椂闂村尯闂达紙濡?0:05-0:12"锛?
- dialogue 瀛楁蹇呴』鍐欏嚭浜虹墿璇寸殑鍙拌瘝銆佹梺鐧姐€佹垨鍙ｆ挱鐨勫師鏂囷紙灏介噺杩樺師鍘熻瘽锛?
- 濡傛灉鏌愭娌℃湁鍙拌瘝/鏃佺櫧锛宒ialogue 鍐欑┖瀛楃涓?"`;

  const response = await geminiRequest(
    `/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType: videoMimeType, data: videoBase64 } }] }],
      generationConfig: { maxOutputTokens: 4000, temperature: 0.3 }
    }
  );

  const text = response.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Stage 1: Gemini 杩斿洖涓虹┖');

  try {
    const result = JSON.parse(cleanJsonResponse(text));
    console.log(`  鈫?Stage 1 瀹屾垚: ${result.product} / ${result.category} / 鏃堕棿杞?{result.timeline?.length || 0}鑺傜偣`);
    return result;
  } catch (e) {
    console.error('  鈫?Stage 1 瑙ｆ瀽澶辫触:', text.substring(0, 300));
    throw new Error('Stage 1: 鏃犳硶瑙ｆ瀽瑙嗚鍒嗘瀽缁撴灉');
  }
}

// 鈹€鈹€ Stage 2: 鐢熸垚鏃堕棿杞存彁绀鸿瘝 + 鑸嗘儏椋庨櫓璇勪及 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
async function stage2_generatePromptAndRisk(visualData, userTemplate) {
  const defaultTemplate = {
    name: 'Seedance 2.0 鏍囧噯妯℃澘',
    template: `@鍥剧墖1浣滀负涓讳綋瑙掕壊锛孈鍥剧墖2锛堝彲閫夛級浣滀负娆¤瑙掕壊鎴栬儗鏅弬鑰冿紝\n@瑙嗛1浣滀负闀滃ご璇█涓庤繍闀滃弬鑰冿紝\n@闊抽1浣滀负鑳屾櫙闊充箰鎴栭厤闊冲弬鑰冿紝\n鍦╗鍦烘櫙鎻忚堪]涓繘琛孾涓昏鍔ㄤ綔/鍓ф儏]锛孿n[BGM椋庢牸]鑳屾櫙闊充箰锛孾鑹茶皟鎻忚堪]鑹茶皟锛孾瑙嗚椋庢牸]瑙嗚椋庢牸锛孿n[棰濆鎻忚堪锛氬闀滃ご杩愬姩/琛ㄦ儏鐗瑰啓/鍏夊奖鏁堟灉/姘涘洿绛塢`
  };

  const template = userTemplate || defaultTemplate;
  const timelineStr = (visualData.timeline || []).map((t, i) =>
    `  鑺傜偣${i+1} [${t.timeRange}]:\n    鐢婚潰: ${t.visual}\n    鍙拌瘝/鏃佺櫧: ${t.dialogue || '锛堟棤锛?}\n    鍔ㄤ綔: ${t.action}\n    闀滃ご: ${t.camera}\n    鎯呯华: ${t.emotion}`
  ).join('\n');

  const stage2Prompt = `浣犳槸涓€涓《灏栫殑骞垮憡鍒涙剰鍒嗘瀽甯堝拰 AI 瑙嗛鎻愮ず璇嶅伐绋嬪笀銆?

銆愯棰戝垎鏋愮粨鏋溿€?
- 浜у搧锛?{visualData.product}
- 鍒嗙被锛?{visualData.category}
- 鍦烘櫙锛?{visualData.scene}
- 涓昏鍐呭锛?{visualData.mainContent}
- 鍗栫偣锛?{visualData.sellingPoints.join('銆?)}
- 瑙嗚椋庢牸锛?{visualData.visualStyle}
- 涓昏壊璋冿細${visualData.colorTone}
- 鎯呯华姘涘洿锛?{visualData.mood}
- 鐩爣浜虹兢锛?{visualData.targetAudience}
- 骞垮憡鎵嬫硶锛?{visualData.adTechnique}
- 浜夎鐐癸細${visualData.controversialElements?.join('銆?) || '鏃?}
- 闀滃ご鏋勬垚锛?{visualData.shotComposition}
- 鍒朵綔璐ㄩ噺锛?{visualData.videoQuality}
- 闊抽鐗圭偣锛?{visualData.audioElements}

銆愭椂闂磋酱鍒嗘瀽銆?
${timelineStr}

銆愪綘鐨勪换鍔°€?
1. 鏍规嵁鏃堕棿杞寸殑姣忎釜鑺傜偣锛岀敓鎴愬搴旀椂闂存鐨?Seedance 2.0 鎻愮ず璇嶏紝纭繚鎻愮ず璇嶄笌璇ユ椂闂存鐨勫彴璇?鏃佺櫧銆佺敾闈€佸姩浣滅簿纭尮閰?
2. 鐢熸垚涓€娈垫暣浣撴彁绀鸿瘝锛屽皢鎵€鏈夎妭鐐逛覆鑱旀垚娴佺晠鐨勫畬鏁磋棰戞弿杩?
3. 璇勪及鑸嗘儏椋庨櫓

銆愮敤鎴锋彁绀鸿瘝妯℃澘銆?
妯℃澘鍚嶇О锛?{template.name}
妯℃澘鍐呭锛?
${template.template}

銆怱eedance 鎻愮ず璇嶅啓浣滆鑼冦€?
- 姣忎釜鏃堕棿鑺傜偣鐨勬彁绀鸿瘝蹇呴』鍖呭惈锛氳鑺傜偣鐨勫満鏅€佷汉鐗╁姩浣溿€佸彴璇嶆梺鐧藉搴旂殑鐢婚潰鎰熴€侀暅澶磋繍鍔ㄣ€佽壊璋冨拰姘涘洿
- 鐢ㄨ嚜鐒舵祦鐣呯殑涓枃鎻忚堪锛岃瀺鍏ユ牳蹇冨崠鐐?
- 纭繚鎻忚堪鍏蜂綋鐢熷姩锛岄€傚悎 AI 瑙嗛妯″瀷鐞嗚В
- 鏃堕棿鑺傜偣涔嬮棿鐨勬彁绀鸿瘝瑕佹湁杩囨浮鍜岃繛璐€?

杩斿洖绾?JSON锛堜笉瑕?markdown 浠ｇ爜鍧楋級锛?
{
  "timelinePrompts": [
    {
      "timeRange": "0:00-0:03",
      "prompt": "璇ユ椂闂存鐨?Seedance 鎻愮ず璇嶏紝鍖呭惈鐢婚潰銆佸姩浣溿€佸彴璇嶅搴旂敾闈㈡劅銆侀暅澶淬€佹皼鍥寸瓑"
    }
  ],
  "seedancePrompt": "瀹屾暣鐨?Seedance 2.0 鎻愮ず璇嶏紝灏嗘墍鏈夋椂闂磋妭鐐逛覆鑱斾负涓€娈靛畬鏁淬€佹祦鐣呫€佽嚜鐒剁殑涓枃鎻忚堪锛屾棤markdown绗﹀彿",
  "promptBreakdown": {
    "涓讳綋": "涓讳綋鎻忚堪",
    "鍦烘櫙": "鍦烘櫙鎻忚堪",
    "鍔ㄤ綔": "涓昏鍔ㄤ綔",
    "椋庢牸": "椋庢牸鎻忚堪",
    "鑹茶皟": "鑹茶皟鎻忚堪",
    "杩愰暅": "杩愰暅鎻忚堪",
    "闊充箰": "闊充箰鎻忚堪"
  },
  "riskAssessment": {
    "overall": "浣庨闄?涓闄?楂橀闄?,
    "score": 30,
    "factors": ["椋庨櫓鍥犵礌1", "椋庨櫓鍥犵礌2"]
  },
  "鑸嗘儏寤鸿": ["鑸嗘儏浼樺寲寤鸿1", "寤鸿2"]
}`;

  console.log('  鈫?Stage 2: 鐢熸垚鏃堕棿杞存彁绀鸿瘝...');

  const response = await geminiRequest(
    `/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      contents: [{ parts: [{ text: stage2Prompt }] }],
      generationConfig: { maxOutputTokens: 6000, temperature: 0.7 }
    }
  );

  const text = response.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Stage 2: 鐢熸垚杩斿洖涓虹┖');

  try {
    const result = JSON.parse(cleanJsonResponse(text));
    console.log('  鈫?Stage 2 瀹屾垚锛屾椂闂磋酱鎻愮ず璇?', result.timelinePrompts?.length || 0, '鑺傜偣');
    return {
      visual: visualData,
      timeline: visualData.timeline || [],
      timelinePrompts: result.timelinePrompts || [],
      seedancePrompt: result.seedancePrompt,
      promptBreakdown: result.promptBreakdown || {},
      riskAssessment: result.riskAssessment || { overall: '鏈煡', score: 50, factors: [] },
      suggestions: result.鑸嗘儏寤鸿 || []
    };
  } catch (e) {
    console.error('  鈫?Stage 2 瑙ｆ瀽澶辫触:', text.substring(0, 500));
    throw new Error('Stage 2: 鏃犳硶瑙ｆ瀽鐢熸垚缁撴灉');
  }
}

// 鈹€鈹€ Stage 3: 鎻愮ず璇嶅彂灏?鈥?鎸夌敾椋?浼樺寲鏂瑰悜閲嶆柊鐢熸垚 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
async function stage3_launchPrompt(visualData, timeline, originalPrompt, artStyle, optimizeDirections, userTemplate) {
  const timelineStr = (timeline || []).map((t, i) =>
    `  鑺傜偣${i+1} [${t.timeRange}]:\n    鐢婚潰: ${t.visual}\n    鍙拌瘝/鏃佺櫧: ${t.dialogue || '锛堟棤锛?}\n    鍔ㄤ綔: ${t.action}\n    闀滃ご: ${t.camera}\n    鎯呯华: ${t.emotion}`
  ).join('\n');

  const optimizeStr = optimizeDirections.length > 0
    ? `\n\n銆愪紭鍖栨柟鍚戙€慭n${optimizeDirections.map(d => `- ${d}`).join('\n')}\n\n璇锋寜鐓т互涓婁紭鍖栨柟鍚戝鎻愮ず璇嶈繘琛岄拡瀵规€т紭鍖栥€備緥濡傦細\n- "寮哄寲鍐茬獊"锛氬鍔犺鑹蹭箣闂寸殑瀵规姉銆佺煕鐩俱€佹垙鍓ф€у啿绐佸満鏅痋n- "鎻愬崌瓒ｅ懗"锛氬鍔犳悶绗戞ˉ娈点€佹剰澶栬浆鎶樸€佽交鏉炬椿娉煎厓绱燶n- "澧炲姞缃戠粶姊?锛氳瀺鍏ュ綋涓嬫祦琛岀殑缃戠粶鐑銆佽〃鎯呭寘寮忕敾闈€佸脊骞曟枃鍖栧厓绱燶n- "澧炲己鎯呮劅"锛氬姞娣辨儏鎰熸覆鏌擄紝澧炲姞鎰熶汉/鐑/娓╅Θ鐨勬儏鎰熺垎鍙戠偣\n- "鍔犲揩鑺傚"锛氱缉鐭瘡涓暅澶存椂闀匡紝澧炲姞蹇€熷壀杈戝拰杞満\n- "鎻愬崌璐ㄦ劅"锛氬姞鍏ョ數褰辩骇鍏夊奖銆侀珮绾ч厤鑹层€佷笓涓氳繍闀滄弿杩癭
    : '';

  const templateStr = userTemplate
    ? `\n\n銆愮敤鎴锋彁绀鸿瘝妯℃澘銆慭n妯℃澘鍚嶇О锛?{userTemplate.name}\n妯℃澘鍐呭锛歕n${userTemplate.template}`
    : '';

  const stage3Prompt = `浣犳槸涓€涓《灏栫殑 AI 瑙嗛鎻愮ず璇嶅伐绋嬪笀銆傜幇鍦ㄩ渶瑕佷綘鏍规嵁鐢ㄦ埛閫夋嫨鐨勭敾椋庡拰浼樺寲鏂瑰悜锛岄噸鏂扮敓鎴愬畬鏁寸殑 Seedance 2.0 瑙嗛鎻愮ず璇嶃€?

銆愬師濮嬭棰戝垎鏋愩€?
- 浜у搧锛?{visualData.product}
- 鍒嗙被锛?{visualData.category}
- 鍦烘櫙锛?{visualData.scene}
- 涓昏鍐呭锛?{visualData.mainContent}
- 鍗栫偣锛?{visualData.sellingPoints?.join('銆?)}
- 鐩爣浜虹兢锛?{visualData.targetAudience}
- 骞垮憡鎵嬫硶锛?{visualData.adTechnique}

銆愭椂闂磋酱鍒嗘瀽銆?
${timelineStr}

銆愬師濮嬫彁绀鸿瘝銆?
${originalPrompt}
${optimizeStr}${templateStr}

銆愮洰鏍囩敾椋庛€?{artStyle}

銆愪綘鐨勪换鍔°€?
1. 灏嗚棰戞暣浣撶敾椋庡垏鎹负銆?{artStyle}銆嶉鏍?
2. 鎸変紭鍖栨柟鍚戝鍐呭杩涜璋冩暣
3. 涓烘瘡涓椂闂磋妭鐐圭敓鎴愭柊鐨勬彁绀鸿瘝锛岀‘淇濆彴璇?鏃佺櫧瀵瑰簲鐨勭敾闈㈠湪鏂扮敾椋庝笅鐨勫悎鐞嗗憟鐜?
4. 鐢熸垚瀹屾暣鐨勪覆鑱旀彁绀鸿瘝

銆愮敾椋庤浆鎹㈡寚鍗椼€?
- Q鐗?浜屾鍏冿細瑙掕壊鍙樹负Q鐗堝ぇ澶村皬韬紝鍦嗘鼎鍙埍锛岀嚎鏉＄畝鍖栵紝鑹插僵鏄庡揩
- 鍐欏疄锛氳拷姹傜湡瀹炶川鎰燂紝娉ㄩ噸鍏夊奖缁嗚妭锛岀毊鑲ょ汗鐞嗙湡瀹烇紝鐜鍐欏疄
- 3D娓叉煋锛氱珛浣撴劅寮猴紝鏉愯川璐ㄦ劅绐佸嚭锛屽厜褰卞叏灞€鍏夌収锛岀被浼肩毊鍏嬫柉/姊﹀伐鍘傞鏍?
- 鐪熶汉锛氱湡浜哄嚭婕旓紝娉ㄩ噸婕斿憳琛ㄦ儏婕旀妧锛屾湇鍖栭亾绮捐嚧锛岃嚜鐒跺厜鎰?
- 璧涘崥鏈嬪厠锛氶湏铏圭伅鍏夛紝绉戞妧鎰燂紝鏆楄壊璋?楂橀ケ鍜屽害鐐圭紑锛屽叏鎭姇褰卞厓绱?
- 姘村ⅷ椋庯細涓浗姘村ⅷ鐢婚鏍硷紝鐣欑櫧鎰忓锛岀瑪瑙︽劅锛屾贰闆呰壊璋?
- 鍍忕礌椋庯細8-bit/16-bit 鍍忕礌鑹烘湳锛屽鍙ゆ父鎴忔劅锛屼綆鍒嗚鲸鐜囩編瀛?

杩斿洖绾?JSON锛堜笉瑕?markdown 浠ｇ爜鍧楋級锛?
{
  "artStyle": "${artStyle}",
  "timelinePrompts": [
    {
      "timeRange": "0:00-0:03",
      "prompt": "璇ユ椂闂存鍦ㄦ柊鐢婚+浼樺寲鏂瑰悜涓嬬殑 Seedance 鎻愮ず璇?
    }
  ],
  "seedancePrompt": "瀹屾暣鐨勯噸鏂扮敓鎴愮殑 Seedance 2.0 鎻愮ず璇嶏紝灏嗘墍鏈夋椂闂磋妭鐐瑰湪${artStyle}椋庢牸涓嬩覆鑱斾负涓€娈靛畬鏁淬€佹祦鐣呫€佽嚜鐒剁殑涓枃鎻忚堪",
  "changesSummary": "绠€杩扮浉姣斿師鎻愮ず璇嶇殑涓昏鍙樺寲锛?0瀛楀唴锛?
}`;

  console.log('  鈫?Stage 3: 鎻愮ず璇嶅彂灏?..');

  const response = await geminiRequest(
    `/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      contents: [{ parts: [{ text: stage3Prompt }] }],
      generationConfig: { maxOutputTokens: 6000, temperature: 0.8 }
    }
  );

  const text = response.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Stage 3: 鐢熸垚杩斿洖涓虹┖');

  try {
    const result = JSON.parse(cleanJsonResponse(text));
    console.log('  鈫?Stage 3 瀹屾垚锛岀敾椋?', artStyle, '鍙樺寲:', result.changesSummary);
    return {
      artStyle: result.artStyle || artStyle,
      timelinePrompts: result.timelinePrompts || [],
      seedancePrompt: result.seedancePrompt,
      changesSummary: result.changesSummary || ''
    };
  } catch (e) {
    console.error('  鈫?Stage 3 瑙ｆ瀽澶辫触:', text.substring(0, 500));
    throw new Error('Stage 3: 鏃犳硶瑙ｆ瀽鐢熸垚缁撴灉');
  }
}

// 鈹€鈹€ Start 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
app.listen(PORT, () => {
  console.log('\n鈺斺晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晽');
  console.log('鈺?  馃専 绻佹槦-瑙嗛鍒嗘瀽  v4.0                   鈺?);
  console.log('鈺犫晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨暎');
  console.log(`鈺?  鍦板潃: http://localhost:${PORT.toString().padEnd(20)}鈺慲);
  console.log('鈺?  妯″瀷: ' + GEMINI_MODEL.padEnd(32) + '鈺?);
  console.log('鈺氣晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨晲鈺愨暆\n');
});
