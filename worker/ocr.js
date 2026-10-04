/* 身份证 OCR —— 多厂商 + 多账号自动轮换
 *
 * 统一出口：ocrWithProvider(provider, creds, imageBytes)
 * 返回：{ num, name, sex, birth, raw }
 * 抛出 Error 时，message 里带 ERR_QUOTA 前缀表示"额度用完/欠费"，调用方据此把该账号标记为本月耗尽。
 *
 * 当前三家：
 *   baidu   百度智能云 —— 个人认证 1000 次/月、企业认证 2000 次/月免费
 *   tencent 腾讯云     —— 约 1000 次/月免费（与卡证识别共享包）
 *   aliyun  阿里云     —— 约 200 次/月免费
 */

const enc = new TextEncoder();

/* ---------- 通用小工具 ---------- */

export function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  const CH = 0x8000;
  let s = '';
  for (let i = 0; i < bytes.length; i += CH) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  }
  return btoa(s);
}

function hex(u8) {
  let s = '';
  for (const b of u8) s += b.toString(16).padStart(2, '0');
  return s;
}

async function hmacSha256(keyBytes, msg) {
  const k = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(msg)));
}

async function hmacSha1(keyBytes, msg) {
  const k = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(msg)));
}

async function sha256hex(msg) {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(msg));
  return hex(new Uint8Array(d));
}

/* 阿里云专用百分号编码 */
function pct(str) {
  return encodeURIComponent(str)
    .replace(/!/g, '%21').replace(/'/g, '%27')
    .replace(/\(/g, '%28').replace(/\)/g, '%29')
    .replace(/\*/g, '%2A');
}

/* 从返回里找身份证号：各家字段名不同，兜底再扫一遍所有字符串 */
function pickNumber(obj) {
  if (!obj || typeof obj !== 'object') return '';
  const direct = ['IdNum', 'id_num', 'idcard_number', 'num', 'number', '公民身份号码', '身份证号'];
  for (const k of direct) {
    const v = obj[k];
    if (typeof v === 'string' && /\d{15,18}X?/i.test(v)) return normalizeId(v);
    if (v && typeof v === 'object' && typeof v.words === 'string') return normalizeId(v.words);
  }
  const found = deepFindId(obj);
  return found ? normalizeId(found) : '';
}

function deepFindId(node, depth = 0) {
  if (depth > 6 || !node) return '';
  if (typeof node === 'string') {
    const m = node.match(/\b\d{17}[\dXx]\b/);
    return m ? m[0] : '';
  }
  if (Array.isArray(node)) {
    for (const x of node) { const r = deepFindId(x, depth + 1); if (r) return r; }
    return '';
  }
  if (typeof node === 'object') {
    for (const k of Object.keys(node)) {
      const r = deepFindId(node[k], depth + 1);
      if (r) return r;
    }
  }
  return '';
}

export function normalizeId(s) {
  return String(s || '').replace(/\s/g, '').toUpperCase();
}

function pickText(obj, keys) {
  if (!obj || typeof obj !== 'object') return '';
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string') return v.trim();
    if (v && typeof v === 'object' && typeof v.words === 'string') return v.words.trim();
  }
  return '';
}

/* 把各种错误归一：额度类问题统一打 ERR_QUOTA 标记 */
function fail(kind, msg) {
  const e = new Error((kind === 'quota' ? 'ERR_QUOTA ' : '') + msg);
  e.quota = kind === 'quota';
  return e;
}

/* ---------- 百度智能云 ---------- */

const baiduTokenCache = new Map();

async function baiduAccessToken(ak, sk) {
  const ck = ak.slice(0, 8);
  const hit = baiduTokenCache.get(ck);
  if (hit && hit.exp > Date.now()) return hit.token;

  const r = await fetch(
    'https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials' +
    '&client_id=' + encodeURIComponent(ak) + '&client_secret=' + encodeURIComponent(sk)
  );
  const j = await r.json();
  if (!j || !j.access_token) {
    const em = (j && (j.error_description || j.error)) || '';
    if (/配额|额度|quota|limit/i.test(em)) throw fail('quota', '百度额度异常：' + em);
    throw fail('auth', '百度 token 获取失败：' + em || '未知错误');
  }
  baiduTokenCache.set(ck, { token: j.access_token, exp: Date.now() + (j.expires_in - 600) * 1000 });
  return j.access_token;
}

async function baiduCall(api, params, c) {
  const token = await baiduAccessToken(c.ak, c.sk);
  const body = new URLSearchParams();
  for (const k of Object.keys(params)) body.set(k, params[k]);

  const r = await fetch('https://aip.baidubce.com/rest/2.0/ocr/v1/' + api + '?access_token=' + token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const j = await r.json();
  if (j.error_code) {
    const msg = j.error_msg || ('error_code ' + j.error_code);
    // 17/18/19 = 免费额度/日调用量类超限；其余按普通错误处理
    if ([17, 18, 19].includes(j.error_code) || /额度|免费|次数|已用完|超出/i.test(msg)) {
      throw fail('quota', '百度：' + msg);
    }
    throw fail('api', '百度：' + msg);
  }
  return j;
}

/* 人像面 / 国徽面。side: 'front' | 'back' */
async function ocrBaidu(c, bytes, side) {
  const j = await baiduCall('idcard', {
    image: toBase64(bytes),
    id_card_side: side === 'back' ? 'back' : 'front',
    detect_quality: 'true',
    detect_risk: 'true',
    detect_ps: 'true',
  }, c);

  const w = j.words_result || {};
  const status = String(j.image_status || '');
  const risk = String(j.risk_type || '');
  const numType = j.idcard_number_type;

  // 明确不是身份证 / 翻拍截图 / 复印件 —— 直接判不合格
  if (status === 'non_idcard' || status === 'other_type_card') {
    throw fail('notid', status === 'non_idcard' ? '图片里没有识别到身份证' : '这不是身份证');
  }
  if (risk === 'copy' || risk === 'screenshot') {
    throw fail('notid', risk === 'copy' ? '检测到复印件，请拍原件' : '检测到屏幕截图，请拍实物');
  }

  return {
    kind: 'idcard',
    side: side === 'back' ? 'back' : 'front',
    num: pickNumber(w),
    name: pickText(w, ['姓名']),
    sex: pickText(w, ['性别']),
    nation: pickText(w, ['民族']),
    birth: pickText(w, ['出生']),
    address: pickText(w, ['住址']),
    authority: pickText(w, ['签发机关']),
    validFrom: pickText(w, ['签发日期']),
    validTo: pickText(w, ['失效日期']),
    imageStatus: status,
    riskType: risk,
    quality: (j.card_quality && j.card_quality.IsClear_probobility) || '',
    numType: numType,
    raw: j,
  };
}

/* 银行卡 */
async function ocrBankcardBaidu(c, bytes) {
  const j = await baiduCall('bankcard', {
    image: toBase64(bytes),
    detect_quality: 'true',
  }, c);
  const r = j.result || {};
  const num = String(r.bank_card_number || '').replace(/\s+/g, '');
  if (!num) throw fail('notid', '图片里没有识别到银行卡号');
  return {
    kind: 'bankcard',
    num: num,
    bankName: String(r.bank_name || ''),
    holderName: String(r.holder_name || ''),
    validDate: String(r.valid_date || ''),
    cardType: r.bank_card_type,
    quality: (j.card_quality && j.card_quality.IsClear_probability) || '',
    raw: j,
  };
}

/* ---------- 腾讯云（TC3-HMAC-SHA256） ---------- */

async function ocrTencent(c, bytes, opts) {
  const o = opts || {};
  const host = c.host || 'ocr.tencentcloudapi.com';
  const region = c.region || 'ap-guangzhou';
  const isBank = o.biz === 'bank';
  const action = isBank ? 'BankCardOCR' : 'IDCardOCR';
  const version = '2018-11-19';
  const payload = JSON.stringify(isBank
    ? { ImageBase64: toBase64(bytes) }
    : { ImageBase64: toBase64(bytes), CardSide: 'FRONT' });

  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const timestamp = Math.floor(now.getTime() / 1000);

  const signedHeaders = 'content-type;host;x-tc-action';
  const canonicalHeaders =
    'content-type:application/json\nhost:' + host + '\nx-tc-action:' + action.toLowerCase() + '\n';
  const payloadHash = await sha256hex(payload);
  const canonicalRequest =
    'POST\n/\n\n' + canonicalHeaders + '\n' + signedHeaders + '\n' + payloadHash;

  const algorithm = 'TC3-HMAC-SHA256';
  const credentialScope = date + '/ocr/tc3_request';
  const stringToSign =
    algorithm + '\n' + timestamp + '\n' + credentialScope + '\n' + (await sha256hex(canonicalRequest));

  const secretDate = await hmacSha256(enc.encode('TC3' + c.sk), date);
  const secretService = await hmacSha256(secretDate, 'ocr');
  const secretSigning = await hmacSha256(secretService, 'tc3_request');
  const signature = hex(await hmacSha256(secretSigning, stringToSign));

  const auth =
    algorithm + ' Credential=' + c.id + '/' + credentialScope +
    ', SignedHeaders=' + signedHeaders + ', Signature=' + signature;

  const r = await fetch('https://' + host + '/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Host: host,
      'X-TC-Action': action,
      'X-TC-Version': version,
      'X-TC-Timestamp': String(timestamp),
      'X-TC-Region': region,
      Authorization: auth,
    },
    body: payload,
  });
  const j = await r.json();
  const resp = j && j.Response;
  if (!resp) throw fail('api', '腾讯云：返回异常');
  if (resp.Error) {
    const code = String(resp.Error.Code || '');
    const msg = resp.Error.Message || code;
    if (/LimitExceeded|FreeQuota|Quota|Balance|Arrears/i.test(code)) throw fail('quota', '腾讯云：' + msg);
    throw fail('api', '腾讯云：' + msg);
  }
  return isBank
    ? {
        kind: 'bankcard',
        num: normalizeId(resp.CardNum || ''),
        bankName: String(resp.BankName || ''),
        holderName: String(resp.HolderName || ''),
        validDate: String(resp.ValidDate || ''),
        raw: resp,
      }
    : {
        kind: 'idcard',
        num: pickNumber(resp),
        name: pickText(resp, ['Name']),
        sex: pickText(resp, ['Sex']),
        birth: pickText(resp, ['Birth']),
        address: pickText(resp, ['Address']),
        authority: pickText(resp, ['Authority']),
        raw: resp,
      };
}

