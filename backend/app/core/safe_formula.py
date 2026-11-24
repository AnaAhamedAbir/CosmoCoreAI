"""
Safe AST-Based DataFrame Formula Evaluator
==========================================
Replaces `df.eval(..., engine="python")` so user-supplied feature formulas can
only execute whitelisted numeric/column math operations and NEVER arbitrary
Python code, attribute access, or OS commands.
"""

from __future__ import annotations

import ast
import operator
from typing import Any, Callable, Dict

import numpy as np
import pandas as pd

MAX_FORMULA_LENGTH = 512
MAX_AST_NODES = 128

_BIN_OPS: Dict[type, Callable[[Any, Any], Any]] = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.BitAnd: operator.and_,
    ast.BitOr: operator.or_,
}

_UNARY_OPS: Dict[type, Callable[[Any], Any]] = {
    ast.UAdd: operator.pos,
    ast.USub: operator.neg,
    ast.Invert: operator.invert,
}

_CMP_OPS: Dict[type, Callable[[Any, Any], Any]] = {
    ast.Lt: operator.lt,
    ast.LtE: operator.le,
    ast.Gt: operator.gt,
    ast.GtE: operator.ge,
    ast.Eq: operator.eq,
    ast.NotEq: operator.ne,
}

_SAFE_FUNCS: Dict[str, Callable[..., Any]] = {
    "abs": np.abs,
    "log": np.log,
    "log1p": np.log1p,
    "log10": np.log10,
    "exp": np.exp,
    "sqrt": np.sqrt,
    "sin": np.sin,
    "cos": np.cos,
    "tan": np.tan,
    "sign": np.sign,
    "floor": np.floor,
    "ceil": np.ceil,
    "clip": np.clip,
    "min": np.minimum,
    "max": np.maximum,
    "where": np.where,
}

_FORBIDDEN_NAMES = {
    "__import__",
    "__builtins__",
    "__class__",
    "__subclasses__",
    "__globals__",
    "eval",
    "exec",
    "compile",
    "open",
    "os",
    "sys",
    "subprocess",
}


def _safe_pow(base: Any, exp: Any) -> Any:
    if isinstance(exp, (int, float)) and abs(exp) > 100:
        raise ValueError("Exponent magnitude exceeds safe limit (100)")
    return operator.pow(base, exp)


def safe_eval_formula(df: pd.DataFrame, formula: str) -> Any:
    """
    Safely evaluate a mathematical formula against a pandas DataFrame.

    Only numeric literals, existing DataFrame column names, basic arithmetic /
    comparison operators, and whitelisted NumPy elementwise functions are
    permitted. Attribute access, imports, lambdas, comprehensions, and
    arbitrary calls are strictly rejected.
    """
    if not isinstance(formula, str) or not formula.strip():
        raise ValueError("Formula must be a non-empty string")
    formula = formula.strip()
    if len(formula) > MAX_FORMULA_LENGTH:
        raise ValueError(f"Formula exceeds maximum length of {MAX_FORMULA_LENGTH} characters")

    try:
        tree = ast.parse(formula, mode="eval")
    except SyntaxError as exc:
        raise ValueError(f"Invalid formula syntax: {exc.msg}") from exc

    node_count = sum(1 for _ in ast.walk(tree))
    if node_count > MAX_AST_NODES:
        raise ValueError("Formula is too complex")

    def _eval(node: ast.AST) -> Any:
        if isinstance(node, ast.Expression):
            return _eval(node.body)

        if isinstance(node, ast.Constant):
            if isinstance(node.value, (int, float, bool)):
                return node.value
            raise ValueError("Only numeric and boolean constants are allowed")

        if isinstance(node, ast.Name):
            name = node.id
            if name.startswith("_") or name in _FORBIDDEN_NAMES:
                raise ValueError(f"Disallowed identifier: '{name}'")
            if name in df.columns:
                return df[name]
            raise ValueError(f"Unknown column or identifier: '{name}'")

        if isinstance(node, ast.UnaryOp):
            op_fn = _UNARY_OPS.get(type(node.op))
            if op_fn is None:
                raise ValueError(f"Unsupported unary operator: {type(node.op).__name__}")
            return op_fn(_eval(node.operand))

        if isinstance(node, ast.BinOp):
            if isinstance(node.op, ast.Pow):
                return _safe_pow(_eval(node.left), _eval(node.right))
            op_fn = _BIN_OPS.get(type(node.op))
            if op_fn is None:
                raise ValueError(f"Unsupported binary operator: {type(node.op).__name__}")
            return op_fn(_eval(node.left), _eval(node.right))

        if isinstance(node, ast.Compare):
            if len(node.ops) != 1 or len(node.comparators) != 1:
                raise ValueError("Chained comparisons are not supported")
            op_fn = _CMP_OPS.get(type(node.ops[0]))
            if op_fn is None:
                raise ValueError(f"Unsupported comparison operator: {type(node.ops[0]).__name__}")
            return op_fn(_eval(node.left), _eval(node.comparators[0]))

        if isinstance(node, ast.Call):
            if not isinstance(node.func, ast.Name):
                raise ValueError("Only direct whitelisted math function calls are allowed")
            if node.keywords:
                raise ValueError("Keyword arguments are not supported in formulas")
            fn = _SAFE_FUNCS.get(node.func.id)
            if fn is None:
                raise ValueError(f"Function '{node.func.id}' is not allowed")
            args = [_eval(arg) for arg in node.args]
            return fn(*args)

        raise ValueError(f"Disallowed syntax element in formula: {type(node).__name__}")

    return _eval(tree)
