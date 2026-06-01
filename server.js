const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// ========== ENVIRONMENT VARIABLES (set on Render) ==========
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const API_KEY = process.env.API_KEY; // optional, not used but kept for compatibility

let bot = null;
if (BOT_TOKEN && CHAT_ID) {
  bot = new TelegramBot(BOT_TOKEN, { polling: false });
  console.log('✅ Telegram bot enabled');
} else {
  console.warn('⚠️ Telegram disabled: missing BOT_TOKEN or CHAT_ID');
}

// ========== In-memory storage ==========
let sessions = {};        // { table: { sessionToken, active, createdAt } }
let orders = [];
let nextOrderId = 1000;
let rateLimit = {};
let lastOrderToken = null;

function isValidTable(table) {
  const t = parseInt(table);
  return t >= 1 && t <= 20;
}

function checkRateLimit(table) {
  const now = Date.now();
  const last = rateLimit[table] || 0;
  if (now - last < 20000) return false;
  rateLimit[table] = now;
  return true;
}

async function sendTelegram(order) {
  if (!bot) return;
  const msg = `🆕 *New Order #${order.orderNumber}*\n🍽️ Table: ${order.table}\n📋 ${order.items.map(i => `${i.name} x${i.qty}`).join(', ')}\n💰 Total: ${order.total} br\n🕒 Status: ${order.status}`;
  try {
    await bot.sendMessage(CHAT_ID, msg, { parse_mode: 'Markdown' });
  } catch(e) { console.error('Telegram error:', e.message); }
}

// ========== CUSTOMER ENDPOINTS ==========
app.get('/api/validate-session', (req, res) => {
  const { table, session } = req.query;
  if (!isValidTable(table)) return res.json({ valid: false });
  const sess = sessions[table];
  if (sess && sess.sessionToken === session && sess.active === true) {
    return res.json({ valid: true });
  }
  res.json({ valid: false });
});

app.post('/api/place-order', (req, res) => {
  const { table, session, items, total, orderToken } = req.body;
  if (!isValidTable(table)) return res.status(400).json({ error: 'Invalid table' });
  const sess = sessions[table];
  if (!sess || sess.sessionToken !== session || !sess.active) {
    return res.status(403).json({ error: 'Table not active' });
  }
  if (!checkRateLimit(table)) {
    return res.status(429).json({ error: 'Please wait 20 seconds before ordering again' });
  }
  if (lastOrderToken === orderToken) {
    return res.status(409).json({ error: 'Duplicate order' });
  }
  lastOrderToken = orderToken;
  setTimeout(() => { lastOrderToken = null; }, 5000);

  const orderId = nextOrderId++;
  const orderNumber = `ORD-${orderId}`;
  const newOrder = {
    id: orderId,
    orderNumber,
    table: parseInt(table),
    session,
    items,
    total,
    status: 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  orders.push(newOrder);
  sendTelegram(newOrder);
  res.json({ ok: true, orderNumber });
});

app.get('/api/orders', (req, res) => {
  const { table, session } = req.query;
  if (!isValidTable(table)) return res.json({ orders: [] });
  const sess = sessions[table];
  if (!sess || sess.sessionToken !== session) return res.json({ orders: [] });
  const userOrders = orders.filter(o => o.table == table && o.session === session);
  res.json({ orders: userOrders });
});

app.post('/api/cancel-order/:orderId', (req, res) => {
  const { table, session } = req.body;
  const orderId = parseInt(req.params.orderId);
  const order = orders.find(o => o.id === orderId);
  if (!order) return res.status(404).json({ error: 'Not found' });
  if (order.table != table || order.session !== session) return res.status(403).json({ error: 'Not allowed' });
  const elapsed = Date.now() - new Date(order.createdAt).getTime();
  if (elapsed > 30000) return res.status(400).json({ error: 'Cancellation window closed' });
  if (order.status !== 'pending') return res.status(400).json({ error: 'Cannot cancel now' });
  order.status = 'cancelled';
  res.json({ ok: true });
});

// ========== STAFF ENDPOINTS (Admin) ==========
const adminAuth = (req, res, next) => {
  const pass = req.headers['x-admin-password'];
  if (pass !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
  next();
};

app.post('/api/admin/activate-table', adminAuth, (req, res) => {
  const { table } = req.body;
  if (!isValidTable(table)) return res.status(400).json({ error: 'Invalid table' });
  const sessionToken = Math.random().toString(36).substring(2, 8).toUpperCase();
  sessions[table] = {
    sessionToken,
    active: true,
    createdAt: Date.now()
  };
  res.json({ ok: true, session: sessionToken, qrUrl: `/?table=${table}&session=${sessionToken}` });
});

app.post('/api/admin/deactivate-table', adminAuth, (req, res) => {
  const { table } = req.body;
  if (sessions[table]) {
    sessions[table].active = false;
    delete sessions[table];
  }
  res.json({ ok: true });
});

app.get('/api/admin/tables', adminAuth, (req, res) => {
  const tableStatus = {};
  for (let i = 1; i <= 20; i++) {
    tableStatus[i] = sessions[i] ? { active: true, session: sessions[i].sessionToken } : { active: false };
  }
  res.json({ tables: tableStatus });
});

app.get('/api/admin/orders', adminAuth, (req, res) => {
  const pending = orders.filter(o => o.status !== 'cancelled' && o.status !== 'served');
  res.json({ orders: pending });
});

app.post('/api/admin/update-status', adminAuth, (req, res) => {
  const { orderId, status } = req.body;
  const order = orders.find(o => o.id == orderId);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  order.status = status;
  order.updatedAt = new Date().toISOString();
  res.json({ ok: true });
});

app.get('/api/admin/analytics', adminAuth, (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const todaysOrders = orders.filter(o => o.createdAt.startsWith(today) && o.status !== 'cancelled');
  const revenue = todaysOrders.reduce((sum, o) => sum + o.total, 0);
  const itemCount = {};
  todaysOrders.forEach(o => {
    o.items.forEach(it => { itemCount[it.name] = (itemCount[it.name] || 0) + it.qty; });
  });
  const topItems = Object.entries(itemCount).sort((a,b) => b[1] - a[1]).slice(0,3).map(([name]) => name);
  res.json({ todayOrders: todaysOrders.length, revenue, topItems });
});

// Serve static frontend files
app.use(express.static('public'));

// Redirect root to staff panel
app.get('/', (req, res) => {
  res.redirect('/staff.html');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
