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

  /* ---------- 身份证自动核验状态 ---------- */
  function parseOcr(s) {
    if (!s) return null;
    try { return JSON.parse(s); } catch (e) { return null; }
  }
  function ocrStatus(r) {
    const o = parseOcr(r && r.ocr);
    if (!o) return { cls: 'gray', text: '未核验' };
    if (o.notId) return { cls: 'bad', text: '非身份证' };
    if (o.matched) return { cls: 'ok', text: '号码一致' };
    if (!o.num) return { cls: 'warn', text: '未读出号码' };
    return { cls: 'warn', text: '号码不一致' };
  }
  function badge(s) { return `<span class="badge ${s.cls}">${esc(s.text)}</span>`; }

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
      ${datePanel()}
      ${mailPanelHtml()}
      <div class="tblwrap">
        <table>
          <thead><tr><th>编号</th><th>姓名/队伍</th><th>电话</th><th>来源</th><th>身份证核验</th><th>提交时间</th><th>操作</th></tr></thead>
          <tbody>
            ${list.length ? list.map(r => `<tr>
              <td>${r.id}</td>
              <td>${esc(r.name || '—')}</td>
              <td>${esc(r.phone || '—')}</td>
              <td>${esc(r.ref || '—')}</td>
              <td>${badge(ocrStatus(r))}</td>
              <td>${esc(localTime(r.created_at))}</td>
              <td><button class="linkbtn" data-id="${r.id}">查看详情</button></td>
            </tr>`).join('') : `<tr><td colspan="7" class="empty">暂无数据</td></tr>`}
          </tbody>
        </table>
      </div>`;

    document.querySelector('#rf').onclick = loadList;
    document.querySelector('#lo').onclick = () => { localStorage.removeItem('sv_token'); location.reload(); };
    document.querySelector('#exp').onclick = exportCsv;
    document.querySelector('#expj').onclick = exportJson;
    box().querySelectorAll('.linkbtn[data-id]').forEach(b => b.onclick = () => showDetail(b.dataset.id));
    bindDatePanel();
    loadMailPanel();
  }

  /* ---------- 按日期区间导出 xlsx（北京时间口径，与服务器一致） ---------- */
  function bjToday(offsetDays) {
    const t = new Date(Date.now() + 8 * 3600 * 1000 + (offsetDays || 0) * 86400000);
    return t.toISOString().slice(0, 10);
  }

  function datePanel() {
    const today = bjToday(0);
    return `<div class="panel"><h3>按日期导出</h3>
      <div class="panelrow">
        <label>开始 <input type="date" id="exfrom" value="${today}"></label>
        <label>结束 <input type="date" id="exto" value="${today}"></label>
        <button class="chip" data-q="today">今天</button>
        <button class="chip" data-q="yest">昨天</button>
        <button class="chip" data-q="week">近 7 天</button>
        <button class="chip" data-q="month">本月</button>
        <button class="chip" data-q="all">全部</button>
        <button class="chip" data-q="week1">上周</button>
      </div>
      <div class="panelrow" style="margin-top:10px">
        <select id="extype" style="width:auto;min-width:190px">
          <option value="all">问卷 + 员工登记（两张表）</option>
          <option value="survey">只要问卷答卷</option>
          <option value="employee">只要员工登记</option>
        </select>
        <label><input type="checkbox" id="eximg" checked style="width:auto"> 嵌入证件照原图</label>
        <button class="btn" id="exxls">导出 Excel</button>
      </div>
      <div class="hint" id="exmsg">真正的 .xlsx 文件（Excel / WPS / 手机都能直接打开），按提交时间筛选。勾选「嵌入证件照原图」时，身份证、银行卡、自拍照会按原图直接嵌在对应单元格里。</div>
    </div>`;
  }

  function bindDatePanel() {
    const from = document.querySelector('#exfrom');
    const to = document.querySelector('#exto');
    const msg = document.querySelector('#exmsg');
    if (!from) return;
    const setQ = q => {
      const t = bjToday(0);
      if (q === 'today') { from.value = t; to.value = t; }
      else if (q === 'yest') { from.value = to.value = bjToday(-1); }
      else if (q === 'week') { from.value = bjToday(-6); to.value = t; }
      else if (q === 'week1') { from.value = bjToday(-13); to.value = bjToday(-7); }
      else if (q === 'month') { from.value = t.slice(0, 8) + '01'; to.value = t; }
      else { from.value = '2020-01-01'; to.value = t; }
    };
    box().querySelectorAll('.chip[data-q]').forEach(b => b.onclick = () => setQ(b.dataset.q));
    document.querySelector('#exxls').onclick = () => {
      if (!from.value || !to.value) { msg.textContent = '请选择开始和结束日期'; return; }
      const type = document.querySelector('#extype').value;
      const img = document.querySelector('#eximg').checked ? 1 : 0;
      msg.textContent = img ? '正在取证件照并生成 Excel…（照片多时会慢一点）' : '正在生成 Excel…';
      fetch(`/api/export?token=${encodeURIComponent(token)}&type=${type}&from=${from.value}&to=${to.value}&images=${img}`)
        .then(r => {
          const ct = r.headers.get('Content-Type') || '';
          if (ct.includes('json')) return r.json().then(j => { throw new Error(j.error || '导出失败'); });
          return r.blob().then(b => ({ blob: b, name: `招聘登记数据_${from.value}_${to.value}.xlsx`, size: b.size }));
        })
        .then(o => {
          downloadBlob(o.blob, o.name);
          msg.textContent = `已导出：${o.name}（${(o.size / 1024 / 1024).toFixed(2)} MB）`;
        })
        .catch(e => { msg.textContent = '导出失败：' + e.message; });
    };
  }

  function downloadBlob(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  }

  /* ---------- 每日邮件推送设置 ---------- */
  function mailPanelHtml() {
    return `<div class="panel"><h3>每日邮件推送</h3>
      <div id="mailbody"><p class="dim">加载中…</p></div>
    </div>`;
  }

  async function loadMailPanel() {
    const host = document.querySelector('#mailbody');
    if (!host) return;
    let j;
    try {
      const r = await fetch(`/api/mail-settings?token=${encodeURIComponent(token)}`);
      j = await r.json();
    } catch (e) {
      host.innerHTML = `<p class="dim">读取设置失败：${esc(e.message)}</p>`;
      return;
    }
    if (!j.ok) { host.innerHTML = `<p class="dim">${esc(j.error || '读取设置失败')}</p>`; return; }
    const c = j.config || {};
    const hours = Array.from({ length: 24 }, (_, i) => i)
      .map(i => `<option value="${i}"${i === c.hour ? ' selected' : ''}>${String(i).padStart(2, '0')}:00</option>`).join('');
    const log = (j.log || []);
    host.innerHTML = `
      <div class="panelrow">
        <label style="flex:1;min-width:260px">收件邮箱 <input type="text" id="mt" value="${esc((c.recipients || []).join(','))}" placeholder="多个邮箱用逗号隔开，如 a@qq.com,b@163.com"></label>
      </div>
      <div class="panelrow" style="margin-top:10px">
        <label>发送时间 <select id="mh" style="width:auto">${hours}</select>（北京时间，每天一次）</label>
        <label style="margin-left:6px"><input type="checkbox" id="me" ${c.enabled ? 'checked' : ''} style="width:auto"> 启用每日自动发送</label>
      </div>
      <div class="panelrow" style="margin-top:10px">
        <label style="flex:1;min-width:240px">发件地址 <input type="text" id="mf" value="${esc(c.from || '')}" placeholder="noreply@199118.xyz"></label>
      </div>
      <div class="panelrow" style="margin-top:12px">
        <button class="btn" id="msave">保存设置</button>
        <button class="btn gray" id="mtest">立即发一封测试邮件</button>
        <span class="dim" id="mmsg"></span>
      </div>
      <div class="hint">
        ${j.mailerReady ? '' : '<b style="color:var(--danger)">邮件发送绑定还没生效</b>，部署新版本后才会出现；'}
        逻辑：每天到点检查一次，把「上次发信之后」的新增记录打包成 xlsx 发过去；当天没有新增就不发。
        收件邮箱必须是 Cloudflare 账号里已验证的目的地址（当前已验证：948683750@qq.com）。
        <br>定时任务最近一次运行：<b>${c.cronLastAt ? esc(localTime(c.cronLastAt)) + '（' + esc(c.cronLastNote || '') + '）' : '还没有运行记录'}</b>
        ${c.lastAt ? '｜上次成功发送：' + esc(localTime(c.lastAt)) : ''}
      </div>
      ${log.length ? `<h3 style="margin-top:16px">最近发送</h3><div class="kv">${log.map(x => `
        <div>${esc(localTime(x.sent_at))}</div>
        <div>${x.ok ? '<span class="badge ok">成功</span>' : '<span class="badge bad">失败</span>'} ${esc(x.subject || '')} ${esc(x.recipients || '')} ${x.ok ? '' : esc(x.error || '')}</div>
      `).join('')}</div>` : ''}
    `;

    const msg = document.querySelector('#mmsg');
    document.querySelector('#msave').onclick = async () => {
      msg.textContent = '保存中…';
      try {
        const r = await fetch(`/api/mail-settings?token=${encodeURIComponent(token)}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: document.querySelector('#mt').value.trim(),
            hour: document.querySelector('#mh').value,
            enabled: document.querySelector('#me').checked,
            from: document.querySelector('#mf').value.trim(),
          }),
        });
        const rj = await r.json();
        if (!rj.ok) { msg.textContent = rj.error || '保存失败'; return; }
        msg.textContent = '已保存 ✓';
        loadMailPanel();
      } catch (e) { msg.textContent = '保存失败：' + e.message; }
    };
    document.querySelector('#mtest').onclick = async () => {
      msg.textContent = '正在发送…';
      try {
        const r = await fetch(`/api/mail-test?token=${encodeURIComponent(token)}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: document.querySelector('#mt').value.trim() }),
        });
        const rj = await r.json();
        msg.textContent = rj.ok ? (rj.message || '已发送 ✓') : (rj.error || '发送失败');
        loadMailPanel();
      } catch (e) { msg.textContent = '发送失败：' + e.message; }
    };
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

    const o = parseOcr(it.ocr);
    if (o) {
      const rows = [];
      if (o.notId) {
        rows.push(`<div>核验结果</div><div><span class="badge bad">不是身份证</span> ${esc(o.reason || '')}</div>`);
      } else {
        rows.push(`<div>核验结果</div><div>${badge(ocrStatus(it))}<span class="dim"> ${esc(o.providerLabel || '')}</span></div>`);
        if (o.num) rows.push(`<div>照片上的号码</div><div>${esc(o.num)}</div>`);
        if (o.typed) rows.push(`<div>表单填的号码</div><div>${esc(o.typed)}</div>`);
        if (o.name) rows.push(`<div>照片上的姓名</div><div>${esc(o.name)}</div>`);
        if (o.address) rows.push(`<div>住址</div><div>${esc(o.address)}</div>`);
        if (o.imageStatus && o.imageStatus !== 'normal') rows.push(`<div>图像质量</div><div>${esc(o.imageStatus)}</div>`);
        if (o.riskType && o.riskType !== 'normal') rows.push(`<div>翻拍风险</div><div>${esc(o.riskType)}</div>`);
      }
      if (o.at) rows.push(`<div>核验时间</div><div>${esc(localTime(o.at))}</div>`);
      html += `<h3>身份证自动核验</h3><div class="kv">${rows.join('')}</div>`;
    }

    const imgs = [
      ['front', '身份证 · 人像面', d.idcard_front],
      ['back', '身份证 · 国徽面', d.idcard_back],
      ['selfie', '本人自拍照', d.selfie],
    ].filter(x => x[2]);
    if (imgs.length) {
      html += `<h3>照片</h3><div class="idcardimgs">`;
      imgs.forEach(([side, label]) => {
        html += `<figure><img src="/api/photo?token=${encodeURIComponent(token)}&id=${it.id}&side=${side}" alt="${esc(label)}">
          <figcaption>${esc(label)}
            <label class="linkbtn" style="font-size:12.5px;margin-left:6px">换一张
              <input type="file" accept="image/*" class="rephoto" data-side="${side}" style="display:none">
            </label>
          </figcaption></figure>`;
      });
      html += `</div>`;
      html += `<p style="margin-top:10px"><button class="btn gray" id="reverify">${o ? '重新核验身份证' : '核验身份证'}</button>
        <span class="dim" id="rvmsg" style="margin-left:10px"></span></p>`;
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

    const rv = document.querySelector('#reverify');
    if (rv) {
      rv.onclick = async () => {
        const msg = document.querySelector('#rvmsg');
        rv.disabled = true; msg.textContent = '正在核验…';
        try {
          const rr = await fetch(`/api/verify?token=${encodeURIComponent(token)}&force=1`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: it.id }),
          });
          const rj = await rr.json();
          if (!rj.ok) { msg.textContent = rj.error || '核验失败'; rv.disabled = false; return; }
          showDetail(it.id);
        } catch (e) {
          msg.textContent = '核验失败：' + e.message;
          rv.disabled = false;
        }
      };
    }

    // 「换一张」：管理员替换某张证件照（覆盖同一个对象），用于老照片有水印/拍错的情况
    box().querySelectorAll('input.rephoto').forEach(inp => {
      inp.onchange = async () => {
        const f = inp.files && inp.files[0];
        if (!f) return;
        const msg = document.querySelector('#rvmsg');
        if (msg) msg.textContent = '正在上传替换…';
        try {
          const fd = new FormData();
          fd.append('token', token);
          fd.append('id', it.id);
          fd.append('side', inp.dataset.side);
          fd.append('file', f, inp.dataset.side + '.jpg');
          const rr = await fetch('/api/photo-admin', { method: 'POST', body: fd });
          const rj = await rr.json();
          if (!rj.ok) { if (msg) msg.textContent = rj.error || '替换失败'; return; }
          showDetail(it.id);
        } catch (e) {
          if (msg) msg.textContent = '替换失败：' + e.message;
        }
      };
    });
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
