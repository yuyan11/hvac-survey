-- D1 建表语句
-- 执行： npx wrangler d1 execute survey-db --file=./schema.sql --remote

CREATE TABLE IF NOT EXISTS submissions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  form       TEXT NOT NULL,          -- onboarding | hvac
  created_at TEXT NOT NULL,          -- ISO8601 UTC
  name       TEXT,                   -- 姓名 / 队伍名
  phone      TEXT,                   -- 联系电话
  payload    TEXT NOT NULL           -- 完整答卷 JSON
);

CREATE INDEX IF NOT EXISTS idx_submissions_form_time ON submissions (form, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_submissions_created ON submissions (created_at DESC);

-- 身份证 OCR 核验结果（JSON），老库需单独执行一次：
-- ALTER TABLE submissions ADD COLUMN ocr TEXT;

-- OCR 账号池：多家厂商、多个账号，额度用完自动跳下一个
CREATE TABLE IF NOT EXISTS ocr_keys (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  provider        TEXT NOT NULL,        -- baidu | tencent | aliyun
  label           TEXT,                 -- 备注，如「百度·个人认证」
  creds           TEXT NOT NULL,        -- JSON：百度 {ak,sk} / 腾讯 {id,sk} / 阿里 {ak,sk}
  enabled         INTEGER NOT NULL DEFAULT 1,
  exhausted_month TEXT NOT NULL DEFAULT '', -- 形如 2026-09，表示本月额度已耗尽
  fail_count      INTEGER NOT NULL DEFAULT 0,
  updated_at      TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_ocr_keys_enabled ON ocr_keys (enabled, provider);

-- 员工信息登记表：与入职考察问卷（submissions）完全独立的表
-- 照片也走独立前缀 employee/{编号}_{front|back|selfie}.jpg，两边编号各算各的
CREATE TABLE IF NOT EXISTS employees (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  name       TEXT NOT NULL,
  phone      TEXT NOT NULL,
  idcard     TEXT NOT NULL,               -- 身份证号（OCR 自动填）
  card_no    TEXT,                        -- 银行卡号（OCR 自动填）
  card_bank  TEXT,                        -- 开户行（OCR 自动填）
  payload    TEXT NOT NULL                -- 完整 JSON，含 OCR 原始结果
);

CREATE INDEX IF NOT EXISTS idx_employees_created ON employees (created_at DESC);
