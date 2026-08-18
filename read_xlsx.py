import openpyxl
wb = openpyxl.load_workbook("/Users/levi/Downloads/TMUA_题库_导入格式.xlsx")
ws = wb.active
rows = list(ws.iter_rows(values_only=True))
header = rows[0]
print("总行数(含表头):", len(rows))
print("表头:", header)
for excel_row in [333, 334, 336, 480]:  # 数据行+1(表头占第1行)
    print(f"\n=== Excel 第 {excel_row} 行 (数据行 {excel_row-1}) ===")
    r = rows[excel_row-1]
    for ci, h in enumerate(header):
        print(f"  [{ci}] {h} = {repr(r[ci])}")
