/* 员工登记专用后台：独立接口、独立数据，与入职考察后台互不相通 */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var token = '';
  var cur = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function localTime(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return iso;
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function maskId(s) {
    s = String(s || '');
    return s.length >= 10 ? s.slice(0, 6) + '********' + s.slice(-4) : s;
  }
  function maskCard(s) {
    s = String(s || '');
    return s.length >= 8 ? s.slice(0, 4) + ' **** **** ' + s.slice(-4) : s;
  }

  function login() {
    $('#host').innerHTML =
      '<div class="login"><h2>管理员登录</h2>' +
      '<input type="password" id="tk" placeholder="输入后台查看口令">' +
      '<button class="btn" id="go">进入</button></div>';
    $('#go').onclick = function () {
      token = $('#tk').value.trim();
      if (!token) return;
      localStorage.setItem('emp_admin_token', token);
      load();
    };
    $('#tk').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('#go').click(); });
  }

  function load() {
    fetch('/api/employee/results?token=' + encodeURIComponent(token))
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.ok) { token = ''; login(); return; }
        render(j.list || []);
      })
      .catch(function () { token = ''; login(); });
  }

  function render(list) {
    cur = list;
    var rows = list.map(function (r) {
      return '<tr>' +
        '<td>' + r.id + '</td>' +
        '<td>' + esc(r.name) + '</td>' +
        '<td>' + esc(r.phone) + '</td>' +
        '<td>' + esc(maskId(r.idcard)) + '</td>' +
        '<td>' + esc(maskCard(r.card_no) || '—') + '</td>' +
        '<td>' + esc(r.card_bank || '—') + '</td>' +
        '<td>' + esc(localTime(r.created_at)) + '</td>' +
        '<td><button class="linkbtn" data-id="' + r.id + '">查看详情</button></td>' +
        '</tr>';
    }).join('');

    $('#host').innerHTML =
      '<h2>员工登记列表</h2>' +
      '<p class="sub">共 ' + list.length + ' 条 · 仅本表数据，与入职考察表相互独立</p>' +
      '<div class="toolbar"><button class="btn gray" id="refresh">刷新</button>' +
      '<button class="btn gray" id="csv">导出 CSV</button><button class="btn gray" id="logout">退出</button></div>' +
      '<div class="tblwrap"><table><thead><tr>' +
      '<th>编号</th><th>姓名</th><th>手机号</th><th>身份证号</th><th>银行卡号</th><th>开户行</th><th>登记时间</th><th>操作</th>' +
      '</tr></thead><tbody>' + (rows || '<tr><td colspan="8" class="empty">暂无数据</td></tr>') + '</tbody></table></div>';

    $('#refresh').onclick = load;
    $('#logout').onclick = function () { token = ''; login(); };
    $('#csv').onclick = exportCsv;
    document.querySelectorAll('[data-id]').forEach(function (b) {
      b.onclick = function () { detail(b.getAttribute('data-id')); };
    });
  }

  function exportCsv() {
    if (!cur || !cur.length) return alert('没有数据');
    var head = ['编号', '姓名', '手机号', '身份证号', '银行卡号', '开户行', '登记时间'];
    var lines = [head.join(',')];
    cur.forEach(function (r) {
      lines.push([r.id, r.name, r.phone, r.idcard, r.card_no || '', r.card_bank || '', localTime(r.created_at)]
        .map(function (x) { return '"' + String(x == null ? '' : x).replace(/"/g, '""') + '"'; }).join(','));
    });
    var blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '员工登记-' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function detail(id) {
    fetch('/api/employee/results?token=' + encodeURIComponent(token) + '&id=' + id)
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.ok) return alert(j.error || '加载失败');
        var it = j.item || {};
        var p = it.payload || {};
        var idFront = p.id_front || {}, idBack = p.id_back || {}, card = p.card_ocr || {};
        var figs = '';
        [['front', '身份证 · 人像面'], ['back', '身份证 · 国徽面'], ['selfie', '银行卡']].forEach(function (x) {
          figs += '<figure><img src="/api/employee/photo?token=' + encodeURIComponent(token) +
            '&id=' + it.id + '&side=' + x[0] + '" alt="' + x[1] + '"><figcaption>' + x[1] + '</figcaption></figure>';
        });

        var kv = [];
        function add(k, v) { if (v) kv.push('<div>' + esc(k) + '</div><div>' + esc(v) + '</div>'); }
        add('姓名', it.name);
        add('手机号', it.phone);
        add('身份证号', it.idcard);
        add('银行卡号', it.card_no);
        add('开户行', it.card_bank);
        add('登记时间', localTime(it.created_at));
        if (idFront.num) add('OCR 读到的号码', idFront.num + (idFront.num === String(it.idcard || '').toUpperCase() ? '（一致）' : '（与填写不一致）'));
        if (idFront.name) add('OCR 读到的姓名', idFront.name);
        if (idFront.riskType) add('证件风险判定', idFront.riskType);
        if (idBack.authority) add('签发机关', idBack.authority);
        if (idBack.validFrom) add('有效期限', idBack.validFrom + (idBack.validTo ? ' 至 ' + idBack.validTo : ''));
        if (card.bankName) add('OCR 开户行', card.bankName);
        if (card.holderName) add('OCR 持卡人', card.holderName);

        $('#host').innerHTML =
          '<div class="tblwrap detail"><div style="padding:18px">' +
          '<p><button class="btn gray" id="back">← 返回列表</button></p>' +
          '<h2>' + esc(it.name) + ' <span style="font-size:14px;color:var(--dim)">#' + it.id + '</span></h2>' +
          '<p class="sub">员工信息登记 · ' + esc(localTime(it.created_at)) + '</p>' +
          '<h3>证件照片</h3><div class="idcardimgs">' + figs + '</div>' +
          '<h3>登记信息</h3><div class="kv">' + kv.join('') + '</div>' +
          '</div></div>';
        $('#back').onclick = function () { render(cur || []); window.scrollTo({ top: 0, behavior: 'smooth' }); };
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
  }

  var saved = localStorage.getItem('emp_admin_token');
  if (saved) { token = saved; load(); } else login();
})();
