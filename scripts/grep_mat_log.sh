#!/bin/bash
echo "=== grep MAT in pm2 logs ==="
grep -in "mat" ~/.pm2/logs/*.log | tail -50
echo "=== recent import errors (导入/失败) ==="
grep -in "导入\|失败\|Error\|error\]" ~/.pm2/logs/api-out*.log ~/.pm2/logs/api-error*.log 2>/dev/null | tail -40
