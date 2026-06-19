import ast
from pathlib import Path

text = Path(__file__).resolve().parents[1] / "prediction" / "pipeline.py"
mod = ast.parse(text.read_text(encoding="utf-8"))
mod_names = set()
for node in mod.body:
    if isinstance(node, ast.Assign):
        for t in node.targets:
            if isinstance(t, ast.Name):
                mod_names.add(t.id)
    elif isinstance(node, ast.FunctionDef):
        mod_names.add(node.name)
    elif isinstance(node, ast.ImportFrom):
        for a in node.names:
            mod_names.add(a.name)

fn = next(
    n for n in mod.body if isinstance(n, ast.FunctionDef) and n.name == "compute_price_predictions"
)
sus = set()
for n in ast.walk(fn):
    if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Load) and n.id.isupper():
        sus.add(n.id)

out = Path(__file__).resolve().parents[1] / "tests" / "_pipeline_globals.txt"
lines = sorted(x for x in sus if x not in mod_names)
out.write_text("\n".join(lines), encoding="utf-8")
print("missing", len(lines), "->", out)
