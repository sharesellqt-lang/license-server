---
id: global-execution-context
title: Global Execution Context
order: 4
category: javascript

tags: 
  - execution-context
  - call-stack
  - javascript-runtime
  - memory-model
  - hoisting
summary: Global Execution Context is the first execution context created by JavaScript engine, establishing the global scope, memory allocation, and execution baseline before any code runs.

difficulty: intermediate
importance: high
estimated_time: 40min
prerequisites: 
  - javascript-basics
  - call-stack
  - lexical-scope
related: 
  - execution-context
  - call-stack
  - memory-heap
  - hoisting
next: 
  - function-execution-context
  - closure
  - event-loop
---

# Global Execution Context

## Definition

Global Execution Context (GEC) là execution context đầu tiên được tạo ra khi JavaScript bắt đầu chạy bất kỳ file script nào.

Nó là “môi trường gốc” chứa toàn bộ global variables, function declarations, và thiết lập `this` ở scope toàn cục.

Ví dụ:

```javascript
var x = 10;

function add(a, b) {
  return a + b;
}

console.log(add(x, 5));
```

Ngay khi file này chạy, JavaScript engine thực hiện:

```text
1. Tạo Global Execution Context
2. Memory Creation Phase
3. Execution Phase
```

Execution flow:

```text
JS Engine Start
   ↓
Create Global Execution Context
   ↓
Memory Allocation (Hoisting)
   ↓
Execute Code Line by Line
```

---

## Intuition

Hãy tưởng tượng bạn mở một công ty.

Global Execution Context chính là:

> “Trụ sở chính” nơi mọi thứ được đăng ký trước khi vận hành.

Ví dụ đời thực:

- Nhân sự được ghi danh (variables)
- Bộ phận được tạo danh sách (functions)
- Nhưng chưa ai bắt đầu làm việc ngay

Ví dụ code:

```javascript
console.log(user);

var user = "Alice";
```

Kết quả:

```text
undefined
```

Vì trong GEC:

- `user` đã được tạo trước
- nhưng chưa gán giá trị

---

## Mental Model

Global Execution Context có thể mô hình hóa như một object:

```text
GEC = {
  memory: {
    variables: {},
    functions: {}
  },
  code: [],
  this: window (browser)
}
```

Ví dụ:

```javascript
var a = 5;
function test() {}
```

Mental model:

```text
Memory Phase:
  a → undefined
  test → function reference

Execution Phase:
  a → 5
```

Stack visualization:

```text
CALL STACK
---
| Global EC        |
---
```

---

## Why It Exists

### 1. Khởi tạo môi trường runtime

Ví dụ:

```javascript
var name = "JS";

function greet() {
  console.log(name);
}
```

Nếu không có GEC:

- Không có nơi lưu `name`
- Không có scope global

---

### 2. Hỗ trợ hoisting

Ví dụ:

```javascript
console.log(fn);

function fn() {
  return "hello";
}
```

Output:

```text
[Function: fn]
```

Vì GEC memory phase đã tạo function trước khi chạy code.

---

### 3. Là nền cho call stack

Ví dụ:

```javascript
function a() {
  b();
}

function b() {
  console.log("inside b");
}

a();
```

Stack:

```text
Global EC → a() → b() → console.log
```

---

## Example

```javascript
var x = 2;

function square(n) {
  return n * n;
}

function run() {
  return square(x);
}

console.log(run());
```

Output:

```text
4
```

Memory phase:

```text
x → undefined
square → function
run → function
```

Execution phase:

```text
x = 2
run() → square(2) → 4
```

---

## Execution Flow

```text
1. Create Global Execution Context
2. Push GEC into Call Stack
3. Memory Phase:
   - allocate variables
   - register functions
4. Execution Phase:
   - execute line by line
5. Call function → create new execution context
6. Return → pop context
```

Diagram:

```text
Global EC
   ↓
run()
   ↓
square()
   ↓
return value
   ↓
back to Global EC
```

---

## Visualization

Memory + Stack:

```text
CALL STACK
---
| square EC          |
| run EC             |
| Global EC          |
---

GLOBAL MEMORY
---
x = 2
square = fn
run = fn
---
```

---

## Deep Dive

Global Execution Context bao gồm:

### 1. Variable Environment

```javascript
var a = 10;
```

Stored as:

```text
a → undefined → 10
```

---

### 2. Lexical Environment

```javascript
function outer() {
  var x = 1;
}
```

Outer scope is linked:

```text
outer EC → Global EC
```

---

### 3. This Binding

Browser:

```javascript
console.log(this);
```

Output:

```text
window
```

Node.js:

```javascript
console.log(this);
```

Output:

```text
{}
```

---

## Performance

### 1. Global pollution

```javascript
var a = 1;
var b = 2;
var c = 3;
```

Problem:

- tăng memory usage
- dễ conflict global scope

---

### 2. Memory leaks via global variables

```javascript
window.cache = new Array(1000000);
```

Problem:

- giữ memory lâu dài
- khó garbage collect

---

### Fix:

```javascript
(function () {
  const cache = [];
})();
```

---

## Common Bugs

### 1. Hoisting misunderstanding

```javascript
console.log(a);
var a = 10;
```

Output:

```text
undefined
```

---

### 2. Function vs variable hoisting

```javascript
console.log(fn);

var fn = function () {};
```

Output:

```text
undefined
```

---

## Common Mistakes

### 1. Nghĩ code chạy line-by-line hoàn toàn

Sai:

- JS luôn có memory phase trước execution phase

---

### 2. Nghĩ let/const giống var

```javascript
console.log(a);
let a = 10;
```

Error:

```text
ReferenceError
```

---

## Edge Cases

### 1. Temporal Dead Zone

```javascript
console.log(a);
let a = 5;
```

a exists but not initialized.

---

### 2. Multiple script tags sharing global scope

```html
<script src="a.js"></script>
<script src="b.js"></script>
```

Both share same GEC → window object.

---

## Real World

### Browser environment

```javascript
window.user = "admin";
```

GEC = window object

---

### Node.js environment

```javascript
global.user = "admin";
```

GEC = global object

---

### React app

```javascript
function App() {
  return "Hello";
}
```

App exists in module scope, not polluting global GEC.

---

## Engine Internals

V8 pipeline:

```text
Source Code
   ↓
Parser
   ↓
AST
   ↓
Bytecode
   ↓
Create Global Execution Context
   ↓
Push to Call Stack
   ↓
Execute
```

Stack frame:

```text
+------------------------+
| Global Execution Context|
| memory environment     |
| lexical environment    |
| this binding           |
+------------------------+
```

---

## Related Concepts

- Call Stack → GEC is first frame
- Execution Context → GEC is base context
- Hoisting → happens during GEC creation
- Lexical Scope → linked from GEC
- Event Loop → handles async outside GEC

---

## Learn Next

- Call Stack
- Function Execution Context
- Closure
- Event Loop
- Hoisting Deep Dive

---

## Summary

Global Execution Context là execution context đầu tiên được tạo bởi JavaScript engine để thiết lập môi trường chạy cho toàn bộ chương trình.

Nó quan trọng vì:

- tạo global scope
- xử lý hoisting
- thiết lập call stack ban đầu

Hoạt động theo 2 phase:

- Memory Creation Phase (hoisting)
- Execution Phase (run code)

Điều quan trọng nhất: mọi JavaScript program luôn bắt đầu từ Global Execution Context, và mọi function execution đều được xây trên nền context này.
