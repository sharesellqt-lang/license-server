---
id: lexical-environment
title: Lexical Environment
category: javascript
tags: [javascript, scope, closure, execution-context, engine]
summary: Lexical Environment là cấu trúc nội bộ của JavaScript dùng để quản lý scope và biến tại thời điểm code được viết, không phải thời điểm chạy.
difficulty: intermediate
importance: 5
estimated_time: "25min"
---

# Lexical Environment

## Definition

**Lexical Environment** là một cấu trúc nội bộ trong JavaScript engine dùng để **lưu trữ biến và cách chúng được truy cập dựa trên vị trí code được viết (lexical scope)**.

Nó bao gồm:
- Một **Environment Record**: nơi lưu biến (let, const, function, parameters)
- Một **Reference đến outer lexical environment**: liên kết scope cha

Hiểu đơn giản:
> Lexical Environment = “bản đồ biến + đường link đến scope cha”

---

## Intuition

Hãy tưởng tượng code là một **tòa nhà nhiều tầng**:

- Mỗi function là một tầng
- Biến nằm trong từng tầng
- Khi tìm biến → bạn không nhảy lung tung, mà:
  - tìm trong tầng hiện tại
  - không thấy → đi lên tầng trên
  - cứ thế cho đến tầng cao nhất (global)

👉 Lexical Environment chính là “hệ thống định vị” giúp JS biết:
- biến này nằm ở đâu
- có được phép truy cập hay không

---

## Mental Model

Một Lexical Environment giống như:
