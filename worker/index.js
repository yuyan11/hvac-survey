/* 统一入口 Worker：/api/* 走后端逻辑，其余交给静态资源（public/）
 *
 * 由原来的 Pages Functions（functions/api/*.js）合并而来。
 * Cloudflare 新版控制台把 Git 仓库统一建成 Worker，不再支持直接编译 functions/ 目录，
 * 所以这里改成 workers 标准签名 (request, env, ctx)，逻辑与原来完全一致。
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
  });
}

function safeParse(s) {
  try { return JSON.parse(s || '{}'); } catch (e) { return {}; }
}

/* ---------------- POST /api/submit：写入 D1 ---------------- */
async function submit(request, env) {
  if (!env.DB) return json({ ok: false, error: '数据库未绑定，请联系管理员配置 D1' }, 500);

  let body;
  try { body = await request.json(); }
  catch (e) { return json({ ok: false, error: '请求格式错误' }, 400); }

  const form = body && body.form;
  if (form !== 'combined' && form !== 'onboarding' && form !== 'hvac') {
    return json({ ok: false, error: '未知的表单类型' }, 400);
  }
  if (!body.data || typeof body.data !== 'object') {
    return json({ ok: false, error: '提交内容为空' }, 400);
  }

  const data = body.data;
  const pick = (...keys) => {
    for (const k of keys) if (data[k]) return String(data[k]);
    return '';
  };
  const name = pick('name', 'team_name');
  const phone = pick('phone', 'contact');
  const createdAt = new Date().toISOString();

  try {
    const res = await env.DB.prepare(
      'INSERT INTO submissions (form, created_at, name, phone, payload) VALUES (?, ?, ?, ?, ?)'
    ).bind(form, createdAt, name, phone, JSON.stringify(data)).run();
    return json({ ok: true, id: res.meta && res.meta.last_row_id ? res.meta.last_row_id : 0 });
  } catch (e) {
    return json({ ok: false, error: '写入数据库失败：' + (e.message || e) }, 500);
  }
}

/* ---------------- GET /api/results：管理员查看答卷 ---------------- */
async function results(request, env) {
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
    let list;
    try {
      const cols = full
        ? 'id, form, created_at, name, phone, payload'
        : "id, form, created_at, name, phone, COALESCE(json_extract(payload,'$._ref'),'') AS ref";
      const sql = form
        ? `SELECT ${cols} FROM submissions WHERE form = ? ORDER BY id DESC LIMIT 500`
        : `SELECT ${cols} FROM submissions ORDER BY id DESC LIMIT 500`;
      const stmt = form ? env.DB.prepare(sql).bind(form) : env.DB.prepare(sql);
      const r = await stmt.all();
      list = r.results || [];
    } catch (e) {
      // 运行环境不支持 JSON 函数时降级，列表不显示来源
      const sql = form
        ? 'SELECT id, form, created_at, name, phone FROM submissions WHERE form = ? ORDER BY id DESC LIMIT 500'
        : 'SELECT id, form, created_at, name, phone FROM submissions ORDER BY id DESC LIMIT 500';
      const stmt = form ? env.DB.prepare(sql).bind(form) : env.DB.prepare(sql);
      const r = await stmt.all();
      list = (r.results || []).map(x => Object.assign({ ref: '' }, x));
    }

    return json({ ok: true, list: full ? list.map(r => ({ ...r, payload: safeParse(r.payload) })) : list });
  } catch (e) {
    return json({ ok: false, error: '查询失败：' + (e.message || e) }, 500);
  }
}

/* ---------------- POST /api/upload：身份证照片存入 R2 ---------------- */
async function upload(request, env) {
  if (!env.IDCARDS) return json({ ok: false, error: '未绑定 R2 存储桶，请先创建并绑定 IDCARDS' }, 500);

  let form;
  try { form = await request.formData(); }
  catch (e) { return json({ ok: false, error: '上传格式错误' }, 400); }

  const id = String(form.get('id') || '');
  const side = String(form.get('side') || '');
  const file = form.get('file');

  if (!/^\d{1,12}$/.test(id)) return json({ ok: false, error: '问卷编号无效' }, 400);
  if (side !== 'front' && side !== 'back') return json({ ok: false, error: '照片面别无效' }, 400);
  if (!file || typeof file === 'string') return json({ ok: false, error: '未收到图片' }, 400);
  if (!/^image\//.test(file.type || '')) return json({ ok: false, error: '仅支持图片文件' }, 400);
  if (file.size > 8 * 1024 * 1024) return json({ ok: false, error: '图片超过 8MB' }, 400);

  const key = `idcard/${id}_${side}.jpg`;
  try {
    await env.IDCARDS.put(key, await file.arrayBuffer(), {
      httpMetadata: { contentType: 'image/jpeg' },
    });
    return json({ ok: true, key });
  } catch (e) {
    return json({ ok: false, error: '写入存储失败：' + (e.message || e) }, 500);
  }
}

/* ---------------- GET /api/photo：管理员读取身份证照片 ---------------- */
async function photo(request, env) {
  if (!env.IDCARDS) return new Response('未绑定 R2 存储桶', { status: 500 });
  if (!env.ADMIN_TOKEN) return new Response('未配置管理员口令', { status: 500 });

  const url = new URL(request.url);
  if (url.searchParams.get('token') !== env.ADMIN_TOKEN) {
    return new Response('口令错误', { status: 401 });
  }

  const id = String(url.searchParams.get('id') || '');
  const side = String(url.searchParams.get('side') || '');
  if (!/^\d{1,12}$/.test(id) || (side !== 'front' && side !== 'back')) {
    return new Response('参数无效', { status: 400 });
  }

  try {
    const obj = await env.IDCARDS.get(`idcard/${id}_${side}.jpg`);
    if (!obj) return new Response('照片不存在', { status: 404 });
    const type = (obj.httpMetadata && obj.httpMetadata.contentType) || 'image/jpeg';
    return new Response(obj.body, {
      headers: {
        'Content-Type': type,
        'Cache-Control': 'private, max-age=3600',
        'Cross-Origin-Resource-Policy': 'same-origin',
      },
    });
  } catch (e) {
    return new Response('读取失败', { status: 500 });
  }
}

/* ---------------- 路由 ---------------- */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === 'OPTIONS' && path.startsWith('/api/')) {
      return new Response(null, { headers: CORS });
    }

    if (path === '/api/submit') {
      if (method !== 'POST') return json({ ok: false, error: '仅支持 POST' }, 405);
      return submit(request, env);
    }
    if (path === '/api/results') {
      if (method !== 'GET') return json({ ok: false, error: '仅支持 GET' }, 405);
      return results(request, env);
    }
    if (path === '/api/upload') {
      if (method !== 'POST') return json({ ok: false, error: '仅支持 POST' }, 405);
      return upload(request, env);
    }
    if (path === '/api/photo') {
      if (method !== 'GET') return json({ ok: false, error: '仅支持 GET' }, 405);
      return photo(request, env);
    }
    if (path.startsWith('/api/')) {
      return json({ ok: false, error: '接口不存在' }, 404);
    }

    // 其余请求交给静态资源（public/）
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('静态资源未绑定（ASSETS）', { status: 500 });
  },
};
