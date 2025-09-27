// mongo.js — in-memory store for hackathon. Swap internals to Atlas later.

const crypto = require('crypto');
const SALT = 'auntie-demo-salt';
const store = new Map(); // key = phoneHash; value = { context, messages: [] }

function hashPhone(p) {
  return crypto.createHash('sha256').update(String(p) + SALT).digest('hex');
}

async function getContext(phone) {
  const key = hashPhone(phone);
  const row = store.get(key);
  return row?.context || { region: 'ON' };
}

async function saveMessage({ phone, intent, topic, message }) {
  const key = hashPhone(phone);
  const row = store.get(key) || { context: { region: 'ON' }, messages: [] };
  row.messages.push({
    ts: new Date().toISOString(),
    intent, topic, message: String(message).slice(0, 500)
  });
  store.set(key, row);
  return true;
}

// (optional) let your team set minimal context later:
async function setContext(phone, patch = {}) {
  const key = hashPhone(phone);
  const row = store.get(key) || { context: { region: 'ON' }, messages: [] };
  row.context = { ...row.context, ...patch };
  store.set(key, row);
  return row.context;
}

module.exports = { getContext, saveMessage, setContext, hashPhone };
