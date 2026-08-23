#!/usr/bin/env python3
"""Copyright (c) 2026 Insta360. All rights reserved.

后端 LLM 输出解析的单元测试。纯函数，不联网、不消耗额度。

线上 simplify 返回 502 的真实原因是模型在 JSON 字符串内部写了未转义的双引号，
例如 {"text":"这样"已隐藏N个"的计数才对得上"}，整个响应不是合法 JSON。
真实输入实测 3 次里 2 次踩中，所以容错必须覆盖到。

同时覆盖代码块围栏（模型常无视"不要用代码块包裹"）、合法输入不被"修复"逻辑破坏、
以及真正不可解析的输入仍然报错——容错不能宽到把垃圾数据放给前端。
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from services.llm_client import (  # noqa: E402
    LLMError,
    _escape_inner_quotes,
    _loads_lenient,
    _parse_structured,
    _strip_code_fence,
)

FAILED: list[str] = []


def check(name: str, cond: bool, detail: str = "") -> None:
    if not cond:
        FAILED.append(name)
        print(f"      ✗ {name}" + (f" — {detail}" if detail else ""))


def expect_raises(name: str, fn) -> None:
    try:
        fn()
    except (ValueError, LLMError):
        return
    FAILED.append(name)
    print(f"      ✗ {name} — 本应抛错但没有")


def test_strip_code_fence() -> None:
    # 尾部围栏前带换行，是模型最常见的输出形态。
    check(
        "剥离 ```json 围栏（尾部带换行）",
        _strip_code_fence('```json\n{"a":1}\n```') == '{"a":1}',
        _strip_code_fence('```json\n{"a":1}\n```'),
    )
    check("剥离无语言标记的围栏", _strip_code_fence('```\n{"a":1}\n```') == '{"a":1}')
    check("无围栏时原样返回", _strip_code_fence('{"a":1}') == '{"a":1}')
    # 正文里出现 ``` 但不包裹整体时不能误剥。
    check("不误剥正文中的反引号", _strip_code_fence('{"a":"见 ```代码块```"}') == '{"a":"见 ```代码块```"}')
    # 只有半边围栏说明输出被截断，剥掉前围栏会把残缺内容伪装成可解析，
    # 应原样保留让 json.loads 正常报错。用捕获组（而非首尾分别 sub）才有这个语义。
    check("只有前围栏时不剥离", _strip_code_fence('```json\n{"a":1}') == '```json\n{"a":1}')


def test_escape_inner_quotes() -> None:
    raw = '{"paragraphs":[{"i":0,"text":"这样"已隐藏N个"的计数才对得上"}]}'
    fixed = _escape_inner_quotes(raw)
    check("串内裸引号被转义", '\\"已隐藏N个\\"' in fixed, fixed)
    # 已经合法的输入必须逐字不变，否则会把正确数据改坏。
    good = '{"paragraphs":[{"i":0,"text":"引用\\"原样\\"保留"}]}'
    check("合法输入不被改动", _escape_inner_quotes(good) == good)
    check("无引号内容不受影响", _escape_inner_quotes('{"a":1,"b":[2,3]}') == '{"a":1,"b":[2,3]}')


def test_loads_lenient() -> None:
    check("围栏+合法 JSON", _loads_lenient("simplify", '```json\n{"spans":["x"]}\n```') == {"spans": ["x"]})
    got = _loads_lenient("simplify", '{"paragraphs":[{"i":0,"text":"他说"你好"就走了"}]}')
    check("裸引号可救回", got["paragraphs"][0]["text"] == '他说"你好"就走了', str(got))
    got2 = _loads_lenient("simplify", '```json\n{"paragraphs":[{"i":1,"text":"含"引号"的段落"}]}\n```')
    check("围栏与裸引号同时出现", got2["paragraphs"][0]["i"] == 1, str(got2))

    expect_raises("截断输出应报错", lambda: _loads_lenient("simplify", '{"paragraphs":[{"i":0,"tex'))
    expect_raises("纯文本应报错", lambda: _loads_lenient("simplify", "好的，这是结果："))
    expect_raises("空串应报错", lambda: _loads_lenient("simplify", ""))


def test_parse_structured() -> None:
    out = _parse_structured("simplify", '{"paragraphs":[{"i":0,"text":"改写后"},{"i":1,"text":"第二段"}]}')
    check("simplify 返回 paragraphs", len(out["paragraphs"]) == 2, str(out))
    check("i 被规范成 int", isinstance(out["paragraphs"][0]["i"], int))

    # 单个坏条目丢弃即可，不该让整次请求失败——模型偶尔多吐一条空串
    # 不值得让用户看到"生成失败"。
    partial = _parse_structured(
        "simplify",
        '{"paragraphs":[{"i":0,"text":"有效"},{"i":1,"text":"   "},{"text":"缺编号"},{"i":true,"text":"布尔编号"}]}',
    )
    check("丢弃无效条目但保留有效条目", len(partial["paragraphs"]) == 1, str(partial))

    spans = _parse_structured("keyinfo", '{"spans":["片段一","  ","片段二",123]}')
    check("keyinfo 过滤空白与非字符串", spans["spans"] == ["片段一", "片段二"], str(spans))

    keep = _parse_structured("imagenoise", '{"keep":[0,2,2,true,"x",1]}')
    check("imagenoise 去重并丢掉非数字", keep["keep"] == [0, 2, 1], str(keep))
    empty = _parse_structured("imagenoise", '{"keep":[]}')
    check("imagenoise 允许空 keep", empty["keep"] == [], str(empty))

    expect_raises("全部条目无效应报错", lambda: _parse_structured("simplify", '{"paragraphs":[{"text":""}]}'))
    expect_raises("形状不符应报错", lambda: _parse_structured("simplify", '{"wrong":[]}'))
    expect_raises("顶层非对象应报错", lambda: _parse_structured("keyinfo", '["a","b"]'))
    expect_raises("imagenoise 缺 keep 应报错", lambda: _parse_structured("imagenoise", '{"spans":[0]}'))


def main() -> int:
    for fn in (test_strip_code_fence, test_escape_inner_quotes, test_loads_lenient, test_parse_structured):
        fn()
    if FAILED:
        print(f"      {len(FAILED)} 项失败")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
