/* 管理员后台：登录 → 列表 → 详情 → 导出 CSV */
(function () {
  const box = () => document.querySelector('.adminbox');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let token = localStorage.getItem('sv_token') || '';
  const curForm = 'combined';

  /* 标签映射：字段名 → 题目标题 */
  const LABELS = {};
  (window.FORMS || []).forEach(f => f.groups.forEach(g => g.fields.forEach(x => {
    LABELS[x.name] = x.label;
    if (x.type === 'rows' && x.cols) x.cols.forEach(c => LABELS[x.name + '.' + c.name] = x.label + ' - ' + c.label);
  })));

  const ORDER = [];
  (window.FORMS || []).forEach(f => f.groups.forEach(g => g.fields.forEach(x => {
    if (x.type === 'rows') x.cols.forEach(c => ORDER.push([x.name + '.' + c.name, 'rows']));
    else ORDER.push([x.name, x.type]);
  })));
  // 身份证自动解析出来的字段，放在导出表最前面
  LABELS['_birth'] = '出生日期（身份证解析）';
  LABELS['_age'] = '年龄';
  LABELS['_ref'] = '来源渠道';
  ORDER.unshift(['_age', 'text'], ['_birth', 'text'], ['_ref', 'text']);

  function fmt(v) {
    if (v == null) return '';
    if (Array.isArray(v)) {
      return v.map(x => (x && typeof x === 'object')
        ? Object.values(x).filter(Boolean).join(' / ')
        : x).filter(Boolean).join('、');
    }
    if (typeof v === 'object') return Object.values(v).filter(Boolean).join(' / ');
    return String(v);
  }

  /* ---------- 登录 ---------- */
  function renderLogin(msg) {
    box().innerHTML = `
      <h2>管理员登录</h2>
      <p class="sub">输入后台查看口令</p>
      <div class="login">
        <input type="password" id="tk" placeholder="管理员口令">
        <button class="btn" id="go">进入</button>
        ${msg ? `<div class="err" style="color:var(--danger)">${esc(msg)}</div>` : ''}
      </div>`;
    const go = () => {
      token = document.querySelector('#tk').value.trim();
      if (!token) return;
      localStorage.setItem('sv_token', token);
      loadList();
    };
    document.querySelector('#go').onclick = go;
    document.querySelector('#tk').onkeydown = e => { if (e.key === 'Enter') go(); };
  }

  /* ---------- 列表 ---------- */
  async function loadList() {
    box().innerHTML = `<h2>加载中…</h2>`;
    try {
      const r = await fetch(`/api/results?token=${encodeURIComponent(token)}&form=${curForm}`);
      const j = await r.json();
      if (!j.ok) { if (r.status === 401) { token = ''; renderLogin(j.error); } else throw new Error(j.error); return; }
      renderList(j.list || []);
    } catch (e) {
      box().innerHTML = `<h2>加载失败</h2><p class="sub">${esc(e.message)}</p>
        <button class="btn gray" onclick="localStorage.removeItem('sv_token');location.reload()">重新登录</button>`;
    }
  }

  function renderList(list) {
    box().innerHTML = `
      <h2>答卷列表</h2>
      <p class="sub">共 ${list.length} 条 · 最多显示最近 500 条</p>
      <div class="toolbar">
        <button class="btn" id="exp">导出 CSV</button>
        <button class="btn gray" id="expj">导出 JSON</button>
        <button class="btn gray" id="rf">刷新</button>
        <button class="btn gray" id="lo">退出</button>
      </div>
      <div class="tblwrap">
        <table>
          <thead><tr><th>编号</th><th>姓名/队伍</th><th>电话</th><th>来源</th><th>提交时间</th><th>操作</th></tr></thead>
          <tbody>
            ${list.length ? list.map(r => `<tr>
              <td>${r.id}</td>
              <td>${esc(r.name || '—')}</td>
              <td>${esc(r.phone || '—')}</td>
              <td>${esc(r.ref || '—')}</td>
              <td>${esc(localTime(r.created_at))}</td>
              <td><button class="linkbtn" data-id="${r.id}">查看详情</button></td>
            </tr>`).join('') : `<tr><td colspan="6" class="empty">暂无数据</td></tr>`}
          </tbody>
        </table>
      </div>`;

    document.querySelector('#rf').onclick = loadList;
    document.querySelector('#lo').onclick = () => { localStorage.removeItem('sv_token'); location.reload(); };
    document.querySelector('#exp').onclick = exportCsv;
    document.querySelector('#expj').onclick = exportJson;
    box().querySelectorAll('.linkbtn[data-id]').forEach(b => b.onclick = () => showDetail(b.dataset.id));
  }

  function localTime(s) {
    if (!s) return '';
    const d = new Date(s);
    if (isNaN(d)) return s;
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  /* ---------- 详情 ---------- */
  async function showDetail(id) {
    const r = await fetch(`/api/results?token=${encodeURIComponent(token)}&id=${id}`);
    const j = await r.json();
    if (!j.ok) return alert(j.error || '加载失败');
    const it = j.item || {};
    const d = it.payload || {};

    const groups = (window.FORMS || []).find(f => f.id === it.form);
    let html = `<p><button class="btn gray" id="back">← 返回列表</button></p>
      <h2>${esc(it.name || '未填写')} <span style="font-size:14px;color:var(--dim)">#${it.id}</span></h2>
      <p class="sub">${esc(groups ? groups.title : it.form)} · 提交于 ${esc(localTime(it.created_at))}</p>
      <div class="tblwrap detail"><div style="padding:18px">`;

    if (d._birth || d._age != null) {
      html += `<h3>自动识别信息（由身份证号解析）</h3><div class="kv">
        <div>出生日期</div><div>${esc(d._birth || '—')}</div>
        <div>年龄</div><div>${d._age != null ? esc(d._age) + ' 岁' : '—'}</div>
        ${d._ref ? `<div>来源渠道</div><div>${esc(d._ref)}</div>` : ''}
      </div>`;
    }

    if (d.idcard_front || d.idcard_back) {
      html += `<h3>身份证照片</h3><div class="idcardimgs">`;
      if (d.idcard_front) {
        html += `<figure><img src="/api/photo?token=${encodeURIComponent(token)}&id=${it.id}&side=front" alt="人像面"><figcaption>人像面</figcaption></figure>`;
      }
      if (d.idcard_back) {
        html += `<figure><img src="/api/photo?token=${encodeURIComponent(token)}&id=${it.id}&side=back" alt="国徽面"><figcaption>国徽面</figcaption></figure>`;
      }
      html += `</div>`;
    }

    (groups ? groups.groups : []).forEach(g => {
      // 注意：这里是「标签, 值」交替的扁平结构，外层 .kv 负责两列网格；
      // 不要再给每一行套 .kv，否则会嵌套成网格把标签挤成一字一行。
      const items = g.fields.map(f => {
        if (f.type === 'rows') {
          const rows = Array.isArray(d[f.name]) ? d[f.name] : [];
          if (!rows.length) return '';
          return `<div>${esc(f.label)}</div><div>${
            rows.map(r => Object.keys(r).map(k => fmt(r[k])).filter(Boolean).join(' / ')).join('；')}</div>`;
        }
        const v = d[f.name];
        if (v == null || v === '' || (Array.isArray(v) && !v.length)) return '';
        // 照片字段只记一个占位值，详情里已单独展示图片，这里统一说「已上传」
        if (f.type === 'photo') {
          return `<div>${esc(f.label)}</div><div>已上传</div>`;
        }
        return `<div>${esc(f.label)}</div><div>${esc(fmt(v))}</div>`;
      }).filter(Boolean);
      if (!items.length) return;
      html += `<h3>${esc(g.title)}</h3><div class="kv">${items.join('')}</div>`;
    });

    html += `</div></div>`;
    box().innerHTML = html;
    document.querySelector('#back').onclick = loadList;
  }

  /* ---------- CSV 导出 ---------- */
  async function exportCsv() {
    const r = await fetch(`/api/results?token=${encodeURIComponent(token)}&form=${curForm}&full=1`);
    const j = await r.json();
    if (!j.ok) return alert(j.error || '导出失败');
    const list = j.list || [];
    if (!list.length) return alert('当前表单暂无数据');

    const head = ['编号', '提交时间', '姓名/队伍', '电话'].concat(
      ORDER.map(([k]) => LABELS[k] || k)
    );

    const rows = list.map(it => {
      const d = it.payload || {};
      const base = [it.id, localTime(it.created_at), it.name || '', it.phone || ''];
      const cells = ORDER.map(([k, t]) => {
        if (t === 'rows') {
          const arr = Array.isArray(d[k.split('.')[0]]) ? d[k.split('.')[0]] : [];
          const col = k.split('.')[1];
          return arr.map(x => x[col] || '').filter(Boolean).join(' | ');
        }
        return fmt(d[k]);
      });
      return base.concat(cells);
    });

    const q = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const csv = '\ufeff' + [head, ...rows].map(r => r.map(q).join(',')).join('\r\n');
    download(csv, 'csv', 'text/csv;charset=utf-8');
  }

  /* ---------- JSON 导出 ---------- */
  async function exportJson() {
    const r = await fetch(`/api/results?token=${encodeURIComponent(token)}&form=${curForm}&full=1`);
    const j = await r.json();
    if (!j.ok) return alert(j.error || '导出失败');
    const list = j.list || [];
    if (!list.length) return alert('暂无数据');

    const out = {
      exported_at: new Date().toISOString(),
      source: '入职与技能考察登记表',
      count: list.length,
      items: list.map(it => ({
        id: it.id,
        created_at: it.created_at,
        name: it.name || '',
        phone: it.phone || '',
        idcard_photos: (it.payload && it.payload.idcard_front ? ['front'] : [])
          .concat(it.payload && it.payload.idcard_back ? ['back'] : []),
        data: it.payload || {},
      })),
    };
    download(JSON.stringify(out, null, 2), 'json', 'application/json');
  }

  function download(text, ext, mime) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: mime }));
    a.download = `${curForm}_${new Date().toISOString().slice(0, 10)}.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  token ? loadList() : renderLogin();
})();
