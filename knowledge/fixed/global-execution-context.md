---
id: global-execution-context
title: Global Execution Context in JavaScript
category: javascript
tags: [javascript, execution-context, global-scope, call-stack, hoisting]
summary: Global Execution Context là execution context đầu tiên được tạo khi JavaScript bắt đầu chạy, nơi chứa toàn bộ global scope, hoisting và this binding.
difficulty: beginner
importance: 5
estimated_time: "25min"
---

# Global Execution Context

## Definition

**Global Execution Context (GEC)** là execution context đầu tiên được tạo khi JavaScript bắt đầu chạy một file/script.

Nó là “môi trường gốc” chứa toàn bộ:

- Global variables
- Function declarations
- `this` binding
- Scope nền (global scope)

👉 Mọi code JavaScript đều bắt đầu từ đây.

---

## Intuition

Hãy tưởng tượng JavaScript như một **sân khấu kịch**.

- Global Execution Context = sân khấu chính
- Tất cả diễn viên (functions, variables) được “đặt lên sân khấu” ngay từ đầu
- Khi cần diễn → tạo “phòng phụ” (function execution context)

👉 Quan trọng:

> Không có Global Execution Context → không có gì chạy được.

---

## Mental Model

```text
JS Program Start
      ↓
Create Global Execution Context
      ↓
Push into Call Stack
      ↓
Run code line by line
      ↓
Create Function Execution Context (nếu có function call)
```