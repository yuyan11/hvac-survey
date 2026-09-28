/* GET /api/photo?token=xxx&id=123&side=front —— 管理员读取身份证照片 */
export async function onRequestGet(ctx) {
  const { request, env } = ctx;

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
