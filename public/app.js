/* 表单渲染引擎：条件分支 / 校验 / 提交 */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const state = { formId: null, values: {}, files: {} };

  /* ---------- 工具 ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function isChecked(v, opt) { return Array.isArray(v) && v.indexOf(opt) > -1; }

  /* ---------- 渲染单个字段 ---------- */
  function renderField(f, v) {
    const req = f.required ? ' <span class="req">*</span>' : '';
    const hint = f.hint ? `<div class="hint">${esc(f.hint)}</div>` : '';
    let ctrl = '';

    switch (f.type) {
      case 'textarea':
        ctrl = `<textarea name="${f.name}" rows="3" placeholder="${esc(f.placeholder || '')}">${esc(v || '')}</textarea>`;
        break;

      case 'number':
        ctrl = `<input type="number" name="${f.name}" value="${esc(v || '')}" placeholder="${esc(f.placeholder || '')}" ${f.unit ? `data-unit="${esc(f.unit)}"` : ''}>`;
        break;

      case 'tel':
        ctrl = `<input type="tel" name="${f.name}" value="${esc(v || '')}" placeholder="${esc(f.placeholder || '')}">`;
        break;

      case 'radio':
        ctrl = `<div class="opts">${f.options.map(o => `
          <label class="opt"><input type="radio" name="${f.name}" value="${esc(o)}" ${v === o ? 'checked' : ''}><span>${esc(o)}</span></label>`).join('')}</div>`;
        break;

      case 'checkbox':
        ctrl = `<div class="opts">${f.options.map(o => `
          <label class="opt"><input type="checkbox" name="${f.name}" value="${esc(o)}" ${isChecked(v, o) ? 'checked' : ''}><span>${esc(o)}</span></label>`).join('')}</div>`;
        break;

      case 'select':
        ctrl = `<select name="${f.name}"><option value="">请选择</option>${f.options.map(o =>
          `<option value="${esc(o)}" ${v === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
        break;

      case 'scale': {
        const cur = Number(v || 0);
        ctrl = `<div class="scale" data-name="${f.name}">
          ${[1, 2, 3, 4, 5].map(n => `<button type="button" class="sbtn ${cur === n ? 'on' : ''}" data-v="${n}">${n}</button>`).join('')}
          <span class="scaletxt">${['', '不了解', '接触过', '能独立完成', '熟练', '精通/可带班'][cur] || '1=不了解 5=精通'}</span>
        </div>`;
        break;
      }

      case 'rows': {
        const list = Array.isArray(v) && v.length ? v : [];
        const init = Math.max(f.min || 1, list.length);
        const rows = list.length ? list : Array.from({ length: init }, () => ({}));
        ctrl = `<div class="rows" data-name="${f.name}" data-max="${f.max || 5}" data-min="${f.min || 1}">
          ${rows.map(r => rowHtml(f, r)).join('')}
          <button type="button" class="addrow">+ 添加一行</button>
          <div class="rowcount">已填 <b>0</b> 条${f.max ? `，最多 ${f.max} 条` : ''}</div>
        </div>`;
        break;
      }

      case 'photo': {
        ctrl = `<div class="photobox" data-name="${f.name}" data-side="${f.side || 'front'}">
          <div class="photobtns">
            <label class="pbtn">选择照片<input type="file" accept="image/*" hidden></label>
            <label class="pbtn">拍照上传<input type="file" accept="image/*" capture="environment" hidden></label>
          </div>
          <div class="preview">${photoPreview(f.name)}</div>
        </div>`;
        break;
      }

      default:
        ctrl = `<input type="text" name="${f.name}" value="${esc(v || '')}" placeholder="${esc(f.placeholder || '')}">`;
    }

    const unit = f.unit && f.type === 'number' ? `<span class="unit">${esc(f.unit)}</span>` : '';
    return `<div class="field" data-field="${f.name}">
      <div class="label">${esc(f.label)}${req}</div>
      ${hint}
      <div class="ctrl">${ctrl}${unit}</div>
      <div class="err"></div>
    </div>`;
  }

  function rowHtml(f, r) {
    return `<div class="row">${f.cols.map(c =>
      `<div class="cell"><span class="celllabel">${esc(c.label)}</span>
        <input type="${c.type === 'number' ? 'number' : 'text'}" data-col="${c.name}" value="${esc(r[c.name] || '')}">
      </div>`).join('')}
      <button type="button" class="delrow">×</button>
    </div>`;
  }

  /* ---------- 身份证照片 ---------- */
  function photoPreview(name) {
    const f = state.files[name];
    if (!f) return '<span class="ph">未上传</span>';
    return `<img src="${f.url}" alt="身份证照片">
      <span class="phsize">${(f.size / 1024).toFixed(0)} KB</span>
      <button type="button" class="delphoto">删除</button>`;
  }

  function refreshPhoto(name) {
    const box = document.querySelector(`.photobox[data-name="${name}"]`);
    if (box) box.querySelector('.preview').innerHTML = photoPreview(name);
  }

  function compressImage(file, maxSide, quality) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onerror = () => reject(new Error('文件读取失败'));
      fr.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('图片无法解码，请换一张或改用相册选择'));
        img.onload = () => {
          const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const cv = document.createElement('canvas');
          cv.width = w; cv.height = h;
          const cx = cv.getContext('2d');
          cx.fillStyle = '#fff';
          cx.fillRect(0, 0, w, h);
          cx.drawImage(img, 0, 0, w, h);
          cv.toBlob(b => b ? resolve(b) : reject(new Error('图片压缩失败')), 'image/jpeg', quality);
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }

  /* 来源渠道：链接带 ?ref=xxx 时记录是谁介绍来的，便于后台按渠道筛 */
  function getRef() {
    try {
      const p = new URLSearchParams(location.search);
      return (p.get('ref') || p.get('from') || p.get('src') || '').trim().slice(0, 40);
    } catch (e) { return ''; }
  }

  async function handlePhoto(name, file) {
    if (!file) return;
    if (!/^image\//.test(file.type)) { toast('请选择图片文件'); return; }
    if (file.size > 20 * 1024 * 1024) { toast('图片过大，请换一张'); return; }
    toast('正在处理图片…');
    try {
      const blob = await compressImage(file, 1600, 0.85);
      if (state.files[name] && state.files[name].url) URL.revokeObjectURL(state.files[name].url);
      state.files[name] = { blob: blob, url: URL.createObjectURL(blob), size: blob.size };
      refreshPhoto(name);
      document.querySelector(`.field[data-field="${name}"]`).classList.remove('bad');
      document.querySelector(`.field[data-field="${name}"] .err`).textContent = '';
      toast('');
    } catch (e) {
      toast('图片处理失败：' + e.message);
    }
  }

  /* ---------- 渲染整份表单 ---------- */
  function renderForm(form) {
    const host = $('#formHost');
    let html = `<div class="formhead"><h2>${esc(form.title)}</h2><p>${esc(form.subtitle)}</p></div>`;

    form.groups.forEach((g, gi) => {
      html += `<section class="group" data-group="${g.id}">
        <h3><span class="gno">${gi + 1}</span>${esc(g.title)}</h3>
        ${g.hint ? `<div class="ghint">${esc(g.hint)}</div>` : ''}
        <div class="gfields">${g.fields.map(f => renderField(f, state.values[f.name])).join('')}</div>
      </section>`;
    });

    html += `<div class="submitbar">
      <div class="subnote">提交后数据将加密存储，仅管理员可查看</div>
      <button id="submitBtn" class="submit">提交问卷</button>
    </div>`;
    host.innerHTML = html;

    bindForm(form);
    applyVisibility(form);
    updateRowCounts();
  }

  /* ---------- 事件绑定 ---------- */
  function bindForm(form) {
    const host = $('#formHost');

    host.addEventListener('input', e => {
      const t = e.target;
      if (!t.name) return;
      if (t.type === 'radio') state.values[t.name] = t.value;
      else if (t.type === 'checkbox') {
        const arr = [...host.querySelectorAll(`input[name="${t.name}"]:checked`)].map(x => x.value);
        state.values[t.name] = arr;
      } else state.values[t.name] = t.value;
      applyVisibility(form);
      saveDraft();
    });

    host.addEventListener('change', e => {
      const t = e.target;
      if (t.tagName === 'SELECT') { state.values[t.name] = t.value; applyVisibility(form); saveDraft(); return; }
      if (t.type === 'file') {
        const box = t.closest('.photobox');
        const name = box ? box.dataset.name : '';
        const file = t.files && t.files[0];
        t.value = '';
        if (name && file) handlePhoto(name, file);
      }
    });

    // 评分按钮
    host.addEventListener('click', e => {
      const btn = e.target.closest('.sbtn');
      if (btn) {
        const box = btn.closest('.scale');
        const name = box.dataset.name;
        state.values[name] = Number(btn.dataset.v);
        [...box.querySelectorAll('.sbtn')].forEach(b => b.classList.toggle('on', b === btn));
        box.querySelector('.scaletxt').textContent = ['', '不了解', '接触过', '能独立完成', '熟练', '精通/可带班'][Number(btn.dataset.v)];
        saveDraft();
        return;
      }
      if (e.target.classList.contains('delphoto')) {
        const box = e.target.closest('.photobox');
        const name = box.dataset.name;
        if (state.files[name]) {
          URL.revokeObjectURL(state.files[name].url);
          delete state.files[name];
        }
        refreshPhoto(name);
        return;
      }
      if (e.target.classList.contains('addrow')) {
        const wrap = e.target.closest('.rows');
        const max = Number(wrap.dataset.max || 5);
        if (wrap.querySelectorAll('.row').length >= max) return;
        const f = findField(wrap.dataset.name);
        wrap.insertBefore(el(rowHtml(f, {})), e.target);
        updateRowCounts();
        return;
      }
      if (e.target.classList.contains('delrow')) {
        const wrap = e.target.closest('.rows');
        if (wrap.querySelectorAll('.row').length <= (findField(wrap.dataset.name).min || 1)) return;
        e.target.closest('.row').remove();
        collectRows();
        return;
      }
    });

    $('#submitBtn').addEventListener('click', () => submitForm(form));
  }

  function el(html) { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstElementChild; }

  function findField(name) {
    for (const g of currentForm().groups) for (const f of g.fields) if (f.name === name) return f;
    return { cols: [], min: 1 };
  }

  function collectRows() {
    document.querySelectorAll('.rows').forEach(wrap => {
      const rows = [...wrap.querySelectorAll('.row')].map(r => {
        const o = {};
        r.querySelectorAll('input[data-col]').forEach(i => { o[i.dataset.col] = i.value; });
        return o;
      }).filter(o => Object.values(o).some(x => String(x).trim() !== ''));
      state.values[wrap.dataset.name] = rows;
    });
    updateRowCounts();
  }

  function updateRowCounts() {
    document.querySelectorAll('.rows').forEach(wrap => {
      const n = [...wrap.querySelectorAll('.row')].filter(r =>
        [...r.querySelectorAll('input[data-col]')].some(i => String(i.value).trim() !== '')
      ).length;
      const b = wrap.querySelector('.rowcount b');
      if (b) b.textContent = n;
    });
  }

  /* ---------- 条件显示 ---------- */
  function applyVisibility(form) {
    form.groups.forEach(g => {
      const sec = document.querySelector(`.group[data-group="${g.id}"]`);
      if (!sec) return;
      const show = typeof g.showIf === 'function' ? !!g.showIf(state.values) : true;
      sec.classList.toggle('show', show);
      g.fields.forEach(f => {
        const box = sec.querySelector(`.field[data-field="${f.name}"]`);
        if (!box) return;
        const s = typeof f.showIf === 'function' ? !!f.showIf(state.values) : true;
        box.style.display = s ? '' : 'none';
      });
    });
    renumber(form);
  }

  function renumber(form) {
    let n = 0;
    form.groups.forEach(g => {
      const sec = document.querySelector(`.group[data-group="${g.id}"]`);
      if (!sec) return;
      if (!sec.classList.contains('show')) { sec.querySelector('.gno').textContent = ''; return; }
      n += 1;
      sec.querySelector('.gno').textContent = n;
    });
  }

  /* ---------- 身份证解析（见 idcard.js） ---------- */
  const parseIdCard = window.parseIdCard || function () {
    return { birth: '', age: null, gender: '', valid: false };
  };

  /* ---------- 校验 ---------- */
  function markError(errs, name, msg) {
    errs.push(name);
    const box = document.querySelector(`.field[data-field="${name}"]`);
    if (box) { box.classList.add('bad'); box.querySelector('.err').textContent = msg; }
  }

  function validate(form) {
    const errs = [];
    document.querySelectorAll('.err').forEach(e => e.textContent = '');
    document.querySelectorAll('.field.bad').forEach(e => e.classList.remove('bad'));

    const visible = (name) => {
      const box = document.querySelector(`.field[data-field="${name}"]`);
      if (!box) return false;
      const sec = box.closest('.group');
      return sec.classList.contains('show') && box.style.display !== 'none';
    };

    form.groups.forEach(g => g.fields.forEach(f => {
      if (!f.required) return;
      if (typeof f.showIf === 'function' && !f.showIf(state.values)) return;
      if (!visible(f.name)) return;
      if (f.type === 'photo') {
        if (!state.files[f.name]) markError(errs, f.name, '请上传照片');
        return;
      }
      const v = state.values[f.name];
      const empty = v == null || v === '' || (Array.isArray(v) && v.length === 0);
      if (empty) markError(errs, f.name, f.type === 'rows' ? '请至少填写一条' : '此项为必填');
    }));

    // 手机号格式
    ['phone', 'contact', 'emergency_phone'].forEach(k => {
      const v = String(state.values[k] || '');
      if (v && !/^1[3-9]\d{9}$/.test(v) && visible(k)) markError(errs, k, '手机号格式不正确');
    });

    // 身份证号：格式、校验位、与性别是否一致
    const idv = String(state.values.idcard || '').trim();
    if (idv) {
      const p = parseIdCard(idv);
      if (!p.valid) {
        markError(errs, 'idcard', '身份证号格式或校验位不正确，请核对');
      } else if (p.age != null && (p.age < 16 || p.age > 70)) {
        markError(errs, 'idcard', `身份证显示年龄 ${p.age} 岁，请确认是否填写有误`);
      } else if (state.values.gender && p.gender && p.gender !== state.values.gender) {
        markError(errs, 'idcard', `身份证号显示为「${p.gender}」，与所选性别不一致，请核对`);
      }
    }

    return errs;
  }

  /* ---------- 草稿 ---------- */
  function saveDraft() {
    collectRows();
    try { localStorage.setItem('survey_draft_' + state.formId, JSON.stringify(state.values)); } catch (e) { }
  }
  function loadDraft() {
    try { return JSON.parse(localStorage.getItem('survey_draft_' + state.formId) || '{}'); } catch (e) { return {}; }
  }

  /* ---------- 提交 ---------- */
  async function submitForm(form) {
    collectRows();
    const errs = validate(form);
    if (errs.length) {
      const first = document.querySelector(`.field[data-field="${errs[0]}"]`);
      if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
      toast(`还有 ${errs.length} 项未填写或格式有误，请检查标红项`);
      return;
    }

    // 出生日期、年龄由身份证号自动解析，不单独出题
    const payload = Object.assign({}, state.values);
    const idp = parseIdCard(payload.idcard);
    if (idp.birth) {
      payload._birth = idp.birth;
      if (idp.age != null) payload._age = idp.age;
    }
    Object.keys(state.files).forEach(k => { payload[k] = '已上传照片'; });
    const ref = getRef();
    if (ref) payload._ref = ref;

    const btn = $('#submitBtn');
    btn.disabled = true;
    btn.textContent = '提交中…';

    try {
      const res = await fetch('/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ form: form.id, data: payload }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || '提交失败');

      // 文本内容已入库，再逐张上传身份证照片
      const photo = await uploadPhotos(json.id);
      localStorage.removeItem('survey_draft_' + state.formId);

      $('#formHost').innerHTML = `
        <div class="done">
          <div class="doneicon">✓</div>
          <h2>提交成功</h2>
          <p>问卷编号：<b>${esc(json.id)}</b></p>
          ${photo.total
            ? (photo.fail === 0
              ? `<p class="dim">身份证照片已上传 ${photo.done} 张</p>`
              : `<p class="warn">有 ${photo.fail} 张照片上传失败，请记下编号 ${esc(json.id)} 后重新填写补传</p>`)
            : ''}
          <p class="dim">请截图保存该编号，便于后续核对</p>
          <div class="donebtns">
            <button class="ghost" onclick="location.reload()">再填一份</button>
          </div>
        </div>`;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      toast('提交失败：' + e.message + '，请稍后重试');
      btn.disabled = false;
      btn.textContent = '提交问卷';
    }
  }

  /* 照片上传：提交成功后按问卷编号逐一上传，失败不影响已入库的文本 */
  async function uploadPhotos(id) {
    const names = Object.keys(state.files);
    if (!names.length) return { total: 0, done: 0, fail: 0 };

    let done = 0, fail = 0;
    for (const name of names) {
      const side = name.indexOf('back') > -1 ? 'back' : 'front';
      const fd = new FormData();
      fd.append('id', String(id));
      fd.append('side', side);
      fd.append('file', state.files[name].blob, `idcard-${side}.jpg`);
      try {
        const r = await fetch('/api/upload', { method: 'POST', body: fd });
        const j = await r.json();
        if (j && j.ok) done += 1; else fail += 1;
      } catch (e) {
        fail += 1;
      }
    }
    return { total: names.length, done: done, fail: fail };
  }

  function toast(msg) {
    let t = $('#toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
    if (!msg) { t.classList.remove('on'); clearTimeout(t._tm); return; }
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(t._tm);
    t._tm = setTimeout(() => t.classList.remove('on'), 3500);
  }

  /* ---------- 切换表单 ---------- */
  function currentForm() { return window.FORMS.find(f => f.id === state.formId); }

  function switchForm(id) {
    state.formId = id;
    state.values = loadDraft();
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.dataset.id === id));
    renderForm(currentForm());
    window.scrollTo({ top: 0 });
  }

  /* ---------- 启动 ---------- */
  document.addEventListener('DOMContentLoaded', () => {
    const tabs = $('#tabs');
    if (window.FORMS.length > 1) {
      tabs.innerHTML = window.FORMS.map((f, i) =>
        `<button class="tab ${i === 0 ? 'on' : ''}" data-id="${f.id}">${esc(f.title)}</button>`).join('');
      tabs.addEventListener('click', e => {
        const t = e.target.closest('.tab');
        if (t && t.dataset.id !== state.formId) switchForm(t.dataset.id);
      });
    } else {
      tabs.style.display = 'none';
    }
    switchForm(window.FORMS[0].id);
  });
})();
