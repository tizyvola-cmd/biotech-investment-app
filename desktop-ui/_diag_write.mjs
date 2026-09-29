import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const DATA_DIR = resolve('..', 'data');
const OUT = resolve('public', '_diag_ltrn.json');
const result = {};

try {
  const k8 = JSON.parse(readFileSync(resolve(DATA_DIR, 'sec_k8_simulation_snapshot.json'), 'utf-8'));
  const rows = k8.rows || [];
  result.k8_total_rows = rows.length;
  const ltrn = rows.filter(r => String(r.Ticker || '').trim().toUpperCase() === 'LTRN');
  result.k8_ltrn_rows = ltrn.length;
  if (ltrn.length > 0) {
    const r = ltrn[0];
    result.k8_ltrn_cols = {};
    for (const [k, v] of Object.entries(r)) {
      if (typeof v === 'string' && v.length >= 3) {
        result.k8_ltrn_cols[k] = v.slice(0, 200);
      }
    }
  } else {
    result.k8_sample_tickers = [...new Set(rows.slice(0, 30).map(r => String(r.Ticker || '').trim().toUpperCase()))];
  }
} catch (e) {
  result.k8_error = e.message;
}

try {
  const cf = JSON.parse(readFileSync(resolve(DATA_DIR, 'catalyst_feed_snapshot.json'), 'utf-8'));
  const events = cf.events || [];
  result.cf_total_events = events.length;
  const ltrn = events.filter(e => String(e.ticker || '').trim().toUpperCase() === 'LTRN');
  result.cf_ltrn_events = ltrn.length;
  if (ltrn.length > 0) {
    result.cf_ltrn_sample = ltrn.slice(0, 2).map(e => ({
      headline: (e.extracted || {}).headline || '',
      catalyst_type: (e.extracted || {}).catalyst_type || '',
      items_label: (e.items_label || '').slice(0, 150)
    }));
  }
} catch (e) {
  result.cf_error = e.message;
}

try {
  const cache = JSON.parse(readFileSync(resolve(DATA_DIR, 'catalyst_feed_cache.json'), 'utf-8'));
  result.cache_keys_count = Object.keys(cache).length;
  const ltrn_key = Object.keys(cache).find(k => k.trim().toUpperCase() === 'LTRN');
  result.cache_has_ltrn = !!ltrn_key;
  if (ltrn_key) {
    const entries = cache[ltrn_key];
    result.cache_ltrn_count = Array.isArray(entries) ? entries.length : 0;
    if (Array.isArray(entries) && entries.length > 0) {
      result.cache_ltrn_sample = entries.slice(0, 1).map(ce => ({
        keys: Object.keys(ce),
        text_preview: String(ce.text || ce.content || ce.extracted?.text || '').slice(0, 300)
      }));
    }
  } else {
    result.cache_sample_keys = Object.keys(cache).slice(0, 15);
  }
} catch (e) {
  result.cache_error = e.message;
}

writeFileSync(OUT, JSON.stringify(result, null, 2), 'utf-8');
