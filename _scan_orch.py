import re
p = r"C:\coding\Biotech_Investment app 6\data_orchestrator.py"
text = open(p, encoding="utf-8", errors="replace").read()
names = [
    "regenerate_simulation_sheet_quick",
    "_run_simulation_sheet_into_workbook",
    "merge_by_symbol",
    "_build_financial_df_for_orchestrator",
    "_orch_commit_xlsx_replace_or_stage",
]
out = []
for name in names:
    m = re.search(rf"^def {re.escape(name)}\b", text, re.M)
    out.append(f"{name}: {'YES' if m else 'NO'}")
out.append(f"lines: {text.count(chr(10))+1}")
open(r"C:\coding\Biotech_Investment app 6\_scan_result.txt", "w").write("\n".join(out))
