# 入职与技能考察登记表

单页问卷系统，运行在 Cloudflare：Pages 静态页 + Pages Functions + D1 数据库 + R2 照片存储。
入职登记与中央空调安装技能考察合并为**一份连续表单**，一次填完、一次提交。

## 目录结构

```
survey/
├── public/                  # 静态页（Pages 的构建输出目录）
│   ├── index.html           # 问卷主页
│   ├── admin.html           # 管理员查看 / 导出答卷
│   ├── schema.js            # 题目定义（改题目只动这个文件）
│   ├── idcard.js            # 身份证号解析（出生日期 / 年龄 / 性别 + 校验位算法）
│   ├── app.js               # 渲染引擎：条件分支、校验、提交、照片上传
│   ├── admin.js             # 后台：列表 / 详情 / 看身份证照片 / 导出 CSV 与 JSON
│   └── styles.css
├── functions/api/           # Pages Functions（后端接口）
│   ├── submit.js            # POST /api/submit   答卷写入 D1
│   ├── upload.js            # POST /api/upload   身份证照片写入 R2
│   ├── results.js           # GET  /api/results  管理员读取答卷
│   └── photo.js             # GET  /api/photo    管理员读取身份证照片
├── schema.sql               # D1 建表语句
└── wrangler.toml            # D1 / R2 绑定 + 管理员口令
```

## 表单内容（20 组 / 111 题）

**入职登记部分**
1. 基本信息 —— 填身份证号后**自动解析出生日期与年龄**（不单独出题），并校验号码校验位、与所选性别是否一致；身份证人像面 / 国徽面**拍照或从相册上传**
2. 应聘信息
3. 学历与证书
4. **工作经历** —— 按项目逐条填写：公司/单位、项目名称及地点、做了什么（机型/规模/工艺）、起止时间、担任岗位；**最多 15 条**，默认给 3 行
5. 身体状况与作业条件
6. 工具与交通
7. 工资发放与紧急联系人
8. 其他事项

**技能考察部分**（接在入职部分后面，同一份表单、同一个提交按钮）
9. 队伍与作业能力
10. 可承接机型（决定后续题目）
11–16. 按机型自动展开专项：

| 选中机型 | 自动展开的专项 |
|---|---|
| 多联机 VRF | 品牌经验、配管下料、气密试验、真空干燥、追加冷媒、冷凝水、保温、电气、调试排故 |
| 水机 | 冷源类型、水管连接、附件、水泵选型、水压试验、冷却塔、末端、保温、水力平衡、防冻 |
| 风管/新风 | 板材、厚度、制作工艺、部件、保温 |
| 消防防排烟 | 防排烟内容、钢板厚度、阀门安装、验收资料、消防证书 |
| 机房精密空调 | 品牌、上下水、加湿、漏水报警、监控接入 |
| 冷库/冷链 | 库板、机组、膨胀阀调试、化霜、防潮 |

17. 通用技术能力　18. 设备配置　19. 业绩与商务条件　20. 自评与承诺

---

# 部署（Cloudflare 控制台 + GitHub，全程不用装任何东西）

整体顺序：**代码传到 GitHub → Cloudflare 连仓库 → 建 D1 和 R2 并绑定 → 设口令**。

## 第 1 步：把代码传到 GitHub

1. 打开 https://github.com/new ，Repository name 填 `hvac-survey`，选 Private，**不要勾选** Add a README，点 Create repository。
2. 在本机进入 `survey` 目录执行（Git Bash 里跑）：

```bash
cd /c/Users/yuyan/WorkBuddy/2026-09-26-15-17-59/survey
git init
git add .
git commit -m "问卷系统初始版本"
git branch -M main
git remote add origin https://github.com/<你的GitHub用户名>/hvac-survey.git
git push -u origin main
```

> 如果 push 时要求登录，GitHub 已不支持密码登录，需用 Personal Access Token：
> GitHub 右上角头像 → Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token，勾选 `repo`，生成后复制，push 时用户名填你的 GitHub 账号、密码粘贴这个 token。

## 第 2 步：建 D1 数据库（存答卷）

1. Cloudflare 控制台 → 左侧 `Storage & Databases` → `D1 SQL Database` → Create
2. Name 填 `survey-db` → Create
3. 进到 `survey-db` → 点 `Console` 标签 → 把 `schema.sql` 里的全部内容粘进输入框 → 点 Execute（或 Run）

建表语句就是这段：

```sql
CREATE TABLE IF NOT EXISTS submissions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  form       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  name       TEXT,
  phone      TEXT,
  payload    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_submissions_form_time ON submissions (form, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_submissions_created ON submissions (created_at DESC);
```

## 第 3 步：建 R2 存储桶（存身份证照片）

1. 控制台 → `Storage & Databases` → `R2 Object Storage` → Create bucket
2. Name 填 `survey-idcards` → Create bucket
3. 不用开公开访问，照片通过带口令的接口读取

## 第 4 步：Cloudflare Pages 连接 GitHub

1. 控制台 → 左侧 `Workers & Pages` → Create → 切到 `Pages` 标签 → `Connect to Git`
2. 选 GitHub → 授权 → 选中 `hvac-survey` 仓库 → Begin setup
3. 构建配置按下表填：

| 项目 | 填什么 |
|---|---|
| Project name | `hvac-survey` |
| Production branch | `main` |
| Framework preset | **None** |
| Build command | **留空** |
| Build output directory | **`public`** |
| Root directory | 留空（不要填 `/`，仓库根目录即可） |

4. 点 Save and Deploy，等 1 分钟左右完成，会得到域名 `https://hvac-survey.pages.dev`。

> 注意：Build output directory 必须是 `public`，否则 `/api/*` 接口不会被部署，提交会报 404。

## 第 5 步：绑定数据库与存储

进项目 → `Settings` → `Functions` 区域：

1. **D1 database bindings** → Add：Variable name 填 **`DB`**，D1 Database 选 `survey-db`
2. **R2 bucket bindings** → Add：Variable name 填 **`IDCARDS`**，R2 Bucket 选 `survey-idcards`
3. 同页 `Environment variables` → Add：Variable name 填 **`ADMIN_TOKEN`**，Value 填你自己的查看口令（别用默认的 `change-me-2026`）

> 三个名字 `DB` / `IDCARDS` / `ADMIN_TOKEN` 必须分毫不差，代码里是写死的。
> 改完绑定要点一次 **Redeploy**（Deployments → 最新一次 → Retry deployment / Redeploy）才会生效。

## 第 6 步：验收

1. 打开 `https://hvac-survey.pages.dev` → 填一份测试答卷并提交，应显示"提交成功 + 编号"
2. 打开 `https://hvac-survey.pages.dev/admin.html` → 输入 `ADMIN_TOKEN` → 应能看到刚才那条、能点开详情、能看到身份证照片
3. 点"导出 CSV"和"导出 JSON"各试一次

---

## 备选：wrangler CLI（需要 npx 下载，适合你后面改代码后手动推）

```bash
npx wrangler login
npx wrangler d1 create survey-db            # 复制输出里的 database_id
npx wrangler r2 bucket create survey-idcards
# 把 database_id 填进 wrangler.toml，并改掉 ADMIN_TOKEN
npx wrangler d1 execute survey-db --file=./schema.sql --remote
npx wrangler pages deploy public --project-name=hvac-survey
```

## API Token（给我帮你部署时才需要）

- **Account ID**：控制台右侧栏，或 `Workers & Pages` 概览页右下角，32 位字符串
- **API Token**：右上角头像 → `My Profile` → `API Tokens` → Create Custom Token
  - Permissions：`Account - Cloudflare Pages - Edit`、`Account - D1 - Edit`、`Account - R2 - Edit`
  - Account Resources：`Include - 你的账号`
  - 创建后只显示一次，立刻复制

---

## 数据存储说明

- **答卷文本** → D1 表 `submissions`，`payload` 字段存完整 JSON，关键字段（姓名、电话、时间）单独成列便于列表查询
- **身份证照片** → R2，路径 `idcard/{编号}_{front|back}.jpg`
- 照片在前端先压缩（长边 ≤1600px，JPEG 0.82，约 100–300KB）再上传
- 提交顺序：**文本先入库拿到编号 → 再逐张传照片**。照片传失败不会丢已填内容，页面会提示编号让你补传
- 照片不公开，只有带 `ADMIN_TOKEN` 的 `/api/photo` 请求能读到

## 后台与导出

访问 `https://<你的域名>/admin.html`，输入 `ADMIN_TOKEN`：

- **列表**：编号、姓名/队伍、电话、提交时间
- **详情**：按题目分组展示全部答案，顶部显示身份证自动解析出的出生日期与年龄，下面是身份证正反面照片
- **导出 CSV**：带 BOM，Excel/WPS 直接打开不乱码，一行一份答卷、一列一题，适合直接筛人
- **导出 JSON**：完整原始结构（编号、提交时间、照片面别、以及每道题的原始答案），用于备份或导入其他系统

两种导出都只取最近 500 条。JSON 里 `data` 是原始字段值（数组即多选题的多个选项），CSV 里已把数组合并成顿号分隔的文本。

## 本地预览

```bash
cd public && python -m http.server 8000
# 打开 http://localhost:8000
```

本地预览下 `/api/*` 不存在，提交会报错，属正常现象；部署到 Cloudflare 后由 Functions 接管。
