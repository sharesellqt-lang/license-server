---
id: call-stack
title: Call Stack in JavaScript
order: 3
category: javascript
tags: [javascript, call-stack, execution-context, event-loop, runtime]
summary: Call Stack là cấu trúc dữ liệu dạng stack (LIFO) dùng để quản lý việc thực thi function trong JavaScript runtime.
difficulty: beginner
importance: 5
estimated_time: "25min"
---

# Call Stack in JavaScript

## Definition

**Call Stack** là một cấu trúc dữ liệu dạng **stack (LIFO - Last In First Out)** được JavaScript engine sử dụng để quản lý việc thực thi các function.

👉 Hiểu đơn giản:

> Call Stack là nơi JavaScript “ghi nhớ” function nào đang chạy và thứ tự chạy của chúng.

---

## Intuition

Hãy tưởng tượng Call Stack như một chồng đĩa:

- Đĩa mới đặt lên trên cùng
- Đĩa trên cùng được lấy ra trước

Tương tự:

- Function gọi sau → nằm trên stack
- Function chạy xong → bị pop khỏi stack

👉 JavaScript chỉ làm việc với function ở “đỉnh stack”.

---

## Example

### Basic call stack behavior

```js
function a() {
  console.log("A");
  b();
}

function b() {
  console.log("B");
  c();
}

function c() {
  console.log("C");
}

a();
```

### Output

```
A
B
C
```

---

## Execution Flow

```text
Global Context
   ↓
a() pushed to stack
   ↓
b() pushed to stack
   ↓
c() pushed to stack
   ↓
c() finished → pop
   ↓
b() finished → pop
   ↓
a() finished → pop
```

---

## Visualization

```text
CALL STACK

| c() |
| b() |
| a() |
|Global|
```

👉 Khi c() xong:

```
| b() |
| a() |
|Global|
```

---

## Deep Dive

Call Stack hoạt động dựa trên Execution Context:

Mỗi function call tạo ra một:

- Execution Context
- Push vào stack
- Khi xong → pop khỏi stack

👉 JavaScript engine (V8) quản lý stack này tự động.

---

## Common Bugs

### 1. Infinite recursion

```js
function foo() {
  foo();
}
foo();
```

❌ Result:

```
RangeError: Maximum call stack size exceeded
```

---

## Common Mistakes

### 1. Nghĩ async nằm trong call stack

```js
console.log("A");

setTimeout(() => {
  console.log("B");
}, 0);

console.log("C");
```

👉 setTimeout KHÔNG chạy trong call stack

---

## Edge Cases

### 1. Stack overflow

Call stack có giới hạn memory.

Nếu quá sâu:

```js
function deep() {
  deep();
}
deep();
```

👉 crash runtime

---

## Real World

Call stack ảnh hưởng trực tiếp đến:

- Debugging (stack trace)
- Error reporting
- Performance (blocking UI)
- Recursion design

---

## Engine Internals

Trong V8:

- Call Stack = Stack Frames
- Mỗi frame chứa:
  - local variables
  - function arguments
  - return address

---

## Related Concepts

- Execution Context
- Event Loop
- Heap Memory
- Microtask Queue
- Recursion

---

## Learn Next

- Execution Context
- Event Loop
- Microtask vs Macrotask
- Stack vs Heap
- Closure behavior in stack
---

## Summary

Call Stack là:

- cấu trúc quản lý function execution
- hoạt động theo LIFO
- trung tâm của JavaScript runtime
- nơi quyết định thứ tự chạy code sync

👉 Hiểu Call Stack = hiểu cách JavaScript thực thi code từng bước.
