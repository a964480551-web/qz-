const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const multer = require("multer");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");
const { parse } = require("csv-parse/sync");
const { DatabaseSync } = require("node:sqlite");

const app = express();
const port = Number(process.env.PORT || 3003);

const DATA_DIR = path.join(__dirname, "..", "data");
const UPLOAD_DIR = path.join(__dirname, "..", "uploads");
const DB_PATH = path.join(DATA_DIR, "model-platform.db");
const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_INIT_ACCOUNT = (process.env.ADMIN_INIT_ACCOUNT || "").trim();
const ADMIN_INIT_PASSWORD = process.env.ADMIN_INIT_PASSWORD || "";
const DESIGNER_DEFAULT_TOTAL_QUOTA = 30;

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error("JWT_SECRET 必须通过环境变量提供，且长度不能少于 32 个字符。");
}

for (const dir of [DATA_DIR, UPLOAD_DIR]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

const db = new DatabaseSync(DB_PATH);

function now() {
  return new Date().toISOString();
}

async function run(sql, params = []) {
  const result = db.prepare(sql).run(...params);
  return {
    lastID: Number(result.lastInsertRowid),
    changes: Number(result.changes)
  };
}

async function get(sql, params = []) {
  return db.prepare(sql).get(...params) || null;
}

async function all(sql, params = []) {
  return db.prepare(sql).all(...params);
}

function logError(context, error) {
  // 后台排查用：前台继续返回简短提示，真实错误写入服务端日志。
  // eslint-disable-next-line no-console
  console.error(`[${now()}] ${context}`, error);
}

function deleteUploadFile(uploadPath) {
  const safeUploadPath = normalizeText(uploadPath);
  if (!safeUploadPath.startsWith("/uploads/")) return false;

  const filename = path.basename(safeUploadPath);
  if (!filename || filename !== safeUploadPath.replace("/uploads/", "")) return false;

  const fullPath = path.join(UPLOAD_DIR, filename);
  if (!fullPath.startsWith(UPLOAD_DIR)) return false;
  if (!fs.existsSync(fullPath)) return false;

  fs.unlinkSync(fullPath);
  return true;
}

function deleteUploadFiles(uploadPaths, context) {
  const uniquePaths = [...new Set(uploadPaths.filter(Boolean))];
  for (const uploadPath of uniquePaths) {
    try {
      deleteUploadFile(uploadPath);
    } catch (error) {
      logError(`${context}：删除上传文件失败 ${uploadPath}`, error);
    }
  }
}

function deleteUploadedRequestFile(file, context) {
  if (!file?.filename) return;
  deleteUploadFiles([`/uploads/${file.filename}`], context);
}

async function initDb() {
  await run(`
    CREATE TABLE IF NOT EXISTS materials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account TEXT NOT NULL,
      material_id TEXT NOT NULL,
      image_path TEXT NOT NULL,
      requirement TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT '待处理',
      is_urgent INTEGER NOT NULL DEFAULT 0,
      material_code TEXT,
      tech_notes TEXT,
      tech_note_image_path TEXT,
      producer TEXT,
      completed_at TEXT,
      reject_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  await run(`ALTER TABLE materials ADD COLUMN is_urgent INTEGER NOT NULL DEFAULT 0`).catch(() => {});
  await run(`ALTER TABLE materials ADD COLUMN tech_note_image_path TEXT`).catch(() => {});

  await run(`
    CREATE TABLE IF NOT EXISTS accounts (
      account TEXT PRIMARY KEY,
      owner_name TEXT NOT NULL DEFAULT '',
      used_count INTEGER NOT NULL DEFAULT 0,
      total_quota INTEGER NOT NULL DEFAULT 30,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  await run(`ALTER TABLE accounts ADD COLUMN owner_name TEXT NOT NULL DEFAULT ''`).catch(() => {});
  await run(`ALTER TABLE accounts ADD COLUMN total_quota INTEGER NOT NULL DEFAULT 30`).catch(() => {});
  await run("UPDATE accounts SET owner_name = account, updated_at = ? WHERE owner_name = '' OR owner_name IS NULL", [
    now()
  ]).catch(() => {});
  await run("UPDATE accounts SET total_quota = ? WHERE total_quota IS NULL OR total_quota <= 0", [
    DESIGNER_DEFAULT_TOTAL_QUOTA
  ]).catch(() => {});

  await run(`
    CREATE TABLE IF NOT EXISTS staff (
      account TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  const staffColumns = await all("PRAGMA table_info(staff)");
  if (staffColumns.some((column) => column.name === "password_plain")) {
    await run("UPDATE staff SET password_plain = ''");
  }

  await run(`
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      material_record_id INTEGER NOT NULL,
      author TEXT NOT NULL,
      author_role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(material_record_id) REFERENCES materials(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS comment_reads (
      material_record_id INTEGER NOT NULL,
      admin_account TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      PRIMARY KEY(material_record_id, admin_account)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS announcements (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      title TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    )
  `);

  await run(
    "INSERT OR IGNORE INTO announcements(id, title, content, enabled, updated_at) VALUES(1, '', '', 0, ?)",
    [now()]
  );

  await run("CREATE INDEX IF NOT EXISTS idx_materials_created_at ON materials(created_at)");
  await run("CREATE INDEX IF NOT EXISTS idx_materials_account ON materials(account)");
  await run("CREATE INDEX IF NOT EXISTS idx_materials_material_id ON materials(material_id)");
  await run("CREATE INDEX IF NOT EXISTS idx_accounts_created_at ON accounts(created_at)");
  await run("CREATE INDEX IF NOT EXISTS idx_accounts_account ON accounts(account)");
  await run("CREATE INDEX IF NOT EXISTS idx_accounts_owner_name ON accounts(owner_name)");
  await run("CREATE INDEX IF NOT EXISTS idx_comments_material_role_created ON comments(material_record_id, author_role, created_at)");
  await run("CREATE INDEX IF NOT EXISTS idx_comment_reads_admin ON comment_reads(admin_account)");

  const staffCount = await get("SELECT COUNT(*) AS total FROM staff");
  if (staffCount.total === 0) {
    if (!ADMIN_INIT_ACCOUNT || ADMIN_INIT_PASSWORD.length < 12) {
      throw new Error(
        "首次启动必须设置 ADMIN_INIT_ACCOUNT 和至少 12 位的 ADMIN_INIT_PASSWORD。"
      );
    }
    const ts = now();
    const hash = await bcrypt.hash(ADMIN_INIT_PASSWORD, 10);
    await run(
      "INSERT INTO staff(account, password_hash, created_at, updated_at) VALUES(?, ?, ?, ?)",
      [ADMIN_INIT_ACCOUNT, hash, ts, ts]
    );
    // eslint-disable-next-line no-console
    console.log(`初始管理员已创建：${ADMIN_INIT_ACCOUNT}`);
  }
}

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(
  cors({
    origin: (process.env.CORS_ORIGINS || "http://localhost:5173,http://localhost:5174")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    credentials: false
  })
);
app.use(express.json({ limit: "1mb" }));

const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false
});

const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false
});

function createToken(account) {
  return jwt.sign({ account, role: "admin" }, JWT_SECRET, { expiresIn: "8h" });
}

function getAuthToken(req) {
  const header = req.headers.authorization || "";
  const parts = header.split(" ");
  if (parts.length === 2 && parts[0] === "Bearer") {
    return parts[1];
  }
  return null;
}

function requireAdmin(req, res, next) {
  try {
    const token = getAuthToken(req);
    if (!token) {
      res.status(401).json({ message: "未登录或凭证缺失" });
      return;
    }
    const payload = jwt.verify(token, JWT_SECRET);
    req.admin = payload;
    next();
  } catch (_error) {
    res.status(401).json({ message: "登录态无效或已过期" });
  }
}

async function ensureDesignerAccountExists(account) {
  if (!account || typeof account !== "string") {
    return false;
  }
  const row = await get("SELECT account FROM accounts WHERE account = ?", [account.trim()]);
  return !!row;
}

async function ensureDesignerIdentity(account, ownerName) {
  const safeAccount = normalizeText(account);
  const safeName = normalizeText(ownerName);
  if (!safeAccount || !safeName) return false;
  const row = await get(
    "SELECT account FROM accounts WHERE account = ? AND owner_name = ?",
    [safeAccount, safeName]
  );
  return !!row;
}

async function getDesignerQuota(account) {
  const row = await get("SELECT used_count, total_quota FROM accounts WHERE account = ?", [account]);
  const used = row ? row.used_count : 0;
  const total = row ? row.total_quota : DESIGNER_DEFAULT_TOTAL_QUOTA;
  const remaining = Math.max(0, total - used);
  return {
    usedCount: used,
    totalQuota: total,
    remaining
  };
}

function sanitizeUploadFilename(originalname) {
  const ext = path.extname(originalname).toLowerCase();
  const random = crypto.randomBytes(8).toString("hex");
  return `${Date.now()}_${random}${ext}`;
}

const allowedMimes = new Set(["image/jpeg", "image/png", "image/webp"]);
const allowedExts = new Set([".jpg", ".jpeg", ".png", ".webp"]);

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => cb(null, sanitizeUploadFilename(file.originalname))
  }),
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 1
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowedMimes.has(file.mimetype) || !allowedExts.has(ext)) {
      cb(new Error("仅支持 jpg/jpeg/png/webp 图片"));
      return;
    }
    cb(null, true);
  }
});

function parseCsvBuffer(buffer) {
  return parse(buffer.toString("utf8"), {
    columns: true,
    skip_empty_lines: true,
    trim: true
  });
}

function normalizeText(input) {
  return typeof input === "string" ? input.trim() : "";
}

function parsePageParams(query) {
  const page = Math.max(1, Number.parseInt(query?.page, 10) || 1);
  const rawPageSize = Number.parseInt(query?.pageSize, 10) || 50;
  const pageSize = Math.min(100, Math.max(1, rawPageSize));
  return {
    page,
    pageSize,
    offset: (page - 1) * pageSize
  };
}

function buildSearchWhere(search, fields, existingClauses = [], existingParams = []) {
  const clauses = [...existingClauses];
  const params = [...existingParams];
  const keyword = normalizeText(search);
  if (keyword) {
    clauses.push(`(${fields.map((field) => `${field} LIKE ?`).join(" OR ")})`);
    for (const _field of fields) {
      params.push(`%${keyword}%`);
    }
  }
  return {
    where: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
    params
  };
}

function validateContentNotEmpty(content) {
  return normalizeText(content).length > 0;
}

function publicMaterial(record) {
  return {
    id: record.id,
    account: record.account,
    materialId: record.material_id,
    imagePath: record.image_path,
    requirement: record.requirement,
    name: record.name,
    status: record.status,
    isUrgent: Number(record.is_urgent || 0) === 1,
    materialCode: record.material_code || "",
    techNotes: record.tech_notes || "",
    techNoteImagePath: record.tech_note_image_path || "",
    producer: record.producer || "",
    rejectReason: record.reject_reason || "",
    createdAt: record.created_at,
    updatedAt: record.updated_at
  };
}

function publicAnnouncement(record) {
  return {
    title: record?.title || "",
    content: record?.content || "",
    enabled: Number(record?.enabled || 0) === 1,
    updatedAt: record?.updated_at || ""
  };
}

app.get("/api/announcement", async (_req, res) => {
  try {
    const row = await get("SELECT title, content, enabled, updated_at FROM announcements WHERE id = 1");
    const announcement = publicAnnouncement(row);
    if (!announcement.enabled || !announcement.content.trim()) {
      res.json({ title: "", content: "", enabled: false, updatedAt: announcement.updatedAt });
      return;
    }
    res.json(announcement);
  } catch (error) {
    logError("获取公告失败", error);
    res.status(500).json({ message: "获取公告失败" });
  }
});

app.get("/api/admin/announcement", requireAdmin, async (_req, res) => {
  try {
    const row = await get("SELECT title, content, enabled, updated_at FROM announcements WHERE id = 1");
    res.json(publicAnnouncement(row));
  } catch (error) {
    logError("获取公告配置失败", error);
    res.status(500).json({ message: "获取公告配置失败" });
  }
});

app.put("/api/admin/announcement", requireAdmin, writeLimiter, async (req, res) => {
  try {
    const title = normalizeText(req.body?.title).slice(0, 80);
    const content = normalizeText(req.body?.content).slice(0, 2000);
    const enabled = req.body?.enabled ? 1 : 0;
    const ts = now();
    await run(
      `
        INSERT INTO announcements(id, title, content, enabled, updated_at)
        VALUES(1, ?, ?, ?, ?)
        ON CONFLICT(id)
        DO UPDATE SET
          title = excluded.title,
          content = excluded.content,
          enabled = excluded.enabled,
          updated_at = excluded.updated_at
      `,
      [title, content, enabled, ts]
    );
    res.json({ success: true, title, content, enabled: enabled === 1, updatedAt: ts });
  } catch (error) {
    logError("保存公告失败", error);
    res.status(500).json({ message: "保存公告失败" });
  }
});

app.post("/api/check-account", loginLimiter, async (req, res) => {
  try {
    const account = normalizeText(req.body?.account);
    const ownerName = normalizeText(req.body?.ownerName);
    if (!account) {
      res.status(400).json({ exists: false, message: "账号不能为空" });
      return;
    }
    if (!ownerName) {
      res.status(400).json({ exists: false, message: "姓名不能为空" });
      return;
    }
    const exists = await ensureDesignerIdentity(account, ownerName);
    res.json({ exists });
  } catch (error) {
    logError("校验设计师账号失败", error);
    res.status(500).json({ exists: false, message: "校验失败" });
  }
});

app.get("/api/quota", async (req, res) => {
  try {
    const account = normalizeText(req.query?.account);
    const ownerName = normalizeText(req.query?.ownerName);
    const isAdminRequest = !!getAuthToken(req);

    if (isAdminRequest) {
      try {
        req.admin = jwt.verify(getAuthToken(req), JWT_SECRET);
      } catch (_error) {
        res.status(401).json({ message: "管理员登录态无效" });
        return;
      }
      if (!account) {
        res.status(400).json({ message: "管理员查询额度时必须传 account" });
        return;
      }
      const exists = await ensureDesignerAccountExists(account);
      if (!exists) {
        res.status(404).json({ message: "设计师账号不存在" });
        return;
      }
      const quota = await getDesignerQuota(account);
      res.json({ account, ...quota });
      return;
    }

    if (!account) {
      res.status(400).json({ message: "请提供设计师账号" });
      return;
    }
    const exists = await ensureDesignerIdentity(account, ownerName);
    if (!exists) {
      res.status(404).json({ message: "账号与姓名不匹配或不存在" });
      return;
    }
    const quota = await getDesignerQuota(account);
    res.json({ account, ...quota });
  } catch (error) {
    logError("查询额度失败", error);
    res.status(500).json({ message: "查询额度失败" });
  }
});

app.post("/api/staff-login", loginLimiter, async (req, res) => {
  try {
    const account = normalizeText(req.body?.account);
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!account || !password) {
      res.status(400).json({ message: "账号或密码不能为空" });
      return;
    }
    const staff = await get("SELECT * FROM staff WHERE account = ?", [account]);
    if (!staff) {
      res.status(401).json({ message: "账号或密码错误" });
      return;
    }
    const ok = await bcrypt.compare(password, staff.password_hash);
    if (!ok) {
      res.status(401).json({ message: "账号或密码错误" });
      return;
    }
    res.json({
      token: createToken(account),
      account
    });
  } catch (error) {
    logError("管理员登录失败", error);
    res.status(500).json({ message: "登录失败" });
  }
});

app.get("/api/staff", requireAdmin, async (_req, res) => {
  try {
    const rows = await all("SELECT account, created_at, updated_at FROM staff ORDER BY created_at DESC");
    res.json(rows);
  } catch (error) {
    logError("获取管理员失败", error);
    res.status(500).json({ message: "获取管理员失败" });
  }
});

app.post("/api/staff", requireAdmin, writeLimiter, async (req, res) => {
  try {
    const list = Array.isArray(req.body?.items) ? req.body.items : [];
    if (list.length === 0) {
      res.status(400).json({ message: "请提交管理员数据" });
      return;
    }
    let added = 0;
    let skipped = 0;
    const failed = [];
    for (const item of list) {
      const account = normalizeText(item?.account);
      const password = typeof item?.password === "string" ? item.password : "";
      if (!account || !password) {
        failed.push({ account, reason: "缺少账号或密码" });
        continue;
      }
      const exists = await get("SELECT account FROM staff WHERE account = ?", [account]);
      if (exists) {
        skipped += 1;
        continue;
      }
      const ts = now();
      const hash = await bcrypt.hash(password, 10);
      await run(
        "INSERT INTO staff(account, password_hash, created_at, updated_at) VALUES(?, ?, ?, ?)",
        [account, hash, ts, ts]
      );
      added += 1;
    }
    res.json({ added, skipped, failed });
  } catch (error) {
    logError("添加管理员失败", error);
    res.status(500).json({ message: "添加管理员失败" });
  }
});

const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== ".csv") {
      cb(new Error("仅支持 CSV 文件"));
      return;
    }
    cb(null, true);
  }
});

app.post("/api/staff/import-csv", requireAdmin, writeLimiter, csvUpload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ message: "未上传 CSV 文件" });
      return;
    }
    const rows = parseCsvBuffer(req.file.buffer);
    let added = 0;
    let skipped = 0;
    const failed = [];
    for (const row of rows) {
      const account = normalizeText(row.account);
      const password = typeof row.password === "string" ? row.password : "";
      if (!account || !password) {
        failed.push({ account: account || "", reason: "缺少 account 或 password 字段" });
        continue;
      }
      const exists = await get("SELECT account FROM staff WHERE account = ?", [account]);
      if (exists) {
        skipped += 1;
        continue;
      }
      const ts = now();
      const hash = await bcrypt.hash(password, 10);
      await run(
        "INSERT INTO staff(account, password_hash, created_at, updated_at) VALUES(?, ?, ?, ?)",
        [account, hash, ts, ts]
      );
      added += 1;
    }
    res.json({ added, skipped, failed });
  } catch (error) {
    logError("导入管理员 CSV 失败", error);
    res.status(500).json({ message: "导入管理员 CSV 失败" });
  }
});

app.put("/api/staff/:account/password", requireAdmin, writeLimiter, async (req, res) => {
  try {
    const account = normalizeText(req.params.account);
    const password = typeof req.body?.password === "string" ? req.body.password.trim() : "";
    if (!account) {
      res.status(400).json({ message: "账号无效" });
      return;
    }
    if (!password) {
      res.status(400).json({ message: "请填写新密码" });
      return;
    }
    const staff = await get("SELECT account FROM staff WHERE account = ?", [account]);
    if (!staff) {
      res.status(404).json({ message: "管理员账号不存在" });
      return;
    }
    const ts = now();
    const hash = await bcrypt.hash(password, 10);
    await run("UPDATE staff SET password_hash = ?, updated_at = ? WHERE account = ?", [
      hash,
      ts,
      account
    ]);
    res.json({ success: true });
  } catch (error) {
    logError("修改管理员密码失败", error);
    res.status(500).json({ message: "修改管理员密码失败" });
  }
});

app.delete("/api/staff/:account", requireAdmin, writeLimiter, async (req, res) => {
  try {
    const account = normalizeText(req.params.account);
    if (!account) {
      res.status(400).json({ message: "账号无效" });
      return;
    }
    await run("DELETE FROM staff WHERE account = ?", [account]);
    res.json({ success: true });
  } catch (error) {
    logError("删除管理员失败", error);
    res.status(500).json({ message: "删除管理员失败" });
  }
});

app.get("/api/accounts", requireAdmin, async (req, res) => {
  try {
    const { page, pageSize, offset } = parsePageParams(req.query);
    const { where, params } = buildSearchWhere(req.query?.search, ["account", "owner_name"]);
    const totalRow = await get(`SELECT COUNT(*) AS total FROM accounts ${where}`, params);
    const rows = await all(
      `
        SELECT account, owner_name, used_count, total_quota, created_at, updated_at
        FROM accounts
        ${where}
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
      `,
      [...params, pageSize, offset]
    );
    const total = totalRow?.total || 0;
    res.json({
      items: rows,
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize))
    });
  } catch (error) {
    logError("获取设计师账号失败", error);
    res.status(500).json({ message: "获取设计师账号失败" });
  }
});

app.post("/api/accounts", requireAdmin, writeLimiter, async (req, res) => {
  try {
    const list = Array.isArray(req.body?.items) ? req.body.items : [];
    if (list.length === 0) {
      res.status(400).json({ message: "请提交账号列表" });
      return;
    }
    let added = 0;
    let skipped = 0;
    const failed = [];
    for (const item of list) {
      const account = normalizeText(item?.account || item);
      const ownerName = normalizeText(item?.ownerName || "");
      if (!account) {
        failed.push({ account: "", reason: "账号为空" });
        continue;
      }
      if (!ownerName) {
        failed.push({ account, reason: "姓名为空" });
        continue;
      }
      const exists = await get("SELECT account FROM accounts WHERE account = ?", [account]);
      if (exists) {
        skipped += 1;
        continue;
      }
      const ts = now();
      await run(
        "INSERT INTO accounts(account, owner_name, used_count, total_quota, created_at, updated_at) VALUES(?, ?, 0, ?, ?, ?)",
        [account, ownerName, DESIGNER_DEFAULT_TOTAL_QUOTA, ts, ts]
      );
      added += 1;
    }
    res.json({ added, skipped, failed });
  } catch (error) {
    logError("添加设计师账号失败", error);
    res.status(500).json({ message: "添加设计师账号失败" });
  }
});

app.post("/api/accounts/import-csv", requireAdmin, writeLimiter, csvUpload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ message: "未上传 CSV 文件" });
      return;
    }
    const rows = parseCsvBuffer(req.file.buffer);
    let added = 0;
    let skipped = 0;
    const failed = [];
    for (const row of rows) {
      const account = normalizeText(row.account);
      const ownerName = normalizeText(row.owner_name || row.name || row.ownerName || "");
      if (!account) {
        failed.push({ account: "", reason: "缺少 account 字段" });
        continue;
      }
      if (!ownerName) {
        failed.push({ account, reason: "缺少 owner_name 字段" });
        continue;
      }
      const exists = await get("SELECT account FROM accounts WHERE account = ?", [account]);
      if (exists) {
        skipped += 1;
        continue;
      }
      const ts = now();
      await run(
        "INSERT INTO accounts(account, owner_name, used_count, total_quota, created_at, updated_at) VALUES(?, ?, 0, ?, ?, ?)",
        [account, ownerName, DESIGNER_DEFAULT_TOTAL_QUOTA, ts, ts]
      );
      added += 1;
    }
    res.json({ added, skipped, failed });
  } catch (error) {
    logError("导入设计师 CSV 失败", error);
    res.status(500).json({ message: "导入设计师 CSV 失败" });
  }
});

app.put("/api/accounts/quota/reset-all", requireAdmin, writeLimiter, async (_req, res) => {
  try {
    const ts = now();
    const result = await run("UPDATE accounts SET used_count = 0, updated_at = ?", [ts]);
    res.json({ success: true, changed: result.changes || 0 });
  } catch (error) {
    logError("重置所有人额度失败", error);
    res.status(500).json({ message: "重置所有人额度失败" });
  }
});

app.put("/api/accounts/:account/quota/add", requireAdmin, writeLimiter, async (req, res) => {
  try {
    const account = normalizeText(req.params.account);
    const amount = Math.max(1, Number(req.body?.amount || 1));
    if (!account) {
      res.status(400).json({ message: "账号无效" });
      return;
    }
    const row = await get("SELECT account, used_count, total_quota FROM accounts WHERE account = ?", [account]);
    if (!row) {
      res.status(404).json({ message: "设计师账号不存在" });
      return;
    }
    const ts = now();
    const nextTotalQuota = row.total_quota + amount;
    await run("UPDATE accounts SET total_quota = ?, updated_at = ? WHERE account = ?", [
      nextTotalQuota,
      ts,
      account
    ]);
    res.json({
      success: true,
      account,
      totalQuota: nextTotalQuota,
      usedCount: row.used_count,
      remaining: Math.max(0, nextTotalQuota - row.used_count)
    });
  } catch (error) {
    logError("增加额度失败", error);
    res.status(500).json({ message: "增加额度失败" });
  }
});

app.put("/api/accounts/:account/quota/set", requireAdmin, writeLimiter, async (req, res) => {
  try {
    const account = normalizeText(req.params.account);
    const totalQuota = Number(req.body?.totalQuota);
    if (!account) {
      res.status(400).json({ message: "账号无效" });
      return;
    }
    if (!Number.isFinite(totalQuota) || totalQuota < 0) {
      res.status(400).json({ message: "请填写有效的初始额度" });
      return;
    }
    const row = await get("SELECT account, used_count FROM accounts WHERE account = ?", [account]);
    if (!row) {
      res.status(404).json({ message: "设计师账号不存在" });
      return;
    }
    const ts = now();
    await run("UPDATE accounts SET total_quota = ?, updated_at = ? WHERE account = ?", [
      Math.floor(totalQuota),
      ts,
      account
    ]);
    res.json({
      success: true,
      account,
      totalQuota: Math.floor(totalQuota),
      usedCount: row.used_count,
      remaining: Math.max(0, Math.floor(totalQuota) - row.used_count)
    });
  } catch (error) {
    logError("设置初始额度失败", error);
    res.status(500).json({ message: "设置初始额度失败" });
  }
});

app.put("/api/accounts/:account/quota/reset", requireAdmin, writeLimiter, async (req, res) => {
  try {
    const account = normalizeText(req.params.account);
    if (!account) {
      res.status(400).json({ message: "账号无效" });
      return;
    }
    const row = await get("SELECT account, total_quota FROM accounts WHERE account = ?", [account]);
    if (!row) {
      res.status(404).json({ message: "设计师账号不存在" });
      return;
    }
    const ts = now();
    await run("UPDATE accounts SET used_count = 0, updated_at = ? WHERE account = ?", [ts, account]);
    res.json({
      success: true,
      account,
      totalQuota: row.total_quota,
      usedCount: 0,
      remaining: row.total_quota
    });
  } catch (error) {
    logError("重置额度失败", error);
    res.status(500).json({ message: "重置额度失败" });
  }
});

app.delete("/api/accounts/:account", requireAdmin, writeLimiter, async (req, res) => {
  try {
    const account = normalizeText(req.params.account);
    if (!account) {
      res.status(400).json({ message: "账号无效" });
      return;
    }
    const materialCount = await get("SELECT COUNT(*) AS total FROM materials WHERE account = ?", [account]);
    if ((materialCount?.total || 0) > 0) {
      res.status(400).json({ message: "该设计师已有历史任务，不能直接删除账号，避免历史记录失联" });
      return;
    }
    await run("DELETE FROM accounts WHERE account = ?", [account]);
    res.json({ success: true });
  } catch (error) {
    logError("删除设计师账号失败", error);
    res.status(500).json({ message: "删除设计师账号失败" });
  }
});

app.get("/api/materials", async (req, res) => {
  try {
    const account = normalizeText(req.query?.account);
    const ownerName = normalizeText(req.query?.ownerName);
    const token = getAuthToken(req);
    if (token) {
      let adminAccount = "";
      try {
        const payload = jwt.verify(token, JWT_SECRET);
        adminAccount = payload.account;
      } catch (_error) {
        res.status(401).json({ message: "管理员登录态无效" });
        return;
      }
      const { page, pageSize, offset } = parsePageParams(req.query);
      const { where, params } = buildSearchWhere(req.query?.search, [
        "materials.account",
        "materials.material_id",
        "materials.name",
        "materials.status"
      ]);
      const totalRow = await get(`SELECT COUNT(*) AS total FROM materials ${where}`, params);
      const rows = await all(
        `
          SELECT
            materials.*,
            COUNT(CASE
              WHEN comments.author_role = 'designer'
                AND (comment_reads.last_seen_at IS NULL OR comments.created_at > comment_reads.last_seen_at)
              THEN 1
            END) AS unread_count
          FROM materials
          LEFT JOIN comments ON comments.material_record_id = materials.id
          LEFT JOIN comment_reads
            ON comment_reads.material_record_id = materials.id
            AND comment_reads.admin_account = ?
          ${where}
          GROUP BY materials.id
          ORDER BY materials.created_at DESC
          LIMIT ? OFFSET ?
        `,
        [adminAccount, ...params, pageSize, offset]
      );
      const total = totalRow?.total || 0;
      res.json({
        items: rows.map((row) => ({
          ...publicMaterial(row),
          unreadCount: row.unread_count || 0
        })),
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize))
      });
      return;
    }

    if (!account) {
      res.status(400).json({ message: "请提供设计师账号" });
      return;
    }
    const exists = await ensureDesignerIdentity(account, ownerName);
    if (!exists) {
      res.status(404).json({ message: "账号与姓名不匹配或不存在" });
      return;
    }
    const rows = await all("SELECT * FROM materials WHERE account = ? ORDER BY created_at DESC", [account]);
    res.json(rows.map(publicMaterial));
  } catch (error) {
    logError("获取任务记录失败", error);
    res.status(500).json({ message: "获取记录失败" });
  }
});

app.get("/api/materials/board", async (req, res) => {
  try {
    const account = normalizeText(req.query?.account);
    const ownerName = normalizeText(req.query?.ownerName);
    if (!account) {
      res.status(400).json({ message: "请提供设计师账号" });
      return;
    }
    const exists = await ensureDesignerIdentity(account, ownerName);
    if (!exists) {
      res.status(404).json({ message: "账号与姓名不匹配或不存在" });
      return;
    }
    const rows = await all(
      `
        SELECT *
        FROM materials
        ORDER BY
          CASE status
            WHEN '待处理' THEN 1
            WHEN '制作中' THEN 2
            WHEN '已完成' THEN 3
            WHEN '已拒绝' THEN 4
            ELSE 5
          END,
          created_at DESC
      `
    );
    res.json(rows.map(publicMaterial));
  } catch (error) {
    logError("获取排队任务失败", error);
    res.status(500).json({ message: "获取排队记录失败" });
  }
});

app.post("/api/materials", writeLimiter, upload.single("image"), async (req, res) => {
  let materialSaved = false;
  try {
    const account = normalizeText(req.body?.account);
    const ownerName = normalizeText(req.body?.ownerName);
    const materialId = normalizeText(req.body?.materialId);
    const rawName = normalizeText(req.body?.name);
    const requirement = normalizeText(req.body?.requirement);
    const name = rawName || requirement;
    const isUrgent = String(req.body?.isUrgent || "").toLowerCase() === "true";
    const consumeCount = isUrgent ? 5 : 1;
    if (!account) {
      deleteUploadedRequestFile(req.file, "提交任务账号为空后清理主图");
      res.status(400).json({ message: "账号不能为空" });
      return;
    }
    const exists = await ensureDesignerIdentity(account, ownerName);
    if (!exists) {
      deleteUploadedRequestFile(req.file, "提交任务账号校验失败后清理主图");
      res.status(404).json({ message: "账号与姓名不匹配或不存在，请联系管理员确认" });
      return;
    }
    if (!materialId || !requirement) {
      deleteUploadedRequestFile(req.file, "提交任务资料不完整后清理主图");
      res.status(400).json({ message: "素材 ID 和需求不能为空" });
      return;
    }
    if (!req.file) {
      res.status(400).json({ message: "请上传 1 张图片" });
      return;
    }

    const quota = await getDesignerQuota(account);
    if (quota.usedCount + consumeCount > quota.totalQuota) {
      deleteUploadedRequestFile(req.file, "提交任务额度不足后清理主图");
      res.status(400).json({
        message: isUrgent ? "剩余额度不足，无法加急登记" : "额度已用完"
      });
      return;
    }

    const ts = now();
    const relativeImagePath = `/uploads/${req.file.filename}`;
    await run("BEGIN IMMEDIATE TRANSACTION");
    try {
      const quotaUpdate = await run(
        `
          UPDATE accounts
          SET used_count = used_count + ?, updated_at = ?
          WHERE account = ? AND used_count + ? <= total_quota
        `,
        [consumeCount, ts, account, consumeCount]
      );
      if ((quotaUpdate.changes || 0) === 0) {
        await run("ROLLBACK");
        deleteUploadedRequestFile(req.file, "提交任务事务额度不足后清理主图");
        res.status(400).json({
          message: isUrgent ? "剩余额度不足，无法加急登记" : "额度已用完"
        });
        return;
      }
      await run(
        `
          INSERT INTO materials(
            account, material_id, image_path, requirement, name, status, is_urgent,
            material_code, tech_notes, tech_note_image_path, producer, completed_at, reject_reason,
            created_at, updated_at
          )
          VALUES(?, ?, ?, ?, ?, '待处理', ?, '', '', '', '', '', '', ?, ?)
        `,
        [account, materialId, relativeImagePath, requirement, name, isUrgent ? 1 : 0, ts, ts]
      );
      await run("COMMIT");
      materialSaved = true;
    } catch (error) {
      await run("ROLLBACK");
      deleteUploadedRequestFile(req.file, "提交任务写入失败后清理主图");
      throw error;
    }
    res.json({ success: true });
  } catch (error) {
    if (error instanceof multer.MulterError) {
      if (error.code === "LIMIT_FILE_SIZE") {
        res.status(400).json({ message: "请压缩到 5 MB 内，支持 jpg/png/webp" });
        return;
      }
      if (error.code === "LIMIT_FILE_COUNT") {
        res.status(400).json({ message: "单次仅允许上传 1 张图片" });
        return;
      }
    }
    if (!materialSaved) {
      deleteUploadedRequestFile(req.file, "提交任务异常后清理主图");
    }
    logError("提交任务失败", error);
    res.status(500).json({ message: "提交失败" });
  }
});

app.put("/api/materials/:id/accept", requireAdmin, writeLimiter, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ message: "任务 ID 无效" });
      return;
    }
    const row = await get("SELECT * FROM materials WHERE id = ?", [id]);
    if (!row) {
      res.status(404).json({ message: "任务不存在" });
      return;
    }
    if (row.status !== "待处理" && row.status !== "已拒绝") {
      res.status(400).json({ message: "仅待处理或已拒绝任务可以接受" });
      return;
    }
    const ts = now();
    const consumeCount = Number(row.is_urgent || 0) === 1 ? 5 : 1;
    await run("BEGIN IMMEDIATE TRANSACTION");
    try {
      if (row.status === "已拒绝") {
        const quotaUpdate = await run(
          `
            UPDATE accounts
            SET used_count = used_count + ?, updated_at = ?
            WHERE account = ? AND used_count + ? <= total_quota
          `,
          [consumeCount, ts, row.account, consumeCount]
        );
        if ((quotaUpdate.changes || 0) === 0) {
          await run("ROLLBACK");
          res.status(400).json({ message: "该账号剩余额度不足，无法重新接受任务" });
          return;
        }
      }
      await run(
        "UPDATE materials SET status = '制作中', reject_reason = '', producer = ?, updated_at = ? WHERE id = ?",
        [req.admin.account, ts, id]
      );
      await run("COMMIT");
    } catch (error) {
      await run("ROLLBACK");
      throw error;
    }
    res.json({ success: true });
  } catch (error) {
    logError("接受任务失败", error);
    res.status(500).json({ message: "接受任务失败" });
  }
});

app.put("/api/materials/:id/reject", requireAdmin, writeLimiter, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const reason = normalizeText(req.body?.reason);
    if (!Number.isFinite(id)) {
      res.status(400).json({ message: "任务 ID 无效" });
      return;
    }
    if (!reason) {
      res.status(400).json({ message: "请填写拒绝理由" });
      return;
    }
    const row = await get("SELECT * FROM materials WHERE id = ?", [id]);
    if (!row) {
      res.status(404).json({ message: "任务不存在" });
      return;
    }
    if (row.status !== "待处理" && row.status !== "制作中") {
      res.status(400).json({ message: "仅待处理或制作中任务可拒绝" });
      return;
    }
    const ts = now();
    const refundCount = Number(row.is_urgent || 0) === 1 ? 5 : 1;
    await run("BEGIN IMMEDIATE TRANSACTION");
    try {
      await run(
        "UPDATE materials SET status = '已拒绝', reject_reason = ?, producer = ?, updated_at = ? WHERE id = ?",
        [reason, req.admin.account, ts, id]
      );
      await run(
        "UPDATE accounts SET used_count = MAX(0, used_count - ?), updated_at = ? WHERE account = ?",
        [refundCount, ts, row.account]
      );
      await run("COMMIT");
    } catch (error) {
      await run("ROLLBACK");
      throw error;
    }
    res.json({ success: true, refunded: refundCount });
  } catch (error) {
    logError("拒绝任务失败", error);
    res.status(500).json({ message: "拒绝任务失败" });
  }
});

app.put("/api/materials/:id", requireAdmin, writeLimiter, upload.single("techNoteImage"), async (req, res) => {
  let taskSaved = false;
  try {
    const id = Number(req.params.id);
    const materialCode = normalizeText(req.body?.materialCode);
    const techNotes = normalizeText(req.body?.techNotes);
    const removeTechNoteImage = String(req.body?.removeTechNoteImage || "").toLowerCase() === "true";
    if (!Number.isFinite(id)) {
      deleteUploadedRequestFile(req.file, "保存任务 ID 无效后清理新备注图");
      res.status(400).json({ message: "任务 ID 无效" });
      return;
    }
    const row = await get("SELECT * FROM materials WHERE id = ?", [id]);
    if (!row) {
      deleteUploadedRequestFile(req.file, `保存任务 ${id} 不存在后清理新备注图`);
      res.status(404).json({ message: "任务不存在" });
      return;
    }
    if (row.status !== "制作中" && row.status !== "已完成") {
      deleteUploadedRequestFile(req.file, `保存任务 ${id} 状态不可编辑后清理新备注图`);
      res.status(400).json({ message: "仅制作中或已完成任务可编辑" });
      return;
    }
    const ts = now();
    let techNoteImagePath = row.tech_note_image_path || "";
    const oldTechNoteImagePath = row.tech_note_image_path || "";
    if (req.file) {
      techNoteImagePath = `/uploads/${req.file.filename}`;
    } else if (removeTechNoteImage) {
      techNoteImagePath = "";
    }

    try {
      if (row.status === "制作中") {
        await run(
          `
            UPDATE materials
            SET status = '已完成', material_code = ?, tech_notes = ?, tech_note_image_path = ?, updated_at = ?
            WHERE id = ?
          `,
          [materialCode, techNotes, techNoteImagePath, ts, id]
        );
      } else {
        await run(
          "UPDATE materials SET material_code = ?, tech_notes = ?, tech_note_image_path = ?, updated_at = ? WHERE id = ?",
          [materialCode, techNotes, techNoteImagePath, ts, id]
        );
      }
      taskSaved = true;
    } catch (error) {
      deleteUploadedRequestFile(req.file, `保存任务 ${id} 失败后清理新备注图`);
      throw error;
    }

    if (oldTechNoteImagePath && oldTechNoteImagePath !== techNoteImagePath) {
      deleteUploadFiles([oldTechNoteImagePath], `更新任务 ${id} 后清理旧备注图`);
    }
    res.json({ success: true });
  } catch (error) {
    if (!taskSaved) {
      deleteUploadedRequestFile(req.file, "保存任务异常后清理新备注图");
    }
    logError("保存任务失败", error);
    res.status(500).json({ message: "保存任务失败" });
  }
});

app.delete("/api/materials/:id", requireAdmin, writeLimiter, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ message: "任务 ID 无效" });
      return;
    }
    const row = await get("SELECT * FROM materials WHERE id = ?", [id]);
    if (!row) {
      res.status(404).json({ message: "任务不存在" });
      return;
    }
    await run("DELETE FROM comments WHERE material_record_id = ?", [id]);
    await run("DELETE FROM comment_reads WHERE material_record_id = ?", [id]);
    await run("DELETE FROM materials WHERE id = ?", [id]);
    deleteUploadFiles([row.image_path, row.tech_note_image_path], `删除任务 ${id}`);
    res.json({ success: true });
  } catch (error) {
    logError("删除任务失败", error);
    res.status(500).json({ message: "删除任务失败" });
  }
});

app.get("/api/materials/:id/comments", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ message: "任务 ID 无效" });
      return;
    }
    const material = await get("SELECT * FROM materials WHERE id = ?", [id]);
    if (!material) {
      res.status(404).json({ message: "任务不存在" });
      return;
    }
    const token = getAuthToken(req);
    let adminAccount = "";
    if (token) {
      try {
        const payload = jwt.verify(token, JWT_SECRET);
        adminAccount = payload.account;
      } catch (_error) {
        res.status(401).json({ message: "管理员登录态无效" });
        return;
      }
    } else {
      const account = normalizeText(req.query?.account);
      if (!account) {
        res.status(400).json({ message: "请提供设计师账号" });
        return;
      }
      const ownerName = normalizeText(req.query?.ownerName);
      const exists = await ensureDesignerIdentity(account, ownerName);
      if (!exists) {
        res.status(404).json({ message: "账号与姓名不匹配或不存在" });
        return;
      }
      if (material.account !== account) {
        res.status(403).json({ message: "无权查看该任务留言" });
        return;
      }
    }
    const rows = await all(
      "SELECT id, author, author_role, content, created_at FROM comments WHERE material_record_id = ? ORDER BY created_at ASC",
      [id]
    );
    if (adminAccount) {
      await run(
        `
          INSERT INTO comment_reads(material_record_id, admin_account, last_seen_at)
          VALUES(?, ?, ?)
          ON CONFLICT(material_record_id, admin_account)
          DO UPDATE SET last_seen_at = excluded.last_seen_at
        `,
        [id, adminAccount, now()]
      );
    }
    res.json(rows);
  } catch (error) {
    logError("获取留言失败", error);
    res.status(500).json({ message: "获取留言失败" });
  }
});

app.post("/api/materials/:id/comments", writeLimiter, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ message: "任务 ID 无效" });
      return;
    }
    const material = await get("SELECT * FROM materials WHERE id = ?", [id]);
    if (!material) {
      res.status(404).json({ message: "任务不存在" });
      return;
    }
    const content = normalizeText(req.body?.content);
    if (!validateContentNotEmpty(content)) {
      res.status(400).json({ message: "留言内容不能为空" });
      return;
    }

    const token = getAuthToken(req);
    let author = "";
    let role = "";
    if (token) {
      try {
        const payload = jwt.verify(token, JWT_SECRET);
        author = payload.account;
        role = "admin";
      } catch (_error) {
        res.status(401).json({ message: "管理员登录态无效" });
        return;
      }
    } else {
      const account = normalizeText(req.body?.account);
      const ownerName = normalizeText(req.body?.ownerName);
      if (!account) {
        res.status(400).json({ message: "请提供设计师账号" });
        return;
      }
      const exists = await ensureDesignerIdentity(account, ownerName);
      if (!exists) {
        res.status(404).json({ message: "账号与姓名不匹配或不存在" });
        return;
      }
      if (material.account !== account) {
        res.status(403).json({ message: "无权在该任务留言" });
        return;
      }
      author = account;
      role = "designer";
    }

    const ts = now();
    await run(
      "INSERT INTO comments(material_record_id, author, author_role, content, created_at) VALUES(?, ?, ?, ?, ?)",
      [id, author, role, content, ts]
    );
    res.json({ success: true });
  } catch (error) {
    logError("发送留言失败", error);
    res.status(500).json({ message: "发送留言失败" });
  }
});

app.get("/uploads/:filename", async (req, res) => {
  try {
    const filename = normalizeText(req.params.filename);
    if (!filename || filename.includes("/") || filename.includes("\\")) {
      res.status(400).json({ message: "文件名无效" });
      return;
    }
    const imagePath = `/uploads/${filename}`;
    const material = await get("SELECT * FROM materials WHERE image_path = ? OR tech_note_image_path = ?", [
      imagePath,
      imagePath
    ]);
    if (!material) {
      res.status(404).json({ message: "图片不存在" });
      return;
    }

    const token = getAuthToken(req);
    if (token) {
      try {
        jwt.verify(token, JWT_SECRET);
      } catch (_error) {
        res.status(401).json({ message: "管理员登录态无效" });
        return;
      }
    } else {
      const account = normalizeText(req.query?.account);
      const ownerName = normalizeText(req.query?.ownerName);
      if (!account) {
        res.status(400).json({ message: "请提供设计师账号" });
        return;
      }
      const exists = await ensureDesignerIdentity(account, ownerName);
      if (!exists) {
        res.status(404).json({ message: "账号与姓名不匹配或不存在" });
        return;
      }
      if (material.account !== account) {
        res.status(403).json({ message: "无权访问该图片" });
        return;
      }
    }

    const fullPath = path.join(UPLOAD_DIR, filename);
    if (!fs.existsSync(fullPath)) {
      res.status(404).json({ message: "图片文件不存在" });
      return;
    }
    res.sendFile(fullPath);
  } catch (error) {
    logError("读取图片失败", error);
    res.status(500).json({ message: "读取图片失败" });
  }
});

app.use((error, req, res, _next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      if (req.path.includes("import-csv")) {
        res.status(400).json({ message: "CSV 文件不能超过 2 MB" });
        return;
      }
      res.status(400).json({ message: "请压缩到 5 MB 内，支持 jpg/png/webp" });
      return;
    }
  }
  res.status(400).json({ message: error.message || "请求失败" });
});

async function start() {
  await initDb();
  return app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`Server running at http://localhost:${port}`);
  });
}

if (require.main === module) {
  start().catch((error) => {
    // eslint-disable-next-line no-console
    console.error("启动失败：", error);
    process.exit(1);
  });
}

module.exports = { app, initDb, start };
