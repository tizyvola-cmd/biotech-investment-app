import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const DATA_DIR = resolve('..', 'data');
const lines = [];

// Check sec_k8
try {
  const k8 = JSON.parse(readFileSync(resolve(DATA_DIR, 'sec_k8_simulation_snapshot.json'), 'utf-8'));
  const rows = k8.rows || [];
  lines.push(`sec_k8 total rows: ${rows.length}`);
  const ltrn = rows.filter(r => String(r.Ticker || '').trim().toUpperCase() === 'LTRN');
  lines.push(`LTRN rows in k8: ${ltrn.length}`);
  if (ltrn.length > 0) {
    const r = ltrn[0];
    for (const [k, v] of Object.entries(r)) {
      if (typeof v === 'string' && v.length >= 3) {
        lines.push(`  col[${k}]: ${v.slice(0, 150)}`);
      }
    }
  } else {
    const tickers = [...new Set(rows.slice(0, 30).map(r => String(r.Ticker || '').trim().toUpperCase()))];
    lines.push(`  sample tickers: ${tickers.join(', ')}`);
  }
} catch (e) {
  lines.push(`sec_k8 error: ${e.message}`);
}

// Check catalyst_feed_snapshot
try {
  const cf = JSON.parse(readFileSync(resolve(DATA_DIR, 'catalyst_feed_snapshot.json'), 'utf-8'));
  const events = cf.events || [];
  lines.push(`\ncatalyst_feed events: ${events.length}`);
  const ltrn = events.filter(e => String(e.ticker || '').trim().toUpperCase() === 'LTRN');
  lines.push(`LTRN events: ${ltrn.length}`);
  for (const e of ltrn.slice(0, 3)) {
    const ext = e.extracted || {};
    lines.push(`  headline: ${(ext.headline || '').slice(0, 120)}`);
    lines.push(`  catalyst_type: ${ext.catalyst_type || ''}`);
    lines.push(`  items_label: ${(e.items_label || '').slice(0, 120)}`);
  }
} catch (e) {
  lines.push(`catalyst_feed error: ${e.message}`);
}

// Check catalyst_feed_cache
try {
  const cache = JSON.parse(readFileSync(resolve(DATA_DIR, 'catalyst_feed_cache.json'), 'utf-8'));
  lines.push(`\ncatalyst_feed_cache type: ${typeof cache}, keys: ${Object.keys(cache).length}`);
  const ltrn_key = Object.keys(cache).find(k => k.trim().toUpperCase() === 'LTRN');
  if (ltrn_key) {
    const entries = cache[ltrn_key];
    lines.push(`LTRN cache entries: ${Array.isArray(entries) ? entries.length : typeof entries}`);
    if (Array.isArray(entries)) {
      for (const ce of entries.slice(0, 2)) {
        lines.push(`  keys: ${Object.keys(ce).join(', ')}`);
        const text = String(ce.text || ce.content || '').slice(0, 200);
        lines.push(`  text: ${text}`);
      }
    }
  } else {
    lines.push(`LTRN not in cache. Sample keys: ${Object.keys(cache).slice(0, 10).join(', ')}`);
  }
} catch (e) {
  lines.push(`catalyst_feed_cache error: ${e.message}`);
}

console.log(lines.join('\n'));
