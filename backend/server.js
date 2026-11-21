const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const app = express();

// Middleware bảo mật
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));
app.use(cors({
  origin: '*',
  credentials: true
}));
app.use(bodyParser.json({ limit: '10kb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10kb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 60000,
  max: 20,
  message: { error: 'Quá nhiều yêu cầu, vui lòng thử lại sau 1 phút.' }
});
app.use('/api/chat', limiter);

// Khởi tạo Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || 'MISSING_KEY');
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

// Đọc knowledge base
function loadKnowledge() {
  const knowledgeDir = path.join(__dirname, 'rag/knowledge');
  const files = fs.readdirSync(knowledgeDir).filter(f => f.endsWith('.md'));
  let context = '';
  for (const file of files) {
    const content = fs.readFileSync(path.join(knowledgeDir, file), 'utf-8');
    context += `\n--- NGUỒN: ${file} ---\n${content}\n`;
  }
  return context;
}

const knowledgeContext = loadKnowledge();

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'startech-backend', ai: 'gemini-1.5-flash' });
});

// Chatbot API
app.post('/api/chat', async (req, res) => {
  const { message } = req.body;
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Thiếu tham số message' });
  }

  // Kiểm tra prompt injection cơ bản
  const suspiciousPatterns = [
    /ignore\s+previous\s+instructions/i,
    /system\s+prompt/i,
    /api\s+key/i,
    /password/i,
    /secret/i,
    /bypass/i,
    /override/i,
    /reveal/i,
    /print\s+your\s+instructions/i
  ];
  if (suspiciousPatterns.some(p => p.test(message))) {
    return res.json({
      answer: 'Xin lỗi, tôi không thể xử lý yêu cầu này.',
      sources: [],
      blocked: true
    });
  }

  if (message.length > 1000) {
    return res.status(400).json({ error: 'Tin nhắn quá dài' });
  }

  try {
    const systemPrompt = `Bạn là chatbot của STARTECH.
CHỈ trả lời dựa trên thông tin trong ngữ cảnh dưới đây.
Quy tắc:
- Nếu không có thông tin: "Xin lỗi, tôi không có thông tin về vấn đề này. Vui lòng liên hệ hotline 028.1234.5678."
- Không bịa thông tin.

NGỮ CẢNH:
${knowledgeContext}

CÂU HỎI: ${message}`;

    const result = await model.generateContent(systemPrompt);
    const response = await result.response;
    const answer = response.text() || 'Xin lỗi, tôi không thể tạo câu trả lời lúc này.';

    res.json({ answer, sources: ['startech-knowledge-base'] });
  } catch (err) {
    console.error('[Chatbot Error]:', err.message);
    res.status(500).json({ error: 'Lỗi AI' });
  }
});

// Phục vụ frontend static files
app.use(express.static(path.join(__dirname, '../frontend')));

// Fallback: phục vụ index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Khởi động server (chỉ chạy local, Vercel tự handle)
if (process.env.NODE_ENV !== 'production') {
  app.listen(8080, () => console.log('Backend chạy tại http://localhost:8080'));
}

module.exports = app;