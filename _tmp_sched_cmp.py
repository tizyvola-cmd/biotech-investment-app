import ast
from pathlib import Path

def names(path: str) -> list[str]:
    tree = ast.parse(Path(path).read_text(encoding="utf-8"))
    out = []
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            out.append(node.name)
    return out

print("\n".join(names("/opt/biotech/supernova_web_scheduler.py")))
print("---LINES---")
print(Path("/opt/biotech/supernova_web_scheduler.py").read_text(encoding="utf-8").count("\n"))
print("warm", "warm_desk_competition" in Path("/opt/biotech/supernova_web_scheduler.py").read_text(encoding="utf-8"))
