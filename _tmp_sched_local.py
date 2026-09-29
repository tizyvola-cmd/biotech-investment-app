import ast
from pathlib import Path

tree = ast.parse(Path("supernova_web_scheduler.py").read_text(encoding="utf-8"))
for node in tree.body:
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
        print(node.name)
print("---LINES---", Path("supernova_web_scheduler.py").read_text(encoding="utf-8").count("\n"))
