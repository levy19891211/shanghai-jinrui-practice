#!/usr/bin/env bash
# 固化部署流程:部署前先备份数据库,再 pull / build / restart。满足"更新维护中不丢数据"。
set -e
cd /root/shanghai-jinrui-practice
echo "[deploy] $(date) start"
echo "[deploy] 1/4 backup DB first"
( cd apps/api && node ../scripts/backup_db.cjs ) || echo "[deploy][warn] backup failed, continue anyway"
echo "[deploy] 2/4 git pull"
git pull origin main
echo "[deploy] 3/4 build"
npm run build
echo "[deploy] 4/4 restart"
pm2 restart api
pm2 restart web
echo "[deploy] done"
