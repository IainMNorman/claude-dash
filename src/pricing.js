// API list prices, $ per million tokens. Source: Anthropic model table cached 2026-11-03.
// readMult = cache-read price as a multiple of input (Fable 0.025x, Opus 5.5 / Sonnet 5.5 0.05x, others 0.1x).
// Cache writes: 1.25x input (5m TTL), 2x input (1h TTL).
const TABLE = [
  ['claude-fable-5-2', 8, 40, 0.025],
  ['claude-mythos-5-2', 8, 40, 0.025],
  ['claude-fable-5-1', 10, 50, 0.025],
  ['claude-mythos-5-1', 10, 50, 0.025],
  ['claude-fable-5', 10, 50, 0.1],
  ['claude-mythos-5', 10, 50, 0.1],
  ['claude-opus-5-5', 4, 20, 0.05],
  ['claude-opus-5', 5, 25, 0.1],
  ['claude-opus-4-8', 5, 25, 0.1],
  ['claude-opus-4-7', 5, 25, 0.1],
  ['claude-opus-4-6', 5, 25, 0.1],
  ['claude-sonnet-5-5', 2, 10, 0.05],
  ['claude-sonnet-5', 2, 10, 0.1],
  ['claude-sonnet-4-6', 3, 15, 0.1],
  ['claude-haiku-5-5', 0.1, 0.5, 0.1, { longAfter: 100000, longIn: 0.5, longOut: 2.5 }],
  ['claude-haiku-4-5', 1, 5, 0.1],
];

function normalise(model) {
  return String(model || '').toLowerCase().replace(/\[[^\]]*\]/g, '').replace(/-\d{8}$/, '').trim();
}

function priceFor(model) {
  const m = normalise(model);
  const hit = TABLE.find(([id]) => id === m);
  if (!hit) return null;
  const [, input, output, readMult, long] = hit;
  return { input, output, readMult, long: long || null };
}

function messageCost(usage, model) {
  const p = priceFor(model);
  if (!p || !usage) return null;
  const inTok = usage.input_tokens || 0;
  const outTok = usage.output_tokens || 0;
  const read = usage.cache_read_input_tokens || 0;
  const cw = usage.cache_creation_input_tokens || 0;
  const cc = usage.cache_creation || {};
  const w1h = cc.ephemeral_1h_input_tokens || 0;
  const w5m = cc.ephemeral_5m_input_tokens !== undefined ? cc.ephemeral_5m_input_tokens : Math.max(0, cw - w1h);
  let pin = p.input;
  let pout = p.output;
  if (p.long && inTok + read + cw > p.long.longAfter) { pin = p.long.longIn; pout = p.long.longOut; }
  const usd = (inTok * pin + outTok * pout + read * p.input * p.readMult + w5m * pin * 1.25 + w1h * pin * 2) / 1e6;
  return usd;
}

module.exports = { priceFor, messageCost, normalise };
