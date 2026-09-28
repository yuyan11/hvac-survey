/* POST /api/submit —— 写入 D1
 * body: { form: 'onboarding' | 'hvac', data: {...} }
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
  });
}

export async function onRequestOptions() {
  return new Response(null, { headers: CORS });
}

export async function onRequestPost(ctx) {
  const { request, env } = ctx;

  if (!env.DB) return json({ ok: false, error: '数据库未绑定，请联系管理员配置 D1' }, 500);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ ok: false, error: '请求格式错误' }, 400);
  }

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