/* ---------- 阿里云（POP RPC 签名） ---------- */

async function ocrAliyun(c, bytes, opts) {
  const o = opts || {};
  const host = c.host || 'ocr-api.cn-shanghai.aliyuncs.com';
  const action = o.action || c.action || 'RecognizeIdcard';
  const version = c.version || '2021-07-07';
  const imageKey = c.imageParam || 'ImageBase64';

  const params = {
    AccessKeyId: c.ak,
    Action: action,
    Format: 'JSON',
    RegionId: c.region || 'cn-shanghai',
    SignatureMethod: 'HMAC-SHA1',
    SignatureNonce: crypto.randomUUID().replace(/-/g, ''),
    SignatureVersion: '1.0',
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    Version: version,
    [imageKey]: toBase64(bytes),
  };
  if (c.sideParam) params[c.sideParam] = c.sideValue || 'face';

  const sorted = Object.keys(params).sort();
  const canon = sorted.map(k => pct(k) + '=' + pct(params[k])).join('&');
  const stringToSign = 'POST' + '&' + pct('/') + '&' + pct(canon);
  const sigBytes = await hmacSha1(enc.encode(c.sk + '&'), stringToSign);
  const signature = btoa(String.fromCharCode.apply(null, sigBytes));

  const url = 'https://' + host + '/?' + canon + '&Signature=' + pct(signature);
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  const j = await r.json();
  if (j && j.Code && j.Code !== '200' && j.Code !== 200) {
    const msg = j.Message || j.Code;
    if (/配额|额度|Quota|Throttling|Arrears|余额/i.test(String(msg) + String(j.Code))) {
      throw fail('quota', '阿里云：' + msg);
    }
    throw fail('api', '阿里云：' + msg);
  }
  const data = (j && (j.Data || j.data)) || j || {};
  return {
    num: pickNumber(data),
    name: pickText(data, ['Name', 'name']),
    sex: pickText(data, ['Sex', 'sex', 'Gender']),
    birth: pickText(data, ['BirthDate', 'birth', 'Birth']),
    raw: j,
  };
}

/* ---------- 统一出口 ---------- */

export async function ocrWithProvider(provider, creds, bytes, opts) {
  const o = opts || {};
  switch (provider) {
    case 'baidu':
      if (o.kind === 'bankcard') return ocrBankcardBaidu(creds, bytes);
      return ocrBaidu(creds, bytes, o.side);
    case 'tencent':
      if (o.kind === 'bankcard') {
        return ocrTencent(creds, bytes, { CardSide: o.side === 'back' ? 'BACK' : 'FRONT', Biz: 'bank' });
      }
      return ocrTencent(creds, bytes);
    case 'aliyun': {
      if (o.kind === 'bankcard') {
        return ocrAliyun(creds, bytes, { action: 'RecognizeBankcard' });
      }
      return ocrAliyun(creds, bytes, {});
    }
    default: throw fail('api', '未知的 OCR 厂商：' + provider);
  }
}

export const PROVIDER_LABEL = {
  baidu: '百度智能云',
  tencent: '腾讯云',
  aliyun: '阿里云',
};
