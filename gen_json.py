import openpyxl, json
wb = openpyxl.load_workbook("/Users/levi/Downloads/TMUA_题库_导入格式.xlsx")
ws = wb.active
rows = list(ws.iter_rows(values_only=True))
header = list(rows[0])
# 目标数据行的 Excel 行号(1-based,含表头)
targets = [333, 334, 336, 480]
out = []
for er in targets:
    r = rows[er-1]
    rec = dict(zip(header, r))
    opts = [o.strip() for o in str(rec['选项']).split(';') if o and o.strip()]
    data_row = er - 1  # 数据行号(1-based,不含表头)
    PER = 85
    sec = min(7, (data_row - 1) // PER)
    target_paper = "TMUA自编题卷" + str(sec + 1)
    out.append({
        "excelRow": er,
        "dataRow": data_row,
        "subject": rec['学科'],
        "sourceType": rec['题源'],
        "paperLabel": rec['试卷'],
        "topic": rec['知识点'] if rec['知识点'] is not None else '',
        "difficulty": rec['难度'] if rec['难度'] is not None else 3,
        "type": rec['题型'] if rec['题型'] is not None else 'SINGLE_CHOICE',
        "stem": rec['题干'],
        "options": opts,
        "answerLetter": str(rec['答案']).strip() if rec['答案'] is not None else '',
        "solution": rec['解析'] if rec['解析'] is not None else None,
        "sourceLabel": rec['来源'] if rec['来源'] is not None else '',
        "targetPaper": target_paper,
        "status": rec['状态'] if rec['状态'] is not None else 'PENDING_REVIEW',
    })
with open("/Users/levi/WorkBuddy/2026-08-07-13-05-24/tmua_missing.json", "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=2)
for o in out:
    print(o['excelRow'], '->', o['targetPaper'], '| ans=', o['answerLetter'], '| #opts=', len(o['options']))
    print('   opts:', o['options'])
