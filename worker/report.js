/* 报表与邮件推送
 *
 * 两件事：
 *   1. 按日期区间导出 xlsx（后台「按日历导出」+ 每日自动推送共用同一套表头与拼装逻辑）
 *   2. 每日定时把「上次发信之后的新增」打包成 xlsx，通过 Cloudflare Email Service 的
 *      send_email 绑定发到指定邮箱（收件地址必须是账号里已「验证」的目的地址，发给
 *      已验证地址不占额度、永久免费）
 *
 * 时间口径统一用**北京时间**：库里 created_at 是 ISO(UTC)，页面上、邮件里都按 UTC+8 显示，
 * 「今天/昨天/区间」也按北京时间切天。
 */
import { buildXlsx, XLSX_MIME } from './xlsx.js';
import { SURVEY_HEAD, SURVEY_FIELDS, EMPLOYEE_HEAD } from './columns.js';

const BJ_MS = 8 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;

/* ---------------- 时间 ---------------- */
const pad = n => String(n).padStart(2, '0');

/** ISO(UTC) → 北京时间 'YYYY-MM-DD HH:mm' */
export function bjDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return String(iso);
  const t = new Date(d.getTime() + BJ_MS);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())} ${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`;
}

/** 北京时间「今天」的 YYYY-MM-DD */
export function bjToday(now = new Date()) {
  return new Date(now.getTime() + BJ_MS).toISOString().slice(0, 10);
}

/** 北京时间现在是几点（0-23）与分钟 */
export function bjHourMin(now = new Date()) {
  const t = new Date(now.getTime() + BJ_MS);
  return { h: t.getUTCHours(), min: t.getUTCMinutes(), date: t.toISOString().slice(0, 10) };
}

export function isYmd(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
}

/** 'YYYY-MM-DD'（北京）→ 该日 00:00 北京对应的 UTC ISO */
export function dayStartUtc(ymd) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) - BJ_MS).toISOString();
}

/** 'YYYY-MM-DD'（北京）→ 该日 23:59:59.999 北京对应的 UTC ISO */
export function dayEndUtc(ymd) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + DAY_MS - 1 - BJ_MS).toISOString();
}

/** 解析 ?from=&to=（缺省=今天），返回 { from, to, fromIso, toIso } */
export function rangeParams(url) {
  const today = bjToday();
  let from = String(url.searchParams.get('from') || '');
  let to = String(url.searchParams.get('to') || '');
  if (!isYmd(from)) from = today;
  if (!isYmd(to)) to = from;
  if (from > to) { const t = from; from = to; to = t; }
  return { from, to, fromIso: dayStartUtc(from), toIso: dayEndUtc(to) };
}

/* ---------------- 单元格取值 ---------------- */
export function safeParse(s) {
  try { return JSON.parse(s || '{}'); } catch (e) { return {}; }
}

/** 与后台页面的 fmt() 保持一致：数组/对象拍平成可读文本 */
export function fmtVal(v) {
  if (v == null) return '';
  if (Array.isArray(v)) {
    return v.map(x => (x && typeof x === 'object')
      ? Object.values(x).filter(Boolean).join(' / ')
      : x).filter(Boolean).join('、');
  }
  if (typeof v === 'object') return Object.values(v).filter(Boolean).join(' / ');
  return String(v);
}

/** 身份证核验状态（后台那一列的中文说法） */
export function ocrText(raw) {
  const o = safeParse(raw);
  if (!o || !o.ok) return '';
  if (o.notId) return '非身份证';
  if (o.matched && o.num) return '号码一致';
  if (!o.num) return '未读出号码';
  return '号码不一致';
}

/* ---------------- 证件照：从 R2 取原图，嵌进表格单元格 ----------------
 * 员工侧的 selfie 是历史命名（存的是银行卡），face 才是自拍照；两边都取，取不到就留空
 */
const PHOTO_SIDES = ['front', 'back', 'selfie', 'face'];

/**
 * 批量取照片（并发 6，避免串行几十秒）。
 * budgetBytes：整份表最多嵌多少字节的原图；超了就停手，剩下的行退回文字占位，防止把邮件撑爆
 * @returns {Promise<{map: Map<number, {front?:Uint8Array,back?:Uint8Array,selfie?:Uint8Array}>, bytes: number, skipped: number}>}
 */
export async function loadPhotos(env, prefix, items, budgetBytes = 10 * 1024 * 1024) {
  const map = new Map();
  let bytes = 0;
  let skipped = 0;
  if (!env.IDCARDS || !items || !items.length) return { map, bytes, skipped };

  const list = items.slice(0, 800);
  const queue = list.slice();
  const concurrency = Math.min(6, queue.length);

  async function worker() {
    for (;;) {
      const it = queue.shift();
      if (!it) return;
      if (bytes >= budgetBytes) { skipped += 1; continue; }
      const one = {};
      for (const side of PHOTO_SIDES) {
        if (bytes >= budgetBytes) break;
        try {
          const obj = await env.IDCARDS.get(`${prefix}/${it.id}_${side}.jpg`);
          if (!obj) continue;
          const buf = new Uint8Array(await obj.arrayBuffer());
          if (!buf.length) continue;
          if (bytes + buf.length > budgetBytes) { skipped += 1; break; }
          bytes += buf.length;
          one[side] = buf;
        } catch (e) { /* 单张读失败不影响整体 */ }
      }
      if (Object.keys(one).length) map.set(it.id, one);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  return { map, bytes, skipped };
}

/* ---------------- 表格拼装 ---------------- */
const SURVEY_XLSX_HEAD = SURVEY_HEAD.slice(0, 4)
  .concat(['身份证核验'], SURVEY_FIELDS.map(f => f.label));

function imgCell(bytes) {
  return bytes ? { img: { data: bytes, ext: 'jpeg' } } : '';
}

export function surveySheet(items, photos) {
  const rows = [SURVEY_XLSX_HEAD];
  (items || []).forEach(it => {
    const d = safeParse(it.payload);
    const mine = photos && photos.get(it.id);
    const row = [it.id, bjDate(it.created_at), it.name || '', it.phone || '', ocrText(it.ocr)];
    SURVEY_FIELDS.forEach(f => {
      if (f.t === 'rows') {
        const arr = Array.isArray(d[f.from]) ? d[f.from] : [];
        row.push(arr.map(x => (x && x[f.col]) || '').filter(Boolean).join(' | '));
      } else if (f.t === 'photo') {
        // 有原图就直接嵌进单元格；读不到 / 超出体积预算时留空（不再写「已上传照片」那行字）
        row.push(mine && mine[f.side] ? imgCell(mine[f.side]) : '');
      } else {
        row.push(fmtVal(d[f.k]));
      }
    });
    rows.push(row);
  });
  return rows;
}

export function employeeSheet(items, photos) {
  const rows = [EMPLOYEE_HEAD];
  (items || []).forEach(it => {
    const p = safeParse(it.payload);
    const f = p.id_front || {};
    const mine = photos && photos.get(it.id);
    rows.push([
      it.id, bjDate(it.created_at), it.name || '', it.phone || '',
      it.idcard || '', it.card_no || '', it.card_bank || '',
      f.address || '', f.riskType || '',
      (p._ref || ''),
      mine && mine.front ? imgCell(mine.front) : '',
      mine && mine.back ? imgCell(mine.back) : '',
      mine && mine.selfie ? imgCell(mine.selfie) : '',
      mine && mine.face ? imgCell(mine.face) : '',
    ]);
  });
  return rows;
}

/**
 * 生成 xlsx：两块数据各一张表，空的那张自动不生成
 * @param {{survey?:Array, employee?:Array, surveyPhotos?:Map, employeePhotos?:Map}} opts
 * @returns {Promise<Uint8Array|null>} 都没数据时返回 null
 */
export async function buildWorkbook({ survey, employee, surveyPhotos, employeePhotos, surveyName, employeeName }) {
  const sheets = [];
  if (survey && survey.length) sheets.push({ name: surveyName || '入职与技能考察登记表', rows: surveySheet(survey, surveyPhotos) });
  if (employee && employee.length) sheets.push({ name: employeeName || '员工信息登记', rows: employeeSheet(employee, employeePhotos) });
  if (!sheets.length) return null;
  return buildXlsx(sheets);
}

/* ---------------- 取数 ---------------- */
export async function fetchSurvey(env, fromIso, toIso, form, limit = 5000) {
  let sql = 'SELECT id, form, created_at, name, phone, payload, ocr FROM submissions WHERE created_at >= ? AND created_at <= ?';
  const args = [fromIso, toIso];
  if (form) { sql += ' AND form = ?'; args.push(form); }
  sql += ' ORDER BY id ASC LIMIT ' + Number(limit || 5000);
  const r = await env.DB.prepare(sql).bind(...args).all();
  return (r && r.results) || [];
}

export async function fetchEmployees(env, fromIso, toIso, limit = 5000) {
  const r = await env.DB.prepare(
    'SELECT id, created_at, name, phone, idcard, card_no, card_bank, payload FROM employees WHERE created_at >= ? AND created_at <= ? ORDER BY id ASC LIMIT ' + Number(limit || 5000)
  ).bind(fromIso, toIso).all();
  return (r && r.results) || [];
}

/* ---------------- 配置读写（app_settings 表） ---------------- */
export const MAIL_DEFAULTS = {
  mail_enabled: '0',
  mail_to: '',
  mail_hour: '8',
  mail_from: 'noreply@199118.xyz',
  mail_from_name: '暖通招聘登记',
  mail_last_at: '',
  cron_last_at: '',
  cron_last_note: '',
};

export async function getSettings(env) {
  const o = Object.assign({}, MAIL_DEFAULTS);
  try {
    const r = await env.DB.prepare('SELECT k, v FROM app_settings').all();
    ((r && r.results) || []).forEach(x => { if (x && x.k) o[x.k] = x.v; });
  } catch (e) { /* 表还没建就先用默认值，别让后台打不开 */ }
  return o;
}

export async function setSetting(env, k, v) {
  await env.DB.prepare(
    'INSERT INTO app_settings (k, v, updated_at) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at'
  ).bind(k, String(v == null ? '' : v), new Date().toISOString()).run();
}

export async function getMailConfig(env) {
  const s = await getSettings(env);
  const recipients = String(s.mail_to || '').split(/[,，;；\s]+/).map(x => x.trim()).filter(Boolean);
  let hour = parseInt(s.mail_hour, 10);
  if (!(hour >= 0 && hour <= 23)) hour = 8;
  return {
    enabled: s.mail_enabled === '1',
    recipients,
    hour,
    from: s.mail_from || MAIL_DEFAULTS.mail_from,
    fromName: s.mail_from_name || MAIL_DEFAULTS.mail_from_name,
    lastAt: s.mail_last_at || '',
    cronLastAt: s.cron_last_at || '',
    cronLastNote: s.cron_last_note || '',
  };
}

/* ---------------- 发送 ---------------- */
function toBase64(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export async function sendMail(env, { to, subject, html, text, from, fromName, attachment, extraAttachments }) {
  if (!env.EMAIL) {
    const e = new Error('Worker 还没绑定邮件发送（send_email 绑定名 EMAIL）');
    e.code = 'NO_BINDING';
    throw e;
  }
  const msg = {
    from: { email: from || env.MAIL_FROM || 'noreply@199118.xyz', name: fromName || '暖通招聘登记' },
    to: Array.isArray(to) ? to : [to],
    subject,
    html,
    text,
  };
  const list = [];
  if (attachment) {
    list.push({
      content: toBase64(attachment.content),
      filename: attachment.filename,
      type: attachment.type || XLSX_MIME,
      disposition: 'attachment',
    });
  }
  (extraAttachments || []).forEach(a => list.push({
    content: typeof a.content === 'string' ? a.content : toBase64(a.data),
    filename: a.filename,
    type: a.type || 'application/octet-stream',
    disposition: 'attachment',
  }));
  if (list.length) msg.attachments = list;
  return env.EMAIL.send(msg);
}

/** 邮件正文：新增记录速览 */
function digestHtml(fromLabel, toLabel, survey, employee) {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const block = (title, items, cols) => {
    if (!items.length) return `<h3 style="margin:18px 0 6px">${title}：0 条</h3>`;
    const head = cols.map(c => `<th align="left" style="padding:4px 10px 4px 0;border-bottom:1px solid #ddd">${c[0]}</th>`).join('');
    const body = items.slice(0, 100).map(it => `<tr>${cols.map(c => `<td style="padding:4px 10px 4px 0;border-bottom:1px solid #f0f0f0">${esc(c[1](it))}</td>`).join('')}</tr>`).join('');
    return `<h3 style="margin:18px 0 6px">${title}：${items.length} 条</h3>
      <table style="border-collapse:collapse;font-size:13px"><tr>${head}</tr>${body}</table>`
      + (items.length > 100 ? `<p style="color:#888">仅列出前 100 条，完整数据见附件</p>` : '');
  };
  const surveyOcr = it => ocrText(it.ocr) || '未核验';
  return `<div style="font-family:-apple-system,'Segoe UI','Microsoft YaHei',sans-serif;color:#222">
  <p>统计区间（北京时间）：<b>${fromLabel} → ${toLabel}</b></p>
  ${block('入职与技能考察登记表', survey, [['编号', it => it.id], ['姓名', it => it.name || '—'], ['电话', it => it.phone || '—'], ['身份证核验', surveyOcr], ['提交时间', it => bjDate(it.created_at)]])}
  ${block('员工信息登记', employee, [['编号', it => it.id], ['姓名', it => it.name || '—'], ['手机号', it => it.phone || '—'], ['身份证号', it => it.idcard || ''], ['登记时间', it => bjDate(it.created_at)]])}
  <p style="margin-top:20px;color:#666">完整表格见附件 xlsx。也可在后台按日期区间导出：<br>
  https://survey.199118.xyz/admin.html</p>
  </div>`;
}

/**
 * 生成并发送一期汇总。不判断是否需要发（由调用方决定）。
 * @returns {Promise<{ok:boolean, count:number, message:string}>}
 */
export async function sendDigest(env, { fromIso, toIso, fromLabel, toLabel, recipients, test, label, withPhotos = true, extraAttachments = null }) {
  const cfg = await getMailConfig(env);
  const to = recipients && recipients.length ? recipients : cfg.recipients;
  if (!to.length) return { ok: false, count: 0, message: '还没设置收件邮箱' };

  const [survey, employee] = await Promise.all([
    fetchSurvey(env, fromIso, toIso, ''),
    fetchEmployees(env, fromIso, toIso),
  ]);
  const count = survey.length + employee.length;
  if (!count && !test) return { ok: true, count: 0, message: '区间内没有新增，跳过发送' };

  // 邮件附件的总大小受 25MiB 限制（还要再 base64 膨胀 1/3），所以给图片单独留个更紧的预算
  let surveyPhotos = null;
  let employeePhotos = null;
  if (withPhotos) {
    const [sp, ep] = await Promise.all([
      survey.length ? loadPhotos(env, 'idcard', survey, 6 * 1024 * 1024) : null,
      employee.length ? loadPhotos(env, 'employee', employee, 6 * 1024 * 1024) : null,
    ]);
    surveyPhotos = sp && sp.map;
    employeePhotos = ep && ep.map;
  }

  const bytes = await buildWorkbook({ survey, employee, surveyPhotos, employeePhotos });
  const day = toLabel.slice(0, 10);
  const subject = test
    ? `【测试${label ? '·' + label : ''}】暖通招聘登记 · ${day}（${survey.length} 份问卷 / ${employee.length} 份员工登记）`
    : `【暖通招聘】${day} 新增 ${survey.length} 份问卷 / ${employee.length} 份员工登记`;

  await sendMail(env, {
    to,
    subject,
    from: cfg.from,
    fromName: cfg.fromName,
    html: digestHtml(fromLabel, toLabel, survey, employee),
    text: `统计区间 ${fromLabel} → ${toLabel}：问卷 ${survey.length} 条，员工登记 ${employee.length} 条。完整数据（证件照已嵌在表格里）见附件。`,
    attachment: bytes ? { content: bytes, filename: `survey-report-${day}.xlsx` } : null,
    extraAttachments,
  });

  return { ok: true, count, message: `已发送到 ${to.join('、')}` };
}

/**
 * 定时任务入口：每次触发都把「什么时候跑的 / 结果如何」写回 app_settings，
 * 后台因此能看到定时任务到底有没有在跑（Cloudflare 那边没有直接看 cron 触发记录的地方）。
 */
export async function runScheduledDigest(env, now = new Date()) {
  let note;
  try {
    note = await digestTick(env, now);
  } catch (e) {
    note = '出错：' + ((e && e.message) || String(e));
  }
  try {
    await setSetting(env, 'cron_last_at', now.toISOString());
    await setSetting(env, 'cron_last_note', note);
  } catch (e) { /* 心跳写不进去也不影响主流程 */ }
  return note;
}

/**
 * 定时任务主流程：到点 → 取「上次成功发信之后」的新增 → 有就发一封
 * 同一天只发一次（发过就跳过，避免每小时重复轰炸）
 */
async function digestTick(env, now) {
  const cfg = await getMailConfig(env);
  if (!cfg.enabled) return '未启用';
  if (!cfg.recipients.length) return '未配置收件邮箱';

  const { h, date } = bjHourMin(now);
  if (h !== cfg.hour) return `未到发送时间（现在 ${h} 点，设定 ${cfg.hour} 点）`;

  // 今天是否已经发过（按时间戳落在今天北京时间之内判断）
  try {
    const today = await env.DB.prepare('SELECT COUNT(*) AS n FROM mail_log WHERE ok = 1 AND sent_at >= ?').bind(dayStartUtc(date)).first();
    if (today && today.n > 0) return '今天已经发过一封了';
  } catch (e) { /* mail_log 没建也不致命 */ }

  const fromIso = cfg.lastAt && cfg.lastAt > '2020-01-01' ? cfg.lastAt : new Date(now.getTime() - DAY_MS).toISOString();
  const toIso = now.toISOString();

  let res;
  try {
    res = await sendDigest(env, {
      fromIso, toIso,
      fromLabel: bjDate(fromIso), toLabel: bjDate(toIso),
      recipients: cfg.recipients,
    });
  } catch (e) {
    await logMail(env, { to: cfg.recipients.join(','), subject: '定时汇总', survey: 0, employee: 0, ok: 0, error: (e && e.message) || String(e) });
    return '发送失败：' + ((e && e.message) || e);
  }

  if (!res.ok) return res.message;
  if (!res.count) return '无新增，跳过';

  await setSetting(env, 'mail_last_at', toIso);
  await logMail(env, { to: cfg.recipients.join(','), subject: '每日汇总', survey: null, employee: null, ok: 1, error: '' });
  return '已发送：' + res.message;
}

export async function logMail(env, { to, subject, survey, employee, ok, error }) {
  try {
    await env.DB.prepare(
      'INSERT INTO mail_log (sent_at, recipients, subject, survey_count, employee_count, ok, error) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(new Date().toISOString(), String(to || ''), String(subject || ''), Number(survey || 0), Number(employee || 0), ok ? 1 : 0, String(error || '')).run();
    // 只留最近 200 条
    await env.DB.prepare('DELETE FROM mail_log WHERE id <= (SELECT MAX(id) - 200 FROM mail_log)').run();
  } catch (e) { /* 记账失败不影响主流程 */ }
}
