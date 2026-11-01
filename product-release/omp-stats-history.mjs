import { DatabaseSync } from "node:sqlite";

export function readOmpStatsHistory(databasePath, since, now = Date.now(), limit = 30, onSelect = null) {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const where = "recorded_at >= ? AND recorded_at <= ?";
    onSelect?.();
    const [summary] = db.prepare(`SELECT count(*) AS records, min(recorded_at) AS earliest, COALESCE(sum(COALESCE(requests, 0)), 0) AS requests, COALESCE(sum(COALESCE(input_tokens, 0)), 0) AS input, COALESCE(sum(COALESCE(output_tokens, 0)), 0) AS output, COALESCE(sum(COALESCE(cache_read_tokens, 0) + COALESCE(cache_write_tokens, 0)), 0) AS cache FROM client_usage WHERE ${where}`).all(since, now);
    onSelect?.();
    const items = db.prepare(`SELECT recorded_at, app, provider, model, requests, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, install_id FROM client_usage WHERE ${where} ORDER BY recorded_at DESC LIMIT ?`).all(since, now, limit).map((row) => ({
      timestamp: new Date(Number(row.recorded_at)).toISOString(),
      app: String(row.app || "OMP"),
      provider: String(row.provider || "OMP"),
      model: String(row.model || "--"),
      requests: Number(row.requests) || 0,
      input: Number(row.input_tokens) || 0,
      output: Number(row.output_tokens) || 0,
      cacheRead: Number(row.cache_read_tokens) || 0,
      cacheWrite: Number(row.cache_write_tokens) || 0,
      cache: (Number(row.cache_read_tokens) || 0) + (Number(row.cache_write_tokens) || 0),
      total: (Number(row.input_tokens) || 0) + (Number(row.output_tokens) || 0),
      costUsd: row.cost_usd == null ? null : Number(row.cost_usd),
      installId: row.install_id == null ? "" : String(row.install_id),
    }));
    return {
      available: true,
      records: Number(summary.records) || 0,
      earliestTimestamp: summary.earliest == null ? null : Number(summary.earliest),
      requests: Number(summary.requests) || 0,
      input: Number(summary.input) || 0,
      output: Number(summary.output) || 0,
      cache: Number(summary.cache) || 0,
      total: (Number(summary.input) || 0) + (Number(summary.output) || 0),
      items,
    };
  } finally {
    db.close();
  }
}

export function readOmpStatsTrend(databasePath, since, now, start, bucketMs, bucketCount, onSelect = null) {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    onSelect?.();
    const rows = db.prepare(`SELECT CAST((recorded_at - ?) / ? AS INTEGER) AS bucket, COALESCE(sum(COALESCE(input_tokens, 0)), 0) AS input, COALESCE(sum(COALESCE(output_tokens, 0)), 0) AS output, COALESCE(sum(COALESCE(cache_read_tokens, 0) + COALESCE(cache_write_tokens, 0)), 0) AS cache FROM client_usage WHERE recorded_at >= ? AND recorded_at <= ? GROUP BY bucket`).all(start, bucketMs, since, now);
    const buckets = new Map();
    for (const row of rows) {
      const bucket = Math.min(bucketCount - 1, Math.max(0, Number(row.bucket) || 0));
      const values = buckets.get(bucket) || { bucket, input: 0, output: 0, cache: 0 };
      values.input += Number(row.input) || 0;
      values.output += Number(row.output) || 0;
      values.cache += Number(row.cache) || 0;
      buckets.set(bucket, values);
    }
    return [...buckets.values()].sort((a, b) => a.bucket - b.bucket);
  } finally {
    db.close();
  }
}
