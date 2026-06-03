---
id: javascript-runtime
title: JavaScript Runtime
category: javascript
tags:
  - javascript
  - runtime
  - event-loop
  - call-stack
  - web-api
  - async
  - execution-model
summary: >-
  Hiểu JavaScript Runtime hoạt động như thế nào phía sau engine, bao gồm Call
  Stack, Web APIs, Callback Queue, Microtask Queue và Event Loop.
difficulty: intermediate
importance: 5
estimated_time: ""40 min""
---

# JavaScript Runtime

## Definition

JavaScript Runtime là môi trường thực thi JavaScript.

Runtime không chỉ là engine.

Nó là toàn bộ hệ thống giúp JavaScript có thể:

- chạy code
- thao tác DOM
- gọi API
- xử lý async
- setTimeout
- fetch
- event listeners
- promise
- render UI

Ví dụ:
```js
console.log("A");

setTimeout(() => {
    console.log("B");
}, 0);

console.log("C");

```