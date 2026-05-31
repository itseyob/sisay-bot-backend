const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const BOT_TOKEN = "8657162810:AAF1MVAqD72TmHj6UyVj9zWuGbJKsFcFSoI";
const STATUS_FILE = path.join(__dirname, 'orders.json');

// Safe load/save with fallback
function loadOrders() {
  try {
    if (!fs.existsSync(STATUS_FILE)) return {};
    const data = fs.readFileSync(STATUS_FILE, 'utf8');
    if (!data.trim()) return {};
    return JSON.parse(data);
  } catch(e) {
    console.error("Error loading orders.json:", e.message);
    return {};
  }
}

function saveOrders(orders) {
  try {
    fs.writeFileSync(STATUS_FILE, JSON.stringify(orders, null, 2));
    console.log("Orders saved:", Object.keys(orders).length, "orders");
  } catch(e) {
    console.error("Error saving orders.json:", e.message);
  }
}

// Telegram webhook
app.post('/webhook', async (req, res) => {
  console.log("📩 Webhook received:", JSON.stringify(req.body).slice(0, 200));
  const message = req.body.message;
  if (!message || !message.text) return res.sendStatus(200);
  const text = message.text.trim();
  const chatId = message.chat.id;
  
  // Handle /status command
  if (text.toLowerCase() === '/status') {
    let orders = loadOrders();
    const orderList = Object.keys(orders).map(no => `#${no}: ${orders[no].status || 'pending'}`).join('\n');
    const reply = orderList ? `📋 Current orders:\n${orderList}` : "No orders yet.";
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: reply })
    });
    return res.sendStatus(200);
  }
  
  // Handle /accept or /reject
  const match = text.match(/^\/(accept|reject)\s+(\d+)$/i);
  if (match) {
    const action = match[1].toLowerCase();
    const orderNo = parseInt(match[2]);
    let orders = loadOrders();
    console.log(`📋 Current orders keys:`, Object.keys(orders));
    if (orders[orderNo]) {
      orders[orderNo].status = action === 'accept' ? 'accepted' : 'rejected';
      saveOrders(orders);
      console.log(`✅ Order #${orderNo} → ${orders[orderNo].status}`);
      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: `✅ Order #${orderNo} marked as ${action}ed.` })
      });
    } else {
      console.log(`❌ Order #${orderNo} not found`);
      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: `❌ Order #${orderNo} not found. Use /status to see current orders.` })
      });
    }
  }
  res.sendStatus(200);
});

app.get('/api/orders', (req, res) => {
  res.json(loadOrders());
});

app.post('/api/update', (req, res) => {
  const { orderNo, status, table, total, lines, time } = req.body;
  let orders = loadOrders();
  if (!orders[orderNo]) {
    orders[orderNo] = { status, table, total, lines, time };
  } else {
    orders[orderNo].status = status;
  }
  saveOrders(orders);
  console.log(`📝 Order #${orderNo} saved with status ${status}`);
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
