#!/usr/bin/env bash
# 备份恢复演练:把指定备份还原到临时库并校验核心表行数,绝不覆盖生产数据。
# 用法: bash scripts/restore_db.sh <path-to-backup.db>
set -e
SRC="${1:-}"
if [ -z "$SRC" ]; then echo "usage: $0 <path-to-backup.db>"; exit 1; fi
if [ ! -f "$SRC" ]; then echo "backup not found: $SRC"; exit 1; fi

cd /root/shanghai-jinrui-practice/apps/api
TMP="/tmp/restore_drill_$$.db"
cp "$SRC" "$TMP"
export DATABASE_URL="file:$TMP"

node -e "
const { PrismaClient } = require('@prisma/client');
(async () => {
  const p = new PrismaClient();
  const users = await p.user.count();
  const questions = await p.question.count();
  const sessions = await p.session.count();
  const langPapers = await p.languagePaper.count();
  const favorites = await p.favoriteQuestion.count();
  const wrong = await p.wrongBook.count();
  console.log('RESTORE_DRILL_OK users=' + users + ' questions=' + questions + ' sessions=' + sessions + ' languagePapers=' + langPapers + ' favorites=' + favorites + ' wrongBook=' + wrong);
  await p.\$disconnect();
})().catch(e => { console.error('RESTORE_DRILL_FAIL', e.message); process.exit(1); });
"
rm -f "$TMP"
echo "restore drill passed (production untouched)"
