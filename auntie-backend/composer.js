// composer.js — formats every SMS Auntie sends

const MAX_TOTAL = 300;               // hard cap for the whole message
const SIGNOFF   = '—Auntie 🌸';       // cozy sign-off

function shortUrl(u='') {
  return u.replace(/^https?:\/\//,'').replace(/^www\./,'');
}

function clamp(str, max) {
  if (!str) return '';
  const s = str.trim().replace(/\s+/g,' ');
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function formatResources(resources=[], remainingBudget=120) {
  const lines = [];
  for (const r of resources.slice(0, 2)) {
    let line = `• ${r.name || 'Resource'}`;
    if (r.phone) line += ` (${r.phone})`;
    if (r.url)   line += ` ${shortUrl(r.url)}`;
    line = clamp(line, 90);                   // keep resource lines short
    if (lines.join('\n').length + line.length + 1 > remainingBudget) break;
    lines.push(line);
  }
  return lines;
}

function formatReply({ bodyText='', resources=[] }) {
  // Reserve space for sign-off and up to 2 resource lines
  const reserveForSignoff = SIGNOFF.length + 1;
  const reserveForRes = resources.length ? 100 : 0;        // rough budget
  const bodyBudget = Math.max(80, MAX_TOTAL - reserveForSignoff - reserveForRes);

  const body = clamp(bodyText, bodyBudget);
  const remaining = MAX_TOTAL - (body.length + 1 + reserveForSignoff);
  const resLines = formatResources(resources, remaining);

  return [body, SIGNOFF, ...resLines].join('\n');
}

module.exports = { formatReply };
