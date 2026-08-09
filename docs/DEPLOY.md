# 云服务器部署指南 — 金瑞升学金鹰系统

> 本文档是正式部署到云服务器的完整操作手册。按顺序执行即可上线。
> 已在本机验证:前端生产构建通过(11 页面)、后端可运行、种子数据正常。

---

## ✅ 部署状态(2026-08-07 已正式上线 🎉)

- **服务器**:阿里云轻量应用服务器(Ubuntu 22.04,2核3.4G),IP **8.219.151.140**(海外节点,免备案)
- **访问地址**:http://8.219.151.140(学生直接用)
- **服务**:PM2 托管 api(:4000)+ web(:3000),均已设置开机自启
- **Nginx**:80 端口反向代理 → Next.js(3000),内置 /api 代理到 4000
- **已验证**:公网登录/题库(46道)/创建会话/判分全链路通过
- **注意**:服务器 .env 的 JWT_SECRET 已生成为随机值(不含在 git);如需备份数据库,直接拷贝 `apps/api/prisma/dev.db`

---

## 0. 部署架构总览

```
学生浏览器
    │
    ▼  http/https
[Nginx 80/443]
    │
    ├── / → Next.js 生产服务 (PM2: web, 端口 3000)
    │        └─ /api/* 代理到 localhost:4000
    └── /api/* → Express API (PM2: api, 端口 4000)
                 └─ SQLite 数据库 (apps/api/prisma/dev.db)
```

- **前端**:Next.js 生产模式(`next start -p 3000`),内置 `/api` 代理到本机 4000
- **后端**:Express(`node src/server.js`,端口 4000)
- **数据库**:SQLite(单文件,零依赖,已含全部 46 道题目数据)
- **进程托管**:PM2(崩溃自动重启、开机自启)

---

## 1. 购买云服务器

| 项 | 建议 |
|----|------|
| 平台 | 阿里云 / 腾讯云 / 华为云(国内访问快) |
| 规格 | **2 核 2GB 起**,4GB 更稳(Next.js 构建时较吃内存) |
| 系统 | **Ubuntu 22.04 LTS**(推荐,文档按此编写) |
| 带宽 | 按流量或 3-5Mbps 固定带宽即可(纯文本+少量图片) |
| 安全组 | 放行 **80**(HTTP)、**443**(HTTPS)、**22**(SSH);**3000/4000 不用对外开放** |

> 阿里云轻量应用服务器(2核2G,约 60-100 元/月)完全够用。
> 国内服务器需要域名备案才能用 80 端口,若嫌麻烦可先用**海外服务器**(如腾讯云轻量新加坡,免备案)。

---

## 2. 服务器环境准备(SSH 登录后执行)

```bash
# 2.1 更新系统 + 安装 Node.js 20 LTS 和 git
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git

# 验证
node -v    # 应显示 v20.x
npm -v

# 2.2 安装 PM2(进程托管,全局)
sudo npm install -g pm2

# 2.3 安装 Nginx(反向代理)
sudo apt-get install -y nginx
```

---

## 3. 拉取代码并安装依赖

```bash
# 3.1 用你自己的 GitHub 账号(服务器上需要 SSH 密钥,或直接用 HTTPS)
# 方式 A(推荐,免密钥):直接 HTTPS 克隆
cd ~
git clone https://github.com/levy19891211/shanghai-jinrui-practice.git
cd shanghai-jinrui-practice

# 方式 B(SSH):如果服务器上有配置好的 SSH 密钥
# git clone git@github.com:levy19891211/shanghai-jinrui-practice.git

# 3.2 安装全部依赖(npm workspaces 一次装完)
npm install

# 3.3 初始化数据库(建表 + 种子账号 + 官方真题 46 道)
cd apps/api
npx prisma db push          # 建表(生成 SQLite 文件)
npx prisma generate         # 生成 Prisma Client
npm run seed                # 种子账号(admin/teacher/student)
npm run seed:official       # 导入官方真题
cd ../..
```

