# 专家深度全库审计（启动快照）

日期：2026-11-26  
触发：用户要求「生成即专家级」+「按规范全库重梳理」。

## 约束已落地

- `docs/EXPERT_DEPTH.md`（默认生成标准）
- `CONTENT_SPEC` / `CONTENT_BOUNDARY` / `AGENTS.md` / `.cursor/rules` 已引用

## 启动时厚度（按模块均长，仅作信号）

| 模块 | 篇数 | 均长 | 备注 |
|------|------|------|------|
| agent | 3 | ~2.5k | 优先重写 |
| language | 11 | ~3.0k | 优先重写 |
| jvm | 5 | ~3.0k | 优先重写 |
| concurrent | 8 | ~3.3k | 优先重写 |
| network | 10 | ~4.7k | 专家补强 |
| project | 3 | ~4.7k | 专家补强 |
| architecture | 4 | ~5.1k | 专家补强 |
| framework | 3 | ~5.5k | 专家补强 |
| compose | 4 | ~5.6k | 专家补强 |
| android | 5 | ~5.7k | 专家补强 |
| coroutine | 11 | ~6.0k | 薄弱篇加深，其余缺口补齐 |

## 并行重梳理分工

1. language 全量重写  
2. jvm + agent 重写  
3. concurrent 重写  
4. android + network 补强/重写  
5. coroutine 薄弱 + arch/compose/framework/project  

完成后统一：`apply-full-knowledge` → 恢复具名 QA（若被冲掉）→ `validate-content` → `npm run content`。
