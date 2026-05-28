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
const sqlite3 = require("sqlite3").verbose();

const app = express();
const port = Number(process.env.PORT || 3003);

const DATA_DIR = path.join(__dirname, "..", "data");
const UPLOAD_DIR = path.join(__dirname, "..", "uploads");
const DB_PATH = path.join(DATA_DIR, "model-platform.db");
const JWT_SECRET = process.env.JWT_SECRET || "change-this-secret-in-production";
const ADMIN_INIT_PASSWORD = process.env.ADMIN_INIT_PASSWORD || "ChangeMe123!";
const DESIGNER_DEFAULT_TOTAL_QUOTA = 30;

for (const dir of [DATA_DIR, UPLOAD_DIR]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

const db = new sqlite3.Database(DB_PATH);

function now() {
  return new Date().toISOString();
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) {
        reject(error);
        return;
      }
      resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(rows);
    });
  });
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
      producer TEXT,
      completed_at TEXT,
      reject_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  await run(`ALTER TABLE materials ADD COLUMN is_urgent INTEGER NOT NULL DEFAULT 0`).catch(() => {});

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
      password_plain TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  await run(`ALTER TABLE staff ADD COLUMN password_plain TEXT NOT NULL DEFAULT ''`).catch(() => {});

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

  const defaultStaff = await get("SELECT account FROM staff WHERE account = ?", ["lyh666"]);
  if (!defaultStaff) {
    const ts = now();
    const hash = await bcrypt.hash(ADMIN_INIT_PASSWORD, 10);
    await run(
      "INSERT INTO staff(account, password_hash, password_plain, created_at, updated_at) VALUES(?, ?, ?, ?, ?)",
      ["lyh666", hash, ADMIN_INIT_PASSWORD, ts, ts]
    );
    // eslint-disable-next-line no-console
    console.log("默认管理员已创建：lyh666，请尽快在数据库中更新初始化密码。");
  }
}

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://localhost:5174",
      "http://localhost:5175",
      "http://192.168.0.214:5174",
      "http://192.168.0.214:5175"
    ],
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
  const queryToken = normalizeText(req.query?.token);
  if (queryToken) return queryToken;
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
    fileSize: 2 * 1024 * 1024,
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
    producer: record.producer || "",
    rejectReason: record.reject_reason || "",
    createdAt: record.created_at,
    updatedAt: record.updated_at
  };
}

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
  } catch (_error) {
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
  } catch (_error) {
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
  } catch (_error) {
    res.status(500).json({ message: "登录失败" });
  }
});

app.get("/api/staff", requireAdmin, async (_req, res) => {
  try {
    const rows = await all("SELECT account, password_plain, created_at, updated_at FROM staff ORDER BY created_at DESC");
    res.json(rows);
  } catch (_error) {
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
        "INSERT INTO staff(account, password_hash, password_plain, created_at, updated_at) VALUES(?, ?, ?, ?, ?)",
        [account, hash, password, ts, ts]
      );
      added += 1;
    }
    res.json({ added, skipped, failed });
  } catch (_error) {
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
        "INSERT INTO staff(account, password_hash, password_plain, created_at, updated_at) VALUES(?, ?, ?, ?, ?)",
        [account, hash, password, ts, ts]
      );
      added += 1;
    }
    res.json({ added, skipped, failed });
  } catch (_error) {
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
    await run("UPDATE staff SET password_hash = ?, password_plain = ?, updated_at = ? WHERE account = ?", [
      hash,
      password,
      ts,
      account
    ]);
    res.json({ success: true });
  } catch (_error) {
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
  } catch (_error) {
    res.status(500).json({ message: "删除管理员失败" });
  }
});

app.get("/api/accounts", requireAdmin, async (_req, res) => {
  try {
    const rows = await all(
      "SELECT account, owner_name, used_count, total_quota, created_at, updated_at FROM accounts ORDER BY created_at DESC"
    );
    res.json(rows);
  } catch (_error) {
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
  } catch (_error) {
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
  } catch (_error) {
    res.status(500).json({ message: "导入设计师 CSV 失败" });
  }
});

app.put("/api/accounts/quota/reset-all", requireAdmin, writeLimiter, async (_req, res) => {
  try {
    const ts = now();
    const result = await run("UPDATE accounts SET used_count = 0, updated_at = ?", [ts]);
    res.json({ success: true, changed: result.changes || 0 });
  } catch (_error) {
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
  } catch (_error) {
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
  } catch (_error) {
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
  } catch (_error) {
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
    await run("DELETE FROM accounts WHERE account = ?", [account]);
    res.json({ success: true });
  } catch (_error) {
    res.status(500).json({ message: "删除设计师账号失败" });
  }
});

