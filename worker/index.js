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

import { ocrWithProvider, normalizeId, PROVIDER_LABEL } from './ocr.js';

/* 当月字符串，形如 2026-09 —— 免费额度按自然月重置，用它标记某个账号本月是否已耗尽 */
function monthKey() {
  return new Date().toISOString().slice(0, 7);
}

async function bumpKeyFail(env, kid) {
  try {
    await env.DB.prepare('UPDATE ocr_keys SET fail_count = COALESCE(fail_count,0)+1, updated_at = ? WHERE id = ?')
      .bind(new Date().toISOString(), kid).run();
  } catch (e) { /* 记账失败不影响主流程 */ }
}

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
        ? 'id, form, created_at, name, phone, payload, ocr'
        : "id, form, created_at, name, phone, COALESCE(json_extract(payload,'$._ref'),'') AS ref, ocr";
      const sql = form
        ? `SELECT ${cols} FROM submissions WHERE form = ? ORDER BY id DESC LIMIT 500`
        : `SELECT ${cols} FROM submissions ORDER BY id DESC LIMIT 500`;
      const stmt = form ? env.DB.prepare(sql).bind(form) : env.DB.prepare(sql);
      const r = await stmt.all();
      list = r.results || [];
    } catch (e) {
      // 运行环境不支持 JSON 函数时降级，列表不显示来源
      const sql = form
        ? 'SELECT id, form, created_at, name, phone, ocr FROM submissions WHERE form = ? ORDER BY id DESC LIMIT 500'
        : 'SELECT id, form, created_at, name, phone, ocr FROM submissions ORDER BY id DESC LIMIT 500';
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
  // front=身份证人像面 back=国徽面 selfie=本人自拍照
  if (!['front', 'back', 'selfie'].includes(side)) return json({ ok: false, error: '照片类型无效' }, 400);
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
  if (!/^\d{1,12}$/.test(id) || !['front', 'back', 'selfie'].includes(side)) {
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

/* ---------------- POST /api/verify：OCR 核对身份证号 ----------------
 * 取 R2 里的人像面 → 按「厂商 + 账号」顺序尝试 OCR → 与填写的号码比对
 * 某个账号额度用完（ERR_QUOTA）就标记为本月耗尽，自动跳下一个账号 / 下一家厂商
 */
async function verify(request, env) {
  if (!env.DB) return json({ ok: false, error: '数据库未绑定' }, 500);

  let body;
  try { body = await request.json(); }
  catch (e) { return json({ ok: false, error: '请求格式错误' }, 400); }

  const id = String((body && body.id) || '');
  if (!/^\d{1,12}$/.test(id)) return json({ ok: false, error: '编号无效' }, 400);

  const row = await env.DB.prepare('SELECT id, created_at, payload, ocr FROM submissions WHERE id = ?').bind(id).first();
  if (!row) return json({ ok: false, error: '记录不存在' }, 404);

  // 已经核过就直接返回，避免重复消耗额度
  if (row.ocr) {
    try { return json({ ok: true, cached: true, ...JSON.parse(row.ocr) }); }
    catch (e) { /* 解析失败就重新核一次 */ }
  }

  // 防刷：只对提交后 6 小时内的记录做核验
  const age = Date.now() - new Date(row.created_at).getTime();
  if (age > 6 * 3600 * 1000) return json({ ok: false, error: '已超过可核验时间' }, 403);

  if (!env.IDCARDS) return json({ ok: false, error: '未绑定 R2 存储桶' }, 500);
  const obj = await env.IDCARDS.get(`idcard/${id}_front.jpg`);
  if (!obj) return json({ ok: false, error: '还没有身份证人像面照片' }, 404);
  const bytes = await obj.arrayBuffer();

  const m = monthKey();
  const ks = await env.DB.prepare(
    `SELECT id, provider, label, creds, fail_count FROM ocr_keys
     WHERE enabled = 1 AND (exhausted_month IS NULL OR exhausted_month = '' OR exhausted_month <> ?)
     ORDER BY fail_count ASC, id ASC`
  ).bind(m).all();
  const list = (ks && ks.results) || [];
  if (!list.length) return json({ ok: false, error: '没有可用的 OCR 账号（额度都耗尽或未配置）' }, 503);

  const typed = normalizeId((safeParse(row.payload) || {}).idcard || '');
  const tried = [];

  for (const k of list) {
    let creds = null;
    try { creds = JSON.parse(k.creds); } catch (e) { creds = null; }
    if (!creds) { await bumpKeyFail(env, k.id); tried.push({ provider: k.provider, error: '账号密钥格式错误' }); continue; }

    try {
      const now = new Date().toISOString();
      const r = await ocrWithProvider(k.provider, creds, bytes);
      const matched = !!(r.num && typed && r.num === typed);
      const result = {
        ok: true,
        provider: k.provider,
        providerLabel: PROVIDER_LABEL[k.provider] || k.provider,
        num: r.num || '',
        name: r.name || '',
        typed: typed,
        matched: matched,
        imageStatus: r.imageStatus || '',
        riskType: r.riskType || '',
        at: now,
      };
      await env.DB.prepare('UPDATE ocr_keys SET fail_count = 0, updated_at = ? WHERE id = ?').bind(now, k.id).run();
      await env.DB.prepare('UPDATE submissions SET ocr = ? WHERE id = ?').bind(JSON.stringify(result), id).run();
      return json(result);
    } catch (e) {
      const msg = (e && e.message) || String(e);
      tried.push({ provider: k.provider, code: (e && e.code) || '', error: msg.slice(0, 140) });
      // 「不是身份证 / 复印件 / 截图」是确定结论，直接落库并返回，别再换账号白耗额度
      if (e && e.notid) {
        const now = new Date().toISOString();
        const denied = {
          ok: true, notId: true, provider: k.provider,
          providerLabel: PROVIDER_LABEL[k.provider] || k.provider,
          num: '', name: '', typed: typed, matched: false,
          reason: msg, at: now,
        };
        await env.DB.prepare('UPDATE submissions SET ocr = ? WHERE id = ?').bind(JSON.stringify(denied), id).run();
        return json(denied);
      }
      if (e && e.quota) {
        await env.DB.prepare('UPDATE ocr_keys SET exhausted_month = ?, updated_at = ? WHERE id = ?')
          .bind(m, new Date().toISOString(), k.id).run();
      } else {
        await bumpKeyFail(env, k.id);
      }
    }
  }

  return json({ ok: false, error: '所有 OCR 账号都调用失败', tried }, 502);
}

/* ---------------- POST /api/ocr：即时识别（员工填表时自动填姓名/卡号） ----------------
 * body: { kind: 'idcard' | 'bankcard', side?: 'front'|'back', image: base64(无 data URI 头) }
 * 简单的按 isolate 滑动窗口限流，防止被人当免费 OCR 接口刷
 */
const ocrHits = new Map();

function rateLimited(key, max, windowMs) {
  const now = Date.now();
  const arr = (ocrHits.get(key) || []).filter(t => now - t < windowMs);
  arr.push(now);
  ocrHits.set(key, arr);
  if (ocrHits.size > 500) ocrHits.clear();
  return arr.length > max;
}

async function ocrNow(request, env) {
  if (!env.DB) return json({ ok: false, error: '数据库未绑定' }, 500);

  let b;
  try { b = await request.json(); }
  catch (e) { return json({ ok: false, error: '请求格式错误' }, 400); }

  const kind = String((b && b.kind) || '');
  if (!['idcard', 'bankcard'].includes(kind)) return json({ ok: false, error: 'kind 只支持 idcard / bankcard' }, 400);
  const side = String((b && b.side) || 'front');

  const ip = request.headers.get('cf-connecting-ip') || 'anon';
  if (rateLimited(ip + ':' + kind, 25, 10 * 60 * 1000)) {
    return json({ ok: false, error: '识别太频繁，请稍后再试' }, 429);
  }

  const img = String((b && b.image) || '');
  if (!img || img.length < 200) return json({ ok: false, error: '缺少图片' }, 400);
  let bytes;
  try {
    const bin = atob(img);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  } catch (e) { return json({ ok: false, error: '图片数据无效' }, 400); }

  const m = monthKey();
  const ks = await env.DB.prepare(
    `SELECT id, provider, creds, fail_count FROM ocr_keys
     WHERE enabled = 1 AND (exhausted_month IS NULL OR exhausted_month = '' OR exhausted_month <> ?)
     ORDER BY fail_count ASC, id ASC`
  ).bind(m).all();
  const list = (ks && ks.results) || [];
  if (!list.length) return json({ ok: false, error: '识别服务暂不可用（没有可用账号）' }, 503);

  const tried = [];
  for (const k of list) {
    let creds = null;
    try { creds = JSON.parse(k.creds); } catch (e) { creds = null; }
    if (!creds) { await bumpKeyFail(env, k.id); continue; }
    try {
      const r = await ocrWithProvider(k.provider, creds, bytes.buffer, { kind: kind, side: side });
      await env.DB.prepare('UPDATE ocr_keys SET fail_count = 0, updated_at = ? WHERE id = ?')
        .bind(new Date().toISOString(), k.id).run();
      return json({ ok: true, provider: k.provider, providerLabel: PROVIDER_LABEL[k.provider] || k.provider, result: r });
    } catch (e) {
      const msg = (e && e.message) || String(e);
      tried.push({ provider: k.provider, code: (e && e.code) || '', error: msg.slice(0, 140) });
      if (e && e.quota) {
        await env.DB.prepare('UPDATE ocr_keys SET exhausted_month = ?, updated_at = ? WHERE id = ?')
          .bind(m, new Date().toISOString(), k.id).run();
      } else {
        await bumpKeyFail(env, k.id);
      }
      if (e && e.notid) break; // 「这不是身份证」属于业务问题，换账号也没用，直接返回
    }
  }
  const first = tried[0] || {};
  return json({ ok: false, code: first.code || 'fail', error: first.error || '识别失败', tried }, 200);
}

/* ---------------- 员工信息登记表：独立表 / 独立 key 前缀 / 独立后台 ----------------
 * 与入职考察问卷完全隔离：employees 表 + employee/ 前缀的 R2 对象，互不干扰、编号各算各的
 */

async function employeeSubmit(request, env) {
  if (!env.DB) return json({ ok: false, error: '数据库未绑定' }, 500);
  let b;
  try { b = await request.json(); }
  catch (e) { return json({ ok: false, error: '请求格式错误' }, 400); }

  const data = (b && b.data) || {};
  const name = String(data.name || '').trim();
  const phone = String(data.phone || '').trim();
  const idcard = normalizeId(data.idcard || '');
  if (!name) return json({ ok: false, error: '请填写姓名' }, 400);
  if (!/^1[3-9]\d{9}$/.test(phone)) return json({ ok: false, error: '手机号格式不正确' }, 400);
  if (!/^\d{17}[\dXx]$/.test(idcard)) return json({ ok: false, error: '身份证号格式不正确' }, 400);

  try {
    const res = await env.DB.prepare(
      'INSERT INTO employees (created_at, name, phone, idcard, card_no, card_bank, payload) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      new Date().toISOString(), name, phone, idcard,
      String(data.card_no || ''), String(data.card_bank || ''), JSON.stringify(data)
    ).run();
    return json({ ok: true, id: res.meta && res.meta.last_row_id ? res.meta.last_row_id : 0 });
  } catch (e) {
    return json({ ok: false, error: '写入失败：' + (e.message || e) }, 500);
  }
}

async function employeeResults(request, env, url) {
  if (!env.DB) return json({ ok: false, error: '数据库未绑定' }, 500);
  if (!adminOk(url, env)) return json({ ok: false, error: '口令错误' }, 401);

  const id = String(url.searchParams.get('id') || '');
  try {
    if (id) {
      if (!/^\d+$/.test(id)) return json({ ok: false, error: 'id 无效' }, 400);
      const row = await env.DB.prepare('SELECT * FROM employees WHERE id = ?').bind(id).first();
      if (!row) return json({ ok: false, error: '记录不存在' }, 404);
      return json({ ok: true, item: { ...row, payload: safeParse(row.payload) } });
    }
    const r = await env.DB.prepare(
      'SELECT id, created_at, name, phone, idcard, card_no, card_bank FROM employees ORDER BY id DESC LIMIT 500'
    ).all();
    return json({ ok: true, list: (r && r.results) || [] });
  } catch (e) {
    return json({ ok: false, error: '查询失败：' + (e.message || e) }, 500);
  }
}

async function employeePhoto(request, env, url) {
  if (!adminOk(url, env)) return new Response('口令错误', { status: 401 });
  if (!env.IDCARDS) return new Response('未绑定 R2 存储桶', { status: 500 });
  const id = String(url.searchParams.get('id') || '');
  const side = String(url.searchParams.get('side') || '');
  if (!/^\d+$/.test(id) || !['front', 'back', 'selfie'].includes(side)) {
    return new Response('参数无效', { status: 400 });
  }
  try {
    const obj = await env.IDCARDS.get(`employee/${id}_${side}.jpg`);
    if (!obj) return new Response('照片不存在', { status: 404 });
    const type = (obj.httpMetadata && obj.httpMetadata.contentType) || 'image/jpeg';
    return new Response(obj.body, {
      headers: { 'Content-Type': type, 'Cache-Control': 'private, max-age=3600' },
    });
  } catch (e) {
    return new Response('读取失败', { status: 500 });
  }
}

/* 员工照片上传：走独立前缀 employee/，与问卷的 idcard/ 隔开 */
async function employeeUpload(request, env) {
  if (!env.IDCARDS) return json({ ok: false, error: '未绑定 R2 存储桶' }, 500);
  let form;
  try { form = await request.formData(); }
  catch (e) { return json({ ok: false, error: '上传格式错误' }, 400); }

  const id = String(form.get('id') || '');
  const side = String(form.get('side') || '');
  const file = form.get('file');
  if (!/^\d{1,12}$/.test(id)) return json({ ok: false, error: '编号无效' }, 400);
  if (!['front', 'back', 'selfie'].includes(side)) return json({ ok: false, error: '照片类型无效' }, 400);
  if (!file || typeof file === 'string') return json({ ok: false, error: '未收到图片' }, 400);
  if (!/^image\//.test(file.type || '')) return json({ ok: false, error: '仅支持图片文件' }, 400);
  if (file.size > 8 * 1024 * 1024) return json({ ok: false, error: '图片超过 8MB' }, 400);

  const key = `employee/${id}_${side}.jpg`;
  try {
    await env.IDCARDS.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: 'image/jpeg' } });
    return json({ ok: true, key: key });
  } catch (e) {
    return json({ ok: false, error: '写入存储失败：' + (e.message || e) }, 500);
  }
}