> ⚠️ `prisma db push` 会生成 `apps/api/prisma/dev.db`(SQLite 数据库文件)。
> 如果想把本机已录入的题库直接带过去,把本机 `apps/api/prisma/dev.db` 上传覆盖即可,跳过 seed 两步。

---

## 4. 前端生产构建 + 启动服务(PM2)

```bash
# 4.1 前端生产构建(首次约 1-2 分钟)
cd apps/web
npm run build
cd ../..

# 4.2 用 PM2 启动两个服务
pm2 start "node apps/api/src/server.js" --name api
pm2 start "npm run start --prefix apps/web" --name web

# 4.3 查看状态(应为 online)
pm2 status

# 4.4 设置开机自启(重要!服务器重启后自动拉起服务)
pm2 save
pm2 startup   # 会输出一行 sudo 命令,复制执行即可

# 4.5 本机自测
curl -s http://localhost:4000/api/health    # 后端:{"code":0,...}
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/login   # 前端:200
```

---

## 5. 配置 Nginx 反向代理

```bash
sudo tee /etc/nginx/sites-available/practice > /dev/null <<'EOF'
server {
    listen 80;
    server_name _;   # 有域名就改成域名,如 practice.jinrui.edu.cn

    # 前端所有请求 → Next.js(3000)
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # 长连接/大响应(图片题)
    proxy_read_timeout 60s;
    client_max_body_size 20m;
}
EOF

# 启用站点 + 重载 Nginx
sudo ln -sf /etc/nginx/sites-available/practice /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default   # 移除默认站点
sudo nginx -t && sudo systemctl reload nginx
```

**此时学生访问 `http://服务器IP` 即可使用!**

---

## 6. (可选)HTTPS + 域名

有域名后建议上 HTTPS(浏览器不会报"不安全",数据加密):

```bash
# 安装 certbot
sudo apt-get install -y certbot python3-certbot-nginx

# 自动签发并配置证书(需要域名已解析到服务器 IP)
sudo certbot --nginx -d practice.jinrui.edu.cn

# 自动续期
sudo certbot renew --dry-run
```

---

## 7. 学生使用指引

1. 浏览器打开 `http://服务器IP`(或域名)
2. **学生登录**:`stu@example.com` / `123456`
3. **老师登录**:`teacher@example.com` / `123456`
4. **管理员**:`admin@example.com` / `123456`(可在题库删除题目)

> ⚠️ **上线后立刻改密码**(种子密码都是 123456):
> - 老师端登录 → 暂未提供改密码功能,可直接改数据库或用 API
> - 或者注册新学生账号给学生用,避免共用演示账号数据混淆

---

## 8. 常用运维命令

```bash
pm2 status                # 查看服务状态
pm2 logs api --lines 50   # 查看后端日志
pm2 logs web --lines 50   # 查看前端日志
pm2 restart api           # 重启后端
pm2 restart web           # 重启前端

# 更新代码
cd ~/shanghai-jinrui-practice
git pull
cd apps/web && npm run build && cd ../..
pm2 restart api web

# 备份数据库(重要!)
cp apps/api/prisma/dev.db ~/backup-dev-$(date +%F).db
```

---

## 9. 故障排查

| 症状 | 检查 |
|------|------|
| 学生访问 502 | `pm2 status` 是否 online;Nginx 是否指向 3000 |
| 前端能开但接口报错 | `curl http://localhost:4000/api/health`;日志 `pm2 logs api` |
| 登录提示密码错 | 确认执行过 `npm run seed` |
| 页面公式乱码 | 数据库是旧版文本?重新 `npm run normalize:math` |
| 数据库写不进 | `ls -la apps/api/prisma/dev.db` 检查权限(`sudo chown $USER`) |

---

## 10. 本机已做的部署前验证(2026-08-07)

- ✅ `next build` 生产构建通过:11 个页面,无 TypeScript/构建错误
- ✅ 后端 `GET /api/health` 返回 200
- ✅ 题库 46 道(官方 40 + 示例 6)已入库,判分/错题本/学情接口冒烟测试 20 项通过
- ✅ 图片题 11 张存于 `apps/web/public/images/questions/`(构建时自动打包)