app.get("/api/materials", async (req, res) => {
  try {
    const account = normalizeText(req.query?.account);
    const ownerName = normalizeText(req.query?.ownerName);
    const token = getAuthToken(req);
    if (token) {
      try {
        jwt.verify(token, JWT_SECRET);
      } catch (_error) {
        res.status(401).json({ message: "管理员登录态无效" });
        return;
      }
      const rows = await all("SELECT * FROM materials ORDER BY created_at DESC");
      res.json(rows.map(publicMaterial));
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
  } catch (_error) {
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
  } catch (_error) {
    res.status(500).json({ message: "获取排队记录失败" });
  }
});

app.post("/api/materials", writeLimiter, upload.single("image"), async (req, res) => {
  try {
    const account = normalizeText(req.body?.account);
    const ownerName = normalizeText(req.body?.ownerName);
    const materialId = normalizeText(req.body?.materialId);
    const name = normalizeText(req.body?.name);
    const requirement = normalizeText(req.body?.requirement);
    const isUrgent = String(req.body?.isUrgent || "").toLowerCase() === "true";
    const consumeCount = isUrgent ? 5 : 1;
    if (!account) {
      res.status(400).json({ message: "账号不能为空" });
      return;
    }
    const exists = await ensureDesignerIdentity(account, ownerName);
    if (!exists) {
      res.status(404).json({ message: "账号与姓名不匹配或不存在，请联系管理员确认" });
      return;
    }
    if (!materialId || !name || !requirement) {
      res.status(400).json({ message: "素材 ID、名称和需求不能为空" });
      return;
    }
    if (!req.file) {
      res.status(400).json({ message: "请上传 1 张图片" });
      return;
    }

    const quota = await getDesignerQuota(account);
    if (quota.usedCount + consumeCount > quota.totalQuota) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (_e) {
        // ignore
      }
      res.status(400).json({
        message: isUrgent ? "剩余额度不足，无法加急登记" : "额度已用完"
      });
      return;
    }

    const ts = now();
    const relativeImagePath = `/uploads/${req.file.filename}`;
    await run("BEGIN TRANSACTION");
    try {
      await run(
        `
          INSERT INTO materials(
            account, material_id, image_path, requirement, name, status, is_urgent,
            material_code, tech_notes, producer, completed_at, reject_reason,
            created_at, updated_at
          )
          VALUES(?, ?, ?, ?, ?, '待处理', ?, '', '', '', '', '', ?, ?)
        `,
        [account, materialId, relativeImagePath, requirement, name, isUrgent ? 1 : 0, ts, ts]
      );
      await run(
        "UPDATE accounts SET used_count = used_count + ?, updated_at = ? WHERE account = ?",
        [consumeCount, ts, account]
      );
      await run("COMMIT");
    } catch (error) {
      await run("ROLLBACK");
      throw error;
    }
    res.json({ success: true });
  } catch (error) {
    if (error instanceof multer.MulterError) {
      if (error.code === "LIMIT_FILE_SIZE") {
        res.status(400).json({ message: "图片不能超过 2 MB" });
        return;
      }
      if (error.code === "LIMIT_FILE_COUNT") {
        res.status(400).json({ message: "单次仅允许上传 1 张图片" });
        return;
      }
    }
    res.status(500).json({ message: error.message || "提交失败" });
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
    await run(
      "UPDATE materials SET status = '制作中', reject_reason = '', producer = ?, updated_at = ? WHERE id = ?",
      [req.admin.account, ts, id]
    );
    res.json({ success: true });
  } catch (_error) {
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
    if (row.status !== "待处理") {
      res.status(400).json({ message: "仅待处理任务可拒绝" });
      return;
    }
    const ts = now();
    await run(
      "UPDATE materials SET status = '已拒绝', reject_reason = ?, producer = ?, updated_at = ? WHERE id = ?",
      [reason, req.admin.account, ts, id]
    );
    res.json({ success: true });
  } catch (_error) {
    res.status(500).json({ message: "拒绝任务失败" });
  }
});

app.put("/api/materials/:id", requireAdmin, writeLimiter, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const materialCode = normalizeText(req.body?.materialCode);
    const techNotes = normalizeText(req.body?.techNotes);
    if (!Number.isFinite(id)) {
      res.status(400).json({ message: "任务 ID 无效" });
      return;
    }
    const row = await get("SELECT * FROM materials WHERE id = ?", [id]);
    if (!row) {
      res.status(404).json({ message: "任务不存在" });
      return;
    }
    if (row.status !== "制作中" && row.status !== "已完成") {
      res.status(400).json({ message: "仅制作中或已完成任务可编辑" });
      return;
    }
    const ts = now();
    if (row.status === "制作中") {
      await run(
        `
          UPDATE materials
          SET status = '已完成', material_code = ?, tech_notes = ?, updated_at = ?
          WHERE id = ?
        `,
        [materialCode, techNotes, ts, id]
      );
      res.json({ success: true });
      return;
    }
    await run("UPDATE materials SET material_code = ?, tech_notes = ?, updated_at = ? WHERE id = ?", [
      materialCode,
      techNotes,
      ts,
      id
    ]);
    res.json({ success: true });
  } catch (_error) {
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
    await run("DELETE FROM materials WHERE id = ?", [id]);
    const fullPath = path.join(__dirname, "..", row.image_path.replace("/uploads/", "uploads/"));
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
    res.json({ success: true });
  } catch (_error) {
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
    if (token) {
      try {
        jwt.verify(token, JWT_SECRET);
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
    res.json(rows);
  } catch (_error) {
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
  } catch (_error) {
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
    const material = await get("SELECT * FROM materials WHERE image_path = ?", [imagePath]);
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
  } catch (_error) {
    res.status(500).json({ message: "读取图片失败" });
  }
});

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      res.status(400).json({ message: "文件不能超过 2 MB" });
      return;
    }
  }
  res.status(400).json({ message: error.message || "请求失败" });
});

initDb()
  .then(() => {
    app.listen(port, () => {
      // eslint-disable-next-line no-console
      console.log(`Server running at http://localhost:${port}`);
    });
  })
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error("启动失败：", error);
    process.exit(1);
  });
