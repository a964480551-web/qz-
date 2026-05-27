# 七筑模型登记平台

一个前后端分离的模型登记与后台管理系统，支持设计师登记、截图上传、留言沟通、状态流转、账号与额度管理。项目主要用于部署到公网，让设计师和管理员通过浏览器访问。

## 功能概览

- 设计师端
  - 账号 + 姓名双重校验
  - 模型登记（素材 ID、名称、需求、截图上传 / 粘贴）
  - 普通登记与加急登记（加急扣除 5 次额度）
  - 我的记录、排队情况
  - 素材库编码复制
  - 留言与新消息提醒
  - 一键跳转找模型 / 找贴图网站
- 管理端
  - 管理员登录
  - 模型管理列表（接受、拒绝、编辑、删除、查看图片、留言）
  - 设计师账号管理（单个添加、批量添加、批量删除）
  - 设计师额度管理（按数值增加额度、重置所有人额度）
  - 管理员账号管理（单个添加、批量删除）

## 技术栈

- 前端：React + Vite
- 后端：Node.js + Express
- 数据库：SQLite
- 上传：Multer（图片存储在 `server/uploads`）

## 目录结构

```text
qzmx/
├─ client/                 # 前端
│  ├─ src/
│  ├─ index.html
│  └─ vite.config.js
├─ server/                 # 后端
│  ├─ src/index.js
│  ├─ data/                # SQLite 数据库目录（运行后生成）
│  └─ uploads/             # 图片上传目录
└─ README.md
```

## 本地启动

安装依赖：

```bash
cd server
npm install

cd ../client
npm install
```

启动后端：

```bash
cd server
npm run dev
```

默认后端地址：`http://localhost:3003`

启动前端：

```bash
cd client
npm run dev
```

默认前端地址：`http://localhost:5174`

## 默认管理员

- 账号：`lyh666`
- 密码：第一次启动时由环境变量 `ADMIN_INIT_PASSWORD` 决定；如果未设置，默认是 `ChangeMe123!`

如果已经在后台改过管理员密码，请以数据库中的实际密码为准。

## 公网部署

这个项目不是纯静态网站，不能只靠 GitHub Pages 完整运行。GitHub Pages 只能展示前端页面，无法运行后端接口、SQLite 数据库和图片上传功能。

公网部署需要同时部署：

- 前端：`client/dist`
- 后端：`server`
- 数据文件：`server/data/model-platform.db`
- 上传图片：`server/uploads/`

## 推荐部署方式

推荐使用一台云服务器部署完整项目，并用域名访问。

### 1. 服务器准备

服务器需要安装：

- Node.js 18 或更高版本
- npm
- Nginx 或其他反向代理服务

### 2. 上传代码并安装依赖

```bash
git clone git@github.com:a964480551-web/qz-.git
cd qz-

cd server
npm install

cd ../client
npm install
```

### 3. 配置环境变量

后端建议至少配置：

```bash
PORT=3003
JWT_SECRET=请换成一串足够长的随机字符串
ADMIN_INIT_PASSWORD=请换成你的初始管理员密码
```

说明：

- `PORT`：后端端口，默认 `3003`
- `JWT_SECRET`：管理员登录 token 密钥，公网部署必须修改
- `ADMIN_INIT_PASSWORD`：默认管理员初始密码，只在首次创建默认管理员时生效

### 4. 配置前端接口地址

前端通过 `VITE_API_BASE` 指向后端地址。

如果后端单独用接口域名，例如 `https://api.7zmoxpingtai.ai`：

```bash
cd client
VITE_API_BASE=https://api.7zmoxpingtai.ai npm run build
```

如果使用同一个域名，并由 Nginx 把 `/api` 和 `/uploads` 转发到后端，可把前端代码中的接口地址改为同域路径，或在部署环境中统一处理反向代理。

### 5. 构建前端

```bash
cd client
npm run build
```

构建产物在：

```text
client/dist
```

### 6. 启动后端

开发测试可直接运行：

```bash
cd server
npm run start
```

正式部署建议使用 PM2 或系统服务守护进程，例如：

```bash
npm install -g pm2
cd server
pm2 start src/index.js --name qzmx-server
pm2 save
```

### 7. Nginx 反向代理示例

推荐公网只暴露一个域名，例如：

```text
https://7zmoxpingtai.ai
```

Nginx 可参考：

```nginx
server {
  listen 80;
  server_name 7zmoxpingtai.ai www.7zmoxpingtai.ai;

  root /www/qz-/client/dist;
  index index.html;

  location / {
    try_files $uri $uri/ /index.html;
  }

  location /api/ {
    proxy_pass http://127.0.0.1:3003/api/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location /uploads/ {
    proxy_pass http://127.0.0.1:3003/uploads/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

配置完成后，建议再配置 HTTPS 证书。

## 域名和 DNS

如果要使用 `7zmoxpingtai.ai` 访问：

- 域名 A 记录指向服务器公网 IP
- `www` 可用 CNAME 指向主域名
- 如果使用 GitHub Pages 验证域名，需要按 GitHub 提示添加 TXT 记录

注意：GitHub Pages 只适合前端静态预览，不适合完整运行本系统。

## 跨域配置

后端当前只允许本地前端来源：

```js
origin: ["http://localhost:5173", "http://localhost:5174"]
```

公网部署时，需要在 `server/src/index.js` 的 `cors.origin` 中加入正式前端域名，例如：

```js
origin: [
  "http://localhost:5173",
  "http://localhost:5174",
  "https://7zmoxpingtai.ai",
  "https://www.7zmoxpingtai.ai"
]
```

改完后重启后端。

## 数据与备份

必须定期备份：

- SQLite 数据库：`server/data/model-platform.db`
- 上传图片：`server/uploads/`

如果迁移服务器，只复制代码不够，还需要迁移这两个位置。

## 常见问题

### 页面显示 `Failed to fetch`

通常是以下原因：

- 后端没有启动
- 前端 `VITE_API_BASE` 配错
- Nginx 没有代理 `/api`
- 后端跨域没有放行正式域名
- 防火墙或安全组没有开放端口

### 后台图片丢失

先确认：

- `server/uploads` 下文件存在
- Nginx 已代理 `/uploads`
- 请求 URL 带了正确的登录 token 或设计师身份参数

### GitHub Pages 能不能部署

只能部署前端静态页面，无法完整使用后台、数据库和上传功能。完整 demo 请部署到云服务器，或使用 Render、Railway 等支持 Node.js 服务的平台。

## 开发说明

- 前端入口：`client/src/App.jsx`
- 后端入口：`server/src/index.js`
- 默认前端端口：`5174`
- 默认后端端口：`3003`
