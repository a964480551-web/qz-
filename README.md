# 七筑模型登记平台

一个前后端分离的模型登记与后台管理系统，支持设计师登记、截图上传、留言沟通、状态流转、账号与额度管理。

## 功能概览

- 设计师端
  - 账号 + 姓名双重校验
  - 模型登记（素材 ID、名称、需求、截图上传 / 粘贴）
  - 普通登记与加急登记（加急扣除 5 次额度）
  - 我的记录、排队情况
  - 留言与新消息提醒
  - 一键跳转找模型 / 找贴图网站
- 管理端
  - 管理员登录
  - 模型管理列表（接受、拒绝、编辑、删除、查看图片、留言）
  - 设计师账号管理（单个添加、批量添加、批量删除）
  - 管理员账号管理（单个添加、批量删除）

## 技术栈

- 前端：React + Vite
- 后端：Node.js + Express
- 数据库：SQLite
- 上传：Multer（图片存储在 `server/uploads`）

## 目录结构

```text
七筑/
├─ client/                 # 前端
│  ├─ src/
│  └─ vite.config.js
├─ server/                 # 后端
│  ├─ src/index.js
│  ├─ data/                # SQLite 数据库目录（运行后生成）
│  └─ uploads/             # 图片上传目录
└─ README.md
```

## 本地启动（开发）

## 1. 安装依赖

```bash
cd server
npm install

cd ../client
npm install
```

## 2. 启动后端

```bash
cd server
npm run dev
```

默认后端地址：`http://localhost:3003`

## 3. 启动前端

```bash
cd client
npm run dev
```

默认前端地址：`http://localhost:5174`

## 4. 默认管理员

- 账号：`lyh666`
- 密码：第一次启动时由环境变量 `ADMIN_INIT_PASSWORD` 决定；如果未设置，默认是 `ChangeMe123!`

如果你已经在后台改过管理员密码，请以数据库中的实际密码为准。

## 局域网给别人访问（你这台电脑当服务器）

适用于同一个 Wi-Fi / 局域网内同事访问。

## 1. 获取你的局域网 IP

Windows 命令行查看 `IPv4`，例如 `192.168.0.241`。

## 2. 前端已支持局域网监听

`client/vite.config.js` 已配置：

- `host: "0.0.0.0"`
- `port: 5174`

同事可通过：

- `http://你的局域网 IP:5174`

访问前端页面。

## 3. 后端跨域

后端当前允许来源：

- `http://localhost:5173`
- `http://localhost:5174`

如果你希望同事通过局域网 IP 访问时也可正常请求接口，需要在 `server/src/index.js` 的 `cors.origin` 中加上你的局域网地址，比如：

- `http://192.168.0.241:5174`

加完后重启后端。

## 4. 防火墙

确保 Windows 防火墙允许 Node.js 或开放 5174、3003 端口，否则同事会打不开。

## 生产部署（基础版）

可先用同一台机器部署，稳定后再迁移到云服务器。

## 1. 构建前端

```bash
cd client
npm run build
```

构建产物在 `client/dist`。

## 2. 运行后端

```bash
cd server
npm run start
```

## 3. 反向代理（推荐）

用 Nginx / IIS：

- 把 `client/dist` 作为静态站点
- 把 `/api` 和 `/uploads` 代理到后端 `3003`

这样对外只暴露一个域名地址，最省心。

## 环境变量（可选）

后端支持：

- `PORT`：后端端口（默认 `3003`）
- `JWT_SECRET`：管理员登录 token 密钥
- `ADMIN_INIT_PASSWORD`：默认管理员初始密码

## 数据与备份

- SQLite 文件：`server/data/model-platform.db`
- 图片文件：`server/uploads/`

建议定期备份这两个位置。

## 常见问题

## 1. 页面显示 `Failed to fetch`

通常是后端未启动、端口不对、跨域未放行或防火墙拦截。

## 2. 后台图片丢失

先确认：

- `server/uploads` 下文件存在
- 请求 URL 使用了正确参数（管理员端走 token，设计师端走账号 + 姓名）

## 3. 同事能打开页面但提交失败

多半是后端 `cors.origin` 未加局域网地址，或后端端口被防火墙拦截。

## 开发说明

- 前端入口：`client/src/App.jsx`
- 后端入口：`server/src/index.js`
- 当前默认前端端口：`5174`
- 当前默认后端端口：`3003`