/* ---------------- /api/ocr-keys：OCR 账号管理（需管理员口令） ---------------- */
function adminOk(url, env) {
  return env.ADMIN_TOKEN && url.searchParams.get('token') === env.ADMIN_TOKEN;
}

async function ocrKeys(request, env, url) {
  if (!env.DB) return json({ ok: false, error: '数据库未绑定' }, 500);
  if (!adminOk(url, env)) return json({ ok: false, error: '口令错误' }, 401);

  if (request.method === 'GET') {
    const r = await env.DB.prepare(
      'SELECT id, provider, label, enabled, exhausted_month, fail_count, updated_at FROM ocr_keys ORDER BY id'
    ).all();
    return json({ ok: true, list: (r && r.results) || [] });
  }

  if (request.method === 'POST') {
    let b;
    try { b = await request.json(); } catch (e) { return json({ ok: false, error: '请求格式错误' }, 400); }
    const provider = String((b && b.provider) || '');
    if (!['baidu', 'tencent', 'aliyun'].includes(provider)) return json({ ok: false, error: '厂商只支持 baidu / tencent / aliyun' }, 400);
    const creds = b && b.creds;
    if (!creds || typeof creds !== 'object') return json({ ok: false, error: '缺少 creds' }, 400);
    await env.DB.prepare(
      'INSERT INTO ocr_keys (provider, label, creds, enabled, exhausted_month, fail_count, updated_at) VALUES (?, ?, ?, 1, ?, 0, ?)'
    ).bind(provider, String((b.label || '').slice(0, 60)), JSON.stringify(creds), '', new Date().toISOString()).run();
    return json({ ok: true });
  }

  if (request.method === 'DELETE') {
    const kid = String(url.searchParams.get('id') || '');
    if (!/^\d+$/.test(kid)) return json({ ok: false, error: '缺少 id' }, 400);
    await env.DB.prepare('DELETE FROM ocr_keys WHERE id = ?').bind(kid).run();
    return json({ ok: true });
  }

  return json({ ok: false, error: '不支持的方法' }, 405);
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
    if (path === '/api/verify') {
      if (method !== 'POST') return json({ ok: false, error: '仅支持 POST' }, 405);
      return verify(request, env);
    }
    if (path === '/api/ocr') {
      if (method !== 'POST') return json({ ok: false, error: '仅支持 POST' }, 405);
      return ocrNow(request, env);
    }
    if (path === '/api/ocr-keys') {
      return ocrKeys(request, env, url);
    }
    if (path === '/api/employee/submit') {
      if (method !== 'POST') return json({ ok: false, error: '仅支持 POST' }, 405);
      return employeeSubmit(request, env);
    }
    if (path === '/api/employee/results') {
      if (method !== 'GET') return json({ ok: false, error: '仅支持 GET' }, 405);
      return employeeResults(request, env, url);
    }
    if (path === '/api/employee/photo') {
      if (method !== 'GET') return json({ ok: false, error: '仅支持 GET' }, 405);
      return employeePhoto(request, env, url);
    }
    if (path === '/api/employee/upload') {
      if (method !== 'POST') return json({ ok: false, error: '仅支持 POST' }, 405);
      return employeeUpload(request, env);
    }
    if (path.startsWith('/api/')) {
      return json({ ok: false, error: '接口不存在' }, 404);
    }

    // 其余请求交给静态资源（public/）
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('静态资源未绑定（ASSETS）', { status: 500 });
  },
};
