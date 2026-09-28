/* GET /api/results —— 管理员查看答卷
 * query: token（管理员口令）, form（onboarding | hvac，可选）, id（可选，取单条完整内容）
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
  });
}

function safeParse(s) { try { return JSON.parse(s || '{}'); } catch (e) { return {}; } }

export async function onRequestOptions() {
  return new Response(null, { headers: CORS });
}

export async function onRequestGet(ctx) {
  const { request, env } = ctx;

  if (!env.DB) return json({ ok: false, error: '数据库未绑定' }, 500);
  if (!env.ADMIN_TOKEN) return json({ ok: false, error: '未配置管理员口令' }, 500);

  const url = new URL(request.url);
  if (url.searchParams.get('token') !== env.ADMIN_TOKEN) {
    return json({ ok: false, error: '口令错误' }, 401);
  }

  const form = url.searchParams.get('form');
  const id = url.searchParams.get('id');

  try {
    if (id) {
      const row = await env.DB.prepare('SELECT * FROM submissions WHERE id = ?').bind(id).first();
      if (!row) return json({ ok: false, error: '记录不存在' }, 404);
      return json({ ok: true, item: { ...row, payload: JSON.parse(row.payload || '{}') } });
    }

    const full = url.searchParams.get('full') === '1';
    let results;
    try {
      const cols = full
        ? 'id, form, created_at, name, phone, payload'
        : "id, form, created_at, name, phone, COALESCE(json_extract(payload,'$._ref'),'') AS ref";
      const sql = form
        ? `SELECT ${cols} FROM submissions WHERE form = ? ORDER BY id DESC LIMIT 500`
        : `SELECT ${cols} FROM submissions ORDER BY id DESC LIMIT 500`;
      const stmt = form ? env.DB.prepare(sql).bind(form) : env.DB.prepare(sql);
      const r = await stmt.all();
      results = r.results || [];
    } catch (e) {
      // 运行环境不支持 JSON 函数时降级，列表不显示来源
      const sql = form
        ? 'SELECT id, form, created_at, name, phone FROM submissions WHERE form = ? ORDER BY id DESC LIMIT 500'
        : 'SELECT id, form, created_at, name, phone FROM submissions ORDER BY id DESC LIMIT 500';
      const stmt = form ? env.DB.prepare(sql).bind(form) : env.DB.prepare(sql);
      const r = await stmt.all();
      results = (r.results || []).map(x => Object.assign({ ref: '' }, x));
    }

    const list = results.map(r =>
      full ? { ...r, payload: safeParse(r.payload) } : r
    );
    return json({ ok: true, list });
  } catch (e) {
    return json({ ok: false, error: '查询失败：' + (e.message || e) }, 500);
  }
}
