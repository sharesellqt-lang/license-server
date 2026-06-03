---
id: hoisting
title: Hoisting
order: 6
category: javascript

tags: 
  - hoisting
  - execution-context
  - javascript-runtime
  - memory-creation-phase
  - scope
summary: Hoisting is JavaScript behavior where variable and function declarations are moved to the top of their scope during the memory creation phase before code execution.

difficulty: intermediate
importance: high
estimated_time: 45min
prerequisites: 
  - global-execution-context
  - call-stack
  - execution-context
  - lexical-scope
related: 
  - execution-context
  - global-execution-context
  - temporal-dead-zone
  - variable-environment
next: 
  - lexical-environment
  - closure
  - execution-context
---

# Hoisting

## Definition

Hoisting là cơ chế trong JavaScript nơi các **declarations (khai báo biến và hàm)** được “đưa lên đầu scope” trong giai đoạn **Memory Creation Phase** của Execution Context.

Quan trọng: chỉ declaration được hoist, không phải initialization.

Ví dụ:

```javascript id="h1"
console.log(a);

var a = 10;
```

Kết quả:

```text id="h2"
undefined
```

Vì JS thực chất xử lý như:

```text id="h3"
var a; // hoisted
console.log(a);
a = 10;
```

---

## Intuition

Hãy tưởng tượng bạn vào một lớp học.

Giáo viên:

- ghi danh sách học sinh trước (hoisting)
- nhưng chưa gán điểm ngay

Ví dụ đời thực:

```javascript id="h4"
console.log(student);
var student = "Alice";
```

Trực giác:

- tên đã được “đăng ký”
- nhưng chưa có giá trị

Output:

```text id="h5"
undefined
```

---

## Mental Model

Hoisting xảy ra trong **Memory Creation Phase** của Execution Context.

```text id="h6"
Execution Context
  ↓
Memory Creation Phase
  ↓
Hoist declarations
  ↓
Execution Phase
```

Mô hình:

```text id="h7"
Memory Table:
  var a → undefined
  function foo → function body
```

Ví dụ:

```javascript id="h8"
var a = 5;
function test() {}
```

Sau hoisting:

```text id="h9"
a → undefined
test → function reference
```

---

## Why It Exists

### 1. JS cần biết trước “tất cả định danh”

Ví dụ:

```javascript id="h10"
function run() {
  console.log(x);
  var x = 10;
}
run();
```

Nếu không hoisting:

- engine sẽ không biết x tồn tại

---

### 2. Cho phép gọi function trước khi khai báo

Ví dụ:

```javascript id="h11"
sayHello();

function sayHello() {
  console.log("Hello");
}
```

Output:

```text id="h12"
Hello
```

---

### 3. Giảm phụ thuộc thứ tự code

Ví dụ:

```javascript id="h13"
init();

function init() {
  setup();
}

function setup() {
  console.log("ready");
}
```

---

## Example

### var hoisting

```javascript id="h14"
console.log(a);
var a = 10;
console.log(a);
```

Output:

```text id="h15"
undefined
10
```

---

### function hoisting

```javascript id="h16"
hello();

function hello() {
  console.log("hi");
}
```

Output:

```text id="h17"
hi
```

---

### let/const (TDZ)

```javascript id="h18"
console.log(a);
let a = 10;
```

Output:

```text id="h19"
ReferenceError
```

---

## Execution Flow

```text id="h20"
1. Create Execution Context
2. Memory Creation Phase:
   - var → undefined
   - function → full definition
   - let/const → TDZ
3. Execution Phase:
   - run code line by line
```

Flow diagram:

```text id="h21"
Code
 ↓
Memory Phase (Hoisting)
 ↓
Execution Phase
 ↓
Output
```

---

## Visualization

Memory table before execution:

```text id="h22"
GLOBAL MEMORY
---
a → undefined
foo → function()
---
```

Stack:

```text id="h23"
| Global EC |
```

---

## Deep Dive

### 1. var hoisting

```javascript id="h24"
var a = 10;
```

Becomes:

```text id="h25"
var a;
a = 10;
```

---

### 2. function hoisting

```javascript id="h26"
function foo() {
  return 1;
}
```

Fully hoisted:

```text id="h27"
foo → function object
```

---

### 3. let/const TDZ

```javascript id="h28"
console.log(x);
let x = 5;
```

Memory:

```text id="h29"
x exists but uninitialized (TDZ)
```

---

## Performance

Hoisting itself không gây overhead runtime lớn, nhưng ảnh hưởng tới:

### 1. Debug confusion

```javascript id="h30"
console.log(a);
var a = 10;
```

---

### 2. Hidden bugs in large codebases

```javascript id="h31"
if (!user) {
  var user = "default";
}
```

---

### 3. Memory phase complexity

Large scripts:

- nhiều variables → memory allocation lớn upfront

---

## Common Bugs

### 1. Unexpected undefined

```javascript id="h32"
console.log(a);
var a = 10;
```

---

### 2. Function overwrite

```javascript id="h33"
function test() {
  return 1;
}

var test = 5;

console.log(test);
```

Output:

```text id="h34"
5
```

---

## Common Mistakes

### 1. Nghĩ JS chạy từ trên xuống 100%

Sai:

- JS luôn có memory phase trước execution

---

### 2. Nhầm let/const hoisting giống var

```javascript id="h35"
console.log(a);
let a = 10;
```

→ ReferenceError do TDZ

---

## Edge Cases

### 1. Function expression không hoisted như function declaration

```javascript id="h36"
sayHi();

var sayHi = function() {
  console.log("hi");
};
```

Output:

```text id="h37"
TypeError
```

---

### 2. Mixed hoisting conflicts

```javascript id="h38"
var a = 1;

function a() {}

console.log(a);
```

Output:

```text id="h39"
1
```

---

## Real World

### Module bundlers

Webpack/Vite:

- wrap code trong function scope
- reduce global hoisting issues

```javascript id="h40"
(function () {
  var a = 10;
})();
```

---

### React components

```javascript id="h41"
function App() {
  return "UI";
}
```

Hoisted safely as function declaration inside module scope.

---

## Engine Internals

V8 execution phases:

```text id="h42"
Source Code
  ↓
Parser
  ↓
AST
  ↓
Scope Analysis
  ↓
Memory Creation Phase (Hoisting)
  ↓
Execution Phase
```

Memory allocation:

```text id="h43"
VariableObject:
  var → undefined
  function → function object
  let/const → uninitialized (TDZ)
```

---

## Related Concepts

- Execution Context → nơi hoisting xảy ra
- Call Stack → chứa context sau hoisting
- TDZ → trạng thái let/const
- Lexical Environment → nơi lưu bindings

---

## Learn Next

- Lexical Environment
- Temporal Dead Zone
- Closures
- Execution Context Stack

---

## Summary

Hoisting là cơ chế JavaScript xử lý khai báo biến và hàm trong Memory Creation Phase trước khi code chạy, giúp engine biết trước toàn bộ identifiers trong scope.

Quan trọng:

- var → undefined
- function → hoisted hoàn chỉnh
- let/const → TDZ (không truy cập được trước khi khai báo)
- Hoisting xảy ra trước execution, không phải runtime re-ordering thực sự

Hiểu hoisting giúp bạn tránh bug undefined, ReferenceError và hiểu chính xác cách JavaScript engine xử lý code từ bên trong.
