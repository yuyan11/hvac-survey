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
