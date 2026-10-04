/* 员工信息登记表：证件拍照 → 调 /api/ocr 自动识别 → 自动填写姓名/身份证号/卡号 */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var state = { files: {}, ocr: {} };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function toast(msg) {
    var t = $('#toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
    if (!msg) { t.classList.remove('on'); clearTimeout(t._tm); return; }
    t.textContent = msg; t.classList.add('on'); clearTimeout(t._tm);
    t._tm = setTimeout(function () { t.classList.remove('on'); }, 2600);
  }

  function fieldOf(name) { return document.querySelector('.field[data-field="' + name + '"]'); }
  function errOf(name) { var f = fieldOf(name); return f ? f.querySelector('.err') : null; }
  function bad(name, on) { var f = fieldOf(name); if (f) f.classList.toggle('bad', !!on); }
  function ocrLine(name, text, cls) {
    var el = document.querySelector('.ocrline[data-for="' + name + '"]');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'ocrline' + (cls ? ' ' + cls : '');
  }

  /* ---------- 压缩（不加水印） ---------- */
  function compress(file, maxSide, quality) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onerror = function () { reject(new Error('文件读取失败')); };
      fr.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error('图片无法解码')); };
        img.onload = function () {
          var scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
          var w = Math.max(1, Math.round(img.naturalWidth * scale));
          var h = Math.max(1, Math.round(img.naturalHeight * scale));
          var cv = document.createElement('canvas');
          cv.width = w; cv.height = h;
          var cx = cv.getContext('2d');
          cx.fillStyle = '#fff'; cx.fillRect(0, 0, w, h);
          cx.drawImage(img, 0, 0, w, h);
          cv.toBlob(function (b) { b ? resolve(b) : reject(new Error('图片压缩失败')); }, 'image/jpeg', quality);
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }

  function toBase64(blob) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(String(fr.result).split(',')[1]); };
      fr.onerror = function () { reject(new Error('图片读取失败')); };
      fr.readAsDataURL(blob);
    });
  }

  /* ---------- 拍照前的基础体检（省得白跑一次 OCR） ---------- */
  function inspect(blob) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        var w = img.naturalWidth, h = img.naturalHeight;
        var S = 64, cv = document.createElement('canvas');
        cv.width = S; cv.height = S;
        var cx = cv.getContext('2d');
        cx.drawImage(img, 0, 0, S, S);
        var d;
        try { d = cx.getImageData(0, 0, S, S).data; } catch (e) { return resolve({ w: w, h: h, mean: 128, sd: 99 }); }
        var sum = 0, sum2 = 0, n = 0;
        for (var i = 0; i < d.length; i += 4) {
          var g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          sum += g; sum2 += g * g; n += 1;
        }
        var mean = sum / n;
        resolve({ w: w, h: h, mean: mean, sd: Math.sqrt(Math.max(0, sum2 / n - mean * mean)), long: Math.max(w, h) });
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  }

  function vet(kind, m) {
    if (!m) return '图片无法读取，请重拍';
    if (m.long < 420) return '照片太小太糊，请靠近拍清楚一点';
    if (m.mean < 30) return '太黑了看不清，请在光线好的地方重拍';
    if (m.mean > 246) return '画面过曝/反光严重，换个角度重拍';
    if (m.sd < 10) return '画面几乎一片空白，请对准证件重拍';
    if (kind === 'idcard') {
      // 竖拍/横拍都允许（手机竖着拿、卡片横在画面里最常见），方向交给 OCR 判断，
      // 这里只挡极端长条——多半是截屏、拍歪或者只拍到卡片一角
      var ratio = m.w / m.h;
      if (ratio > 3.2 || ratio < 0.32) return '画面太窄长，请正对证件、让它占满画面重拍';
    }
    return '';
  }

  /* ---------- 预览 ---------- */
  function refresh(name) {
    var box = document.querySelector('.photobox[data-name="' + name + '"]');
    if (!box) return;
    var f = state.files[name];
    var html = f
      ? '<img src="' + f.url + '" alt="证件照片"><span class="phsize">' + (f.size / 1024).toFixed(0) + ' KB</span>' +
        '<button type="button" class="delphoto">删除</button>'
      : '<span class="ph">未上传</span>';
    box.querySelector('.preview').innerHTML = html;
  }

  function setVal(name, val) {
    var el = document.querySelector('input[name="' + name + '"]');
    if (el) el.value = val;
  }

  /* ---------- 主流程：选图 → 体检 → OCR → 回填 ---------- */
  function handleFile(name, file) {
    if (!file) return;
    if (!/^image\//.test(file.type)) { toast('请选择图片文件'); return; }
    if (file.size > 20 * 1024 * 1024) { toast('图片过大，请换一张'); return; }

    var box = document.querySelector('.photobox[data-name="' + name + '"]');
    var kind = box.getAttribute('data-kind');
    var side = box.getAttribute('data-side');

    toast('正在处理图片…');
    compress(file, 1600, 0.85)
      .then(function (blob) { return inspect(blob).then(function (m) { return { blob: blob, m: m }; }); })
      .then(function (r) {
        var msg = vet(kind, r.m);
        if (msg) {
          bad(name, true); errOf(name).textContent = msg; ocrLine(name, '');
          toast(msg); return;
        }
        if (state.files[name] && state.files[name].url) URL.revokeObjectURL(state.files[name].url);
        state.files[name] = { blob: r.blob, url: URL.createObjectURL(r.blob), size: r.blob.size };
        refresh(name);
        bad(name, false); errOf(name).textContent = '';

        // 只有「有号码要读」的字段才调 OCR，省额度：
        //   身份证人像面 → 读身份证号；银行卡 → 读卡号/开户行
        //   身份证国徽面没有号码可读 → 不调 OCR，只本地保存
        if (kind === 'idcard' && side === 'back') {
          ocrLine(name, '国徽面已保存（不需要识别）');
          toast('');
          return;
        }

        ocrLine(name, '正在识别…');
        return toBase64(r.blob).then(function (b64) {
          return fetch('/api/ocr', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ kind: kind, side: side, image: b64 }),
          });
        }).then(function (res) { return res.json().then(function (j) { return { res: res, j: j }; }); })
          .then(function (o) { applyOcr(name, kind, o.j); })
          .catch(function () { ocrLine(name, '识别失败，可稍后重试', 'warn'); });
      })
      .catch(function (e) { toast('图片处理失败：' + e.message); });
  }

  function applyOcr(name, kind, j) {
    if (!j || !j.ok) {
      // 银行卡是选填的：识别不出也只提示重拍，照片保留、照样能提交
      if (kind === 'bankcard') {
        var hint = '未识别成功，请在光线明亮处对准角度重拍';
        var ec = errOf(name); if (ec) ec.textContent = hint;
        ocrLine(name, hint, 'warn');
        toast(hint);
        return;
      }
      // 身份证人像面：判「不是身份证」是确定性的结论 → 直接退回，让用户重拍
      if (j && j.code === 'notid') {
        if (state.files[name] && state.files[name].url) URL.revokeObjectURL(state.files[name].url);
        delete state.files[name];
        delete state.ocr[name];
        refresh(name);
        bad(name, true);
        // 照片被退回，之前由 OCR 填进去的号码也得清掉，否则会带着别人的号提交
        var el = errOf(name); if (el) el.textContent = j.error || '这张不像证件，请重拍';
        if (name === 'front') setVal('idcard', '');
        if (name === 'card') { setVal('card_no', ''); setVal('card_bank', ''); }
        ocrLine(name, j.error || '这张不像证件，请重拍', 'warn');
        toast(j.error || '这张不像证件，请重拍');
        return;
      }
      ocrLine(name, (j && j.error) || '识别失败', 'warn');
      return;
    }
    var r = j.result || {};
    state.ocr[name] = r;

    if (kind === 'idcard' && name === 'front') {
      if (!r.num) { ocrLine(name, '没识别出号码，请重拍', 'warn'); return; }
      setVal('idcard', r.num);
      var extra = [];
      if (r.name) extra.push('姓名 ' + r.name);
      if (r.sex) extra.push(r.sex);
      if (r.nation) extra.push(r.nation);
      if (r.birth) extra.push(r.birth);
      if (r.name && !$('input[name="name"]').value) setVal('name', r.name);
      var warn = '';
      if (r.numType === 0) warn = '（号码不合规）';
      else if (r.numType === 2 || r.numType === 3 || r.numType === 4) warn = '（号码与出生/性别信息不一致）';
      ocrLine(name, '已识别：' + r.num + ' ' + extra.join(' · ') + warn, warn ? 'warn' : 'ok');
      return;
    }

    if (kind === 'idcard' && name === 'back') {
      var t = [];
      if (r.authority) t.push(r.authority);
      if (r.validFrom) t.push(r.validFrom + (r.validTo ? ' 至 ' + r.validTo : ''));
      ocrLine(name, t.length ? '已识别：' + t.join(' · ') : '已识别国徽面', t.length ? 'ok' : '');
      return;
    }

    if (kind === 'bankcard') {
      if (!r.num) {
        var h2 = '未识别成功，请在光线明亮处对准角度重拍';
        var e2 = errOf(name); if (e2) e2.textContent = h2;
        ocrLine(name, h2, 'warn');
        return;
      }
      setVal('card_no', r.num || '');
      setVal('card_bank', r.bankName || '');
      if (r.holderName && !$('input[name="name"]').value) setVal('name', r.holderName);
      var t2 = [];
      if (r.bankName) t2.push(r.bankName);
      if (r.holderName) t2.push('持卡人 ' + r.holderName);
      if (r.validDate) t2.push('有效期 ' + r.validDate);
      ocrLine(name, '已识别卡号 ' + (r.num || ''), 'ok');
      if (t2.length) ocrLine(name, '已识别卡号 ' + (r.num || '') + ' · ' + t2.join(' · '), 'ok');
    }
  }

  /* ---------- 事件 ---------- */
  document.addEventListener('change', function (e) {
    var input = e.target;
    if (!input.matches || !input.matches('.photobox input[type=file]')) return;
    var box = input.closest('.photobox');
    handleFile(box.getAttribute('data-name'), input.files && input.files[0]);
  });

  document.addEventListener('click', function (e) {
    if (!e.target.classList || !e.target.classList.contains('delphoto')) return;
    var box = e.target.closest('.photobox');
    var name = box.getAttribute('data-name');
    if (state.files[name] && state.files[name].url) URL.revokeObjectURL(state.files[name].url);
    delete state.files[name];
    delete state.ocr[name];
    refresh(name);
    ocrLine(name, '');
    if (name === 'front') setVal('idcard', '');
    if (name === 'card') { setVal('card_no', ''); setVal('card_bank', ''); }
  });

  /* ---------- 提交 ---------- */
  $('#empForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    var msg = $('#empMsg');
    var btn = $('#empSubmit');

    function fail(name, text) {
      bad(name, true);
      if (errOf(name)) errOf(name).textContent = text;
    }

    document.querySelectorAll('.field.bad').forEach(function (f) { f.classList.remove('bad'); });
    document.querySelectorAll('.err').forEach(function (f) { f.textContent = ''; });

    var name = ($('input[name="name"]').value || '').trim();
    var phone = ($('input[name="phone"]').value || '').trim();
    var idcard = ($('input[name="idcard"]').value || '').trim();
    var cardNo = ($('input[name="card_no"]').value || '').trim();

    if (!name) fail('name', '请填写姓名');
    if (!/^1[3-9]\d{9}$/.test(phone)) fail('phone', '请填写正确的 11 位手机号');
    if (!state.files.front) fail('front', '请上传身份证人像面');
    if (!state.files.back) fail('back', '请上传身份证国徽面');
    // 银行卡是选填的：传了就尽量识别，识别不出也不拦提交（管理员可看照片手工录）
    if (state.files.front && !idcard) fail('front', '人像面没识别出身份证号，请重拍或手动联系管理员');
    // 银行卡选填：识别不出只在卡片处提示重拍（applyOcr 里已提示），提交成功页不再重复说

    var bad1 = document.querySelector('.field.bad');
    if (bad1) { bad1.scrollIntoView({ block: 'center' }); return; }

    btn.disabled = true; btn.textContent = '提交中…'; msg.textContent = '';

    var payload = {
      name: name, phone: phone, idcard: idcard,
      card_no: cardNo, card_bank: ($('input[name="card_bank"]').value || '').trim(),
      id_front: state.ocr.front || null,
      id_back: state.ocr.back || null,
      card_ocr: state.ocr.card || null,
      _ref: new URLSearchParams(location.search).get('ref') || '',
    };

    try {
      // 先建记录拿到编号，再把三张图传上去（和主问卷一致）
      var res = await fetch('/api/employee/submit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: payload }),
      });
      var j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error || '提交失败');

      var sides = { front: 'front', back: 'back', card: 'selfie' };
      var up = 0, upFail = 0;
      for (var nm of ['front', 'back', 'card']) {
        if (!state.files[nm]) continue;
        var fd = new FormData();
        fd.append('id', String(j.id));
        fd.append('side', sides[nm]);
        fd.append('file', state.files[nm].blob, nm + '.jpg');
        try {
          var r2 = await fetch('/api/employee/upload', { method: 'POST', body: fd });
          var j2 = await r2.json();
          if (j2 && j2.ok) up++; else upFail++;
        } catch (x) { upFail++; }
      }

      document.getElementById('empForm').innerHTML =
        '<div class="done"><div class="doneicon">✓</div><h2>提交成功</h2>' +
        '<p>登记编号：<b>' + esc(j.id) + '</b></p>' +
        (upFail ? '<p class="warn">有 ' + upFail + ' 张照片没传上去，请记下编号补传</p>'
                : '<p class="dim">证件照片已上传 ' + up + ' 张</p>') +
        '<p class="dim">请截图保存该编号</p>' +
        '<div class="donebtns"><button class="ghost" onclick="location.reload()">再登记一位</button></div></div>';
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      msg.textContent = '提交失败：' + err.message;
      btn.disabled = false; btn.textContent = '提交登记';
    }
  });

  refresh('front'); refresh('back'); refresh('card');
})();
