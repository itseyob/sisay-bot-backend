const express = require('express');
const fs = require('fs');
const path = require('path');
const rateLimit = require('express-rate-limit');

const app = express();
app.use(express.json());

// Rate limiting: max 10 orders per 15 seconds per IP
const limiter = rateLimit({
  windowMs: 15 * 1000,
  max: 10,
  message: { error: 'Too many orders, please wait.' }
});
app.use('/api/place-order', limiter);

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const BOT_TOKEN = process.env.BOT_TOKEN || "8657162810:AAF1MVAqD72TmHj6UyVj9zWuGbJKsFcFSoI";
const CHAT_ID = process.env.CHAT_ID || "7369177892";
const STATUS_FILE = path.join(__dirname, 'orders.json');
const COUNTER_FILE = path.join(__dirname, 'counter.json');

// Load next order number (global sequential)
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

// Endpoint for frontend to place an order
app.post('/api/place-order', async (req, res) => {
  const { table, cart, total, lines, time } = req.body;
  const orderNo = loadCounter();
  saveCounter(orderNo + 1);
  
  const msg = `🍽️ *NEW ORDER*\n🪑 *Table: ${table}*\n🔢 *#${orderNo}*\n${'─'.repeat(26)}\n${lines.join('\n')}\n${'─'.repeat(26)}\n💰 *${total.toLocaleString()} br*\n⏰ ${time}\n\n_/accept ${orderNo} or /reject ${orderNo}_`;
  
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT_ID, text: msg, parse_mode: 'Markdown' })
    });
    let orders = loadOrders();
    orders[orderNo] = { status: 'pending', table, total, lines, time };
    saveOrders(orders);
    res.json({ ok: true, orderNo });
  } catch(e) {
    res.status(500).json({ error: 'Failed to send order' });
  }
});

// Webhook for accept/reject
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

app.get('/api/orders', (req, res) => {
  res.json(loadOrders());
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
