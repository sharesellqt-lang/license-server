---
id: execution-context
title: Execution Context in JavaScript
order: 3
category: javascript
tags: [javascript, execution-context, call-stack, scope, hoisting]
summary: Execution Context là “môi trường thực thi” của JavaScript, nơi code được chạy, quản lý scope, hoisting và this binding.
difficulty: intermediate
importance: 5
estimated_time: "30min"
---

# Execution Context in JavaScript

## Definition

**Execution Context (EC)** là một “môi trường” mà trong đó JavaScript code được thực thi.

Mỗi khi JS chạy code, nó tạo ra một execution context để quản lý:

- Biến (variables)
- Hàm (functions)
- Scope chain
- `this`
- Hoisting behavior

👉 Nói đơn giản:

> Execution Context = “không gian làm việc của code tại thời điểm nó chạy”

---

## Intuition

Hãy tưởng tượng JavaScript giống như một **nhà máy sản xuất**.

Mỗi lần chạy một function:

- Nhà máy mở một “phòng làm việc riêng”
- Trong phòng đó có:
  - bàn làm việc (variables)
  - bản thiết kế (functions)
  - quyền truy cập tài nguyên (scope)
  - người vận hành (this)

Khi function chạy xong:

- phòng bị đóng lại (destroyed)

👉 Execution Context = “phòng làm việc tạm thời cho mỗi lần chạy code”

---

## Types of Execution Context

### 1. Global Execution Context (GEC)

- Tạo khi JS bắt đầu chạy file
- Chỉ có 1 cái duy nhất
- `this` = global object (window / global)

---

### 2. Function Execution Context (FEC)

- Tạo mỗi khi function được gọi
- Có thể tạo nhiều cái cùng lúc

---

### 3. Eval Execution Context (ít dùng)

- Khi dùng `eval()`

---

## Mental Model

JavaScript runtime hoạt động như sau:

```text
Code → Global EC → Function EC → Call Stack
```