const express = require('express');
const fs = require('fs');
const path = require('path');
const rateLimit = require('express-rate-limit');

const app = express();
app.use(express.json());

// ========== HELPER: Escape HTML to prevent injection ==========
function escapeHtml(str) {
  if (!str) return str;
  return str.replace(/[&<>]/g, function(m) {
    if (m === '&') return '&amp;';
    if (m === '<') return '&lt;';
    if (m === '>') return '&gt;';
    return m;
  });
}

// ========== RATE LIMITING (already there) ==========
const limiter = rateLimit({
  windowMs: 15 * 1000,
  max: 10,
  message: { error: 'Too many orders, please wait.' }
});
app.use('/api/place-order', limiter);

// ========== CORS ==========
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, X-API-Key');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ========== ENVIRONMENT VARIABLES ==========
const BOT_TOKEN = process.env.BOT_TOKEN || "8657162810:AAF1MVAqD72TmHj6UyVj9zWuGbJKsFcFSoI";
const CHAT_ID = process.env.CHAT_ID || "7369177892";
const API_KEY = process.env.API_KEY || "your-secret-key-change-this";  // <-- SET THIS ON RENDER

const STATUS_FILE = path.join(__dirname, 'orders.json');
const COUNTER_FILE = path.join(__dirname, 'counter.json');

// ========== HELPERS FOR FILE STORAGE ==========
function loadCounter() {
  try {
    if (!fs.existsSync(COUNTER_FILE)) return 1;
    const data = fs.readFileSync(COUNTER_FILE, 'utf8');
    return data ? JSON.parse(data).next : 1;
  } catch(e) { return 1; }
}
function saveCounter(next) {
  fs.writeFileSync(COUNTER_FILE, JSON.stringify({ next }));
}

function loadOrders() {
  try {
    if (!fs.existsSync(STATUS_FILE)) return {};
    const data = fs.readFileSync(STATUS_FILE, 'utf8');
    return data ? JSON.parse(data) : {};
  } catch(e) { return {}; }
}
function saveOrders(orders) {
  fs.writeFileSync(STATUS_FILE, JSON.stringify(orders, null, 2));
}

// ========== PLACE ORDER ENDPOINT (with sanitization) ==========
app.post('/api/place-order', async (req, res) => {
  // Optional API key check (if you want to protect this endpoint as well)
  const apiKey = req.headers['x-api-key'];
  if (apiKey !== API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { table, total, lines, time } = req.body;
  const orderNo = loadCounter();
  saveCounter(orderNo + 1);
  
  // SANITIZE each line to prevent HTML injection
  const sanitizedLines = lines.map(line => escapeHtml(line));
  
  const msg = `🍽️ *NEW ORDER*\n🪑 *Table: ${table}*\n🔢 *#${orderNo}*\n${'─'.repeat(26)}\n${sanitizedLines.join('\n')}\n${'─'.repeat(26)}\n💰 *${total.toLocaleString()} br*\n⏰ ${time}\n\n_/accept ${orderNo} or /reject ${orderNo}_`;
  
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT_ID, text: msg, parse_mode: 'Markdown' })
    });
    let orders = loadOrders();
    orders[orderNo] = { 
      status: 'pending', 
      table, 
      total, 
      lines: sanitizedLines,   // store sanitized version
      time,
      createdAt: Date.now()    // for auto‑deletion later
    };
    saveOrders(orders);
    res.json({ ok: true, orderNo });
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to send order' });
  }
});

// ========== WEBHOOK FOR ACCEPT/REJECT ==========
app.post('/webhook', async (req, res) => {
  const message = req.body.message;
  if (!message || !message.text) return res.sendStatus(200);
  const text = message.text.trim();
  const chatId = message.chat.id;
  const match = text.match(/^\/(accept|reject)\s+(\d+)$/i);
  if (match) {
    const action = match[1].toLowerCase();
    const orderNo = parseInt(match[2]);
    let orders = loadOrders();
    if (orders[orderNo]) {
      orders[orderNo].status = action === 'accept' ? 'accepted' : 'rejected';
      saveOrders(orders);
      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: `✅ Order #${orderNo} marked as ${action}ed.` })
      });
    } else {
      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: `❌ Order #${orderNo} not found.` })
      });
    }
  }
  res.sendStatus(200);
});

// ========== GET ORDERS (protected by API key) ==========
app.get('/api/orders', (req, res) => {
  const apiKey = req.headers['x-api-key'];
  if (apiKey !== API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.json(loadOrders());
});

// ========== START SERVER ==========
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
