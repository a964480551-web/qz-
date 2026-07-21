<img width="1113" height="999" alt="image" src="https://github.com/user-attachments/assets/a62a9c7c-5758-42c7-ae54-ea2fb4711f34" /># 模型登记与协作平台

一个前后端分离的模型登记与协作系统，包含设计师登记、图片上传、留言沟通、状态流转、额度管理和管理员后台。

项目不包含真实账号、密码、Token、数据库、上传图片或生产环境域名，可以作为公开仓库安全地继续开发。

## 功能

- 设计师登记模型需求、上传参考图片并查看处理进度。
- 支持普通登记、加急登记、额度统计和排队信息。
- 管理员处理任务、维护备注、调整状态和分配制作人。
- 管理设计师与管理员账号。
- 使用 bcrypt 保存密码哈希，不保存或返回明文密码。
- 使用 JWT 鉴权，密钥必须由环境变量提供。

## 技术栈

- 前端：React 18、Vite 5
- 后端：Node.js、Express
- 数据库：SQLite
- 文件上传：Multer

## 项目结构

```text
.
├─ client/              # React 前端
├─ server/              # Express 后端
├─ demo.html            # 无需后端的静态项目演示
├─ SECURITY.md          # 安全说明
└─ README.md
```

## 快速开始

要求 Node.js 22.13 或更高版本。服务端使用 Node.js 内置的 SQLite 模块，不依赖本地原生编译工具链。

### 1. 配置后端

复制 `server/.env.example` 为 `server/.env`，然后填写自己的随机配置：

```env
PORT=3003
JWT_SECRET=至少32位的随机字符串
ADMIN_INIT_ACCOUNT=首次启动时创建的管理员账号
ADMIN_INIT_PASSWORD=至少12位的随机密码
CORS_ORIGINS=http://localhost:5174
```

不要把 `server/.env` 提交到 Git。

### 2. 配置前端

复制 `client/.env.example` 为 `client/.env`：

```env
VITE_API_BASE=http://localhost:3003
```

### 3. 安装并启动

后端：

```bash
cd server
npm install
npm run dev
```

前端：

```bash
cd client
npm install
npm run dev
```

浏览器访问 Vite 输出的本地地址即可。

## 静态 Demo

直接用浏览器打开根目录的 `demo.html`，无需安装依赖或启动后端。Demo 使用虚构数据，只用于展示核心流程和界面结构。

## 安全设计

- 仓库不提供默认账号或默认密码。
- `JWT_SECRET` 少于 32 位时，服务端拒绝启动。
- 数据库中仅保存 bcrypt 密码哈希。
- 管理员密码不会通过 API 返回到前端。
- JWT 只通过 `Authorization` 请求头传输，不放在 URL 查询参数中。
- `.env`、数据库、上传内容、日志、压缩包和 `.trash` 均被 Git 忽略。

首次初始化之后，可以从运行环境中移除 `ADMIN_INIT_PASSWORD`。更换 JWT 密钥会使现有登录状态失效。

## 构建

```bash
cd client
npm run build
```

构建产物位于 `client/dist`。完整部署还需要运行后端服务并为 `/api` 和 `/uploads` 配置反向代理。

## 开源前检查

```bash
git status --short
git diff --cached
```

确认提交内容中没有 `.env`、数据库、日志、压缩包、部署备份或真实用户数据后再推送。
