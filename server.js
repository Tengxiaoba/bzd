const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));

// MiniMax 国际版 API
const TTS_API_URL = "https://api.minimax.io/v1/t2a_v2";
const VOICE_API_URL = "https://api.minimax.io/v1/get_voice";

// 克隆音色名称映射
const VOICE_NAME_MAP = {
    "moss_audio_3f80c1ef-dcf6-11f0-88f7-fec9520396cb": "郝易--结尾专用激情",
    "moss_audio_60d4abde-235f-11f1-8f0f-2617bd3a32f0": "男5激情稳定--2",
    "moss_audio_45d9de8c-235d-11f1-9331-0a0171fd8bfc": "男5激情稳定--1",
    "moss_audio_05c3dcb1-c13d-11f0-acdb-d238e4d54c00": "彭+郭翔+特征2--年轻专题",
    "moss_audio_2d1c4a07-637c-11f0-a61f-0aa8ddd4fb3f": "英语--专题A（几个人混）"
};

// 获取用户音色库
app.get("/api/voices", async (req, res) => {
    const api_key = req.query.api_key;
    const voice_source = req.query.source || 'library'; // library, collected, all
    
    if (!api_key) {
        return res.status(400).json({ success: false, error: "需要 API Key" });
    }
    
    try {
        console.log("正在获取用户音色库... source:", voice_source);
        
        // 根据 source 决定请求哪些音色
        const voiceTypes = voice_source === 'collected' ? 'voice_cloning' : 
                          voice_source === 'library' ? 'system' : 'all';
        
        const response = await fetch(VOICE_API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${api_key}`
            },
            body: JSON.stringify({
                voice_type: voiceTypes
            })
        });
        
        const data = await response.json();
        console.log("获取音色响应:", JSON.stringify(data.base_resp));
        
        if (data.base_resp && data.base_resp.status_code !== 0) {
            return res.json({ 
                success: false, 
                error: data.base_resp.status_msg 
            });
        }
        
        // 整理所有音色
        const voices = [];
        
        // 系统音色 (Library)
        if (data.system_voice && (voice_source === 'library' || voice_source === 'all')) {
            data.system_voice.forEach(v => {
                voices.push({
                    id: v.voice_id,
                    name: v.voice_name || v.voice_id,
                    gender: v.voice_id.includes("Female") ? "女" : "男",
                    tags: v.description || [],
                    source: "库"
                });
            });
        }
        
        // 克隆音色 (Collected Voices)
        if (data.voice_cloning && (voice_source === 'collected' || voice_source === 'all')) {
            data.voice_cloning.forEach(v => {
                const friendlyName = VOICE_NAME_MAP[v.voice_id] || v.voice_name || v.voice_id;
                voices.push({
                    id: v.voice_id,
                    name: friendlyName,
                    gender: "未知",
                    tags: [],
                    source: "收藏"
                });
            });
        }
        
        // 生成的音色 (不使用)
        // if (data.voice_voice_generation) {...}
        
        console.log(`获取到 ${voices.length} 个音色`);
        
        res.json({ 
            success: true, 
            voices: voices,
            total: voices.length
        });
        
    } catch (error) {
        console.error("获取音色失败:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 健康检查
app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// TTS 接口
app.post("/api/tts", async (req, res) => {
    try {
        const { text, voice_id, api_key } = req.body;
        
        if (!text || !api_key) {
            return res.status(400).json({ success: false, error: "Missing text or API key" });
        }
        
        console.log("TTS 请求 - Voice:", voice_id);
        
        const response = await fetch(TTS_API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${api_key}`
            },
            body: JSON.stringify({
                model: "speech-02-hd",
                text: text,
                stream: false,
                voice_setting: {
                    voice_id: voice_id,
                    speed: 1.0,
                    vol: 1.0,
                    pitch: 0
                },
                audio_setting: {
                    sample_rate: 32000,
                    bitrate: 128000,
                    format: "mp3",
                    channel: 1
                }
            })
        });
        
        console.log("API 响应状态:", response.status);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error("API 错误:", errorText);
            return res.status(response.status).json({ 
                success: false, 
                error: errorText 
            });
        }
        
        const jsonData = await response.json();
        
        if (jsonData.base_resp && jsonData.base_resp.status_code !== 0) {
            console.error("MiniMax 错误:", jsonData.base_resp.status_msg);
            return res.json({ 
                success: false, 
                error: jsonData.base_resp.status_msg 
            });
        }
        
        if (!jsonData.data || !jsonData.data.audio) {
            console.error("无音频数据");
            return res.json({ 
                success: false, 
                error: "No audio data returned" 
            });
        }
        
        const hexAudio = jsonData.data.audio;
        const buffer = Buffer.from(hexAudio, 'hex');
        const base64Audio = buffer.toString('base64');
        
        console.log("音频生成成功, 大小:", buffer.length, "字节");
        
        res.json({ 
            success: true, 
            audio_data: `data:audio/mpeg;base64,${base64Audio}`
        });
        
    } catch (error) {
        console.error("TTS 错误:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 播放前端页面
app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
    console.log(`配音工厂服务器启动成功!`);
    console.log(`请访问 http://localhost:${PORT}`);
    console.log(`TTS API: ${TTS_API_URL}`);
    console.log(`Voice API: ${VOICE_API_URL}`);
});
