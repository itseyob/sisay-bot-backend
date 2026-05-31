const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const BOT_TOKEN = "8657162810:AAF1MVAqD72TmHj6UyVj9zWuGbJKsFcFSoI";
const STATUS_FILE = path.join(__dirname, 'orders.json');

// Load / save orders
function loadOrders() {
  if (!fs.existsSync(STATUS_FILE)) return {};
  return JSON.parse(fs.readFileSync(STATUS_FILE));
}
function saveOrders(orders) {
  fs.writeFileSync(STATUS_FILE, JSON.stringify(orders, null, 2));
}

// Webhook for Telegram commands
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

// API for frontend to get all statuses
app.get('/api/orders', (req, res) => {
  res.json(loadOrders());
});

// API to create/update order status (frontend calls when placing order)
app.post('/api/update', (req, res) => {
  const { orderNo, status, table, total, lines, time } = req.body;
  let orders = loadOrders();
  if (!orders[orderNo]) {
    orders[orderNo] = { status, table, total, lines, time };
  } else {
    orders[orderNo].status = status;
  }
  saveOrders(orders);
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
