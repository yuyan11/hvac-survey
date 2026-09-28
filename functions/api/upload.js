/* POST /api/upload —— 身份证照片上传到 R2
 * multipart/form-data: id（问卷编号）、side（front | back）、file（图片）
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

  if (!env.IDCARDS) return json({ ok: false, error: '未绑定 R2 存储桶，请先创建并绑定 IDCARDS' }, 500);

  let form;
  try {
    form = await request.formData();
  } catch (e) {
    return json({ ok: false, error: '上传格式错误' }, 400);
  }

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
    return json({ ok: true, key: key });
  } catch (e) {
    return json({ ok: false, error: '写入存储失败：' + (e.message || e) }, 500);
  }
}
