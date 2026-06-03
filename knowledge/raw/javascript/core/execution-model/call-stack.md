---
id: call-stack
title: Call Stack
order: 5
category: javascript

tags: 
  - call-stack
  - execution-context
  - javascript-runtime
  - stack-overflow
  - event-loop
summary: Call Stack is a LIFO data structure used by JavaScript engines to manage execution contexts, function calls, and synchronous execution flow.

difficulty: intermediate
importance: high
estimated_time: 45min
prerequisites: 
  - global-execution-context
  - execution-context
  - functions-in-javascript
related: 
  - event-loop
  - memory-heap
  - async-javascript
  - execution-context
next: 
  - event-loop
  - closure
  - async-await
---

# Call Stack

## Definition

Call Stack là một cấu trúc dữ liệu LIFO (Last In First Out) được JavaScript engine sử dụng để quản lý toàn bộ **Execution Context** trong quá trình chạy chương trình.

Mỗi function call sẽ tạo một stack frame và được push vào Call Stack. Khi function hoàn thành, frame đó bị pop ra.

Ví dụ:

```javascript id="cs1"
function a() {
  console.log("A");
}

function b() {
  a();
}

b();
```

Flow:

```text id="cs2"
b() → a() → console.log() → return
```

Stack:

```text id="cs3"
| console.log |
| a()         |
| b()         |
| Global EC   |
```

---

## Intuition

Hãy tưởng tượng Call Stack như một chồng sách.

Ví dụ đời thực:

- Bạn đặt sách lên → push
- Bạn lấy sách trên cùng → pop

JavaScript:

```javascript id="cs4"
function first() {
  second();
}

function second() {
  third();
}

function third() {
  console.log("end");
}

first();
```

Trực giác:

```text id="cs5"
first
  → second
    → third
  → log
```

Stack:

```text id="cs6"
Push first
Push second
Push third
Pop third
Pop second
Pop first
```

---

## Mental Model

Call Stack là “ngăn xếp trạng thái hiện tại của chương trình”.

```text id="cs7"
Call Stack =
[
  Global Execution Context,
  Function Execution Context,
  Function Execution Context
]
```

Ví dụ:

```javascript id="cs8"
function run() {
  compute();
}

function compute() {
  return 1 + 1;
}

run();
```

Stack:

```text id="cs9"
compute EC
run EC
Global EC
```

---

## Why It Exists

### 1. Quản lý luồng thực thi

Ví dụ:

```javascript id="cs10"
function a() {
  b();
}

function b() {
  c();
}

function c() {
  console.log("done");
}

a();
```

Không có stack → không biết quay lại đâu sau khi c() kết thúc.

---

### 2. Đảm bảo return đúng context

Ví dụ:

```javascript id="cs11"
function sum(x, y) {
  return x + y;
}

function main() {
  return sum(2, 3);
}

console.log(main());
```

Stack đảm bảo:

- sum xong → quay về main
- main xong → quay về global

---

### 3. Debug stack trace

Ví dụ lỗi:

```javascript id="cs12"
function x() {
  y();
}

function y() {
  z();
}

function z() {
  throw new Error("Crash");
}

x();
```

Output:

```text id="cs13"
at z
at y
at x
```

---

## Example

```javascript id="cs14"
function multiply(a, b) {
  return a * b;
}

function square(n) {
  return multiply(n, n);
}

function start() {
  return square(5);
}

console.log(start());
```

Output:

```text id="cs15"
25
```

Stack:

```text id="cs16"
start → square → multiply → return
```

---

## Execution Flow

```text id="cs17"
1. Global Execution Context created
2. start() called → push start
3. square() called → push square
4. multiply() called → push multiply
5. return multiply → pop
6. return square → pop
7. return start → pop
8. back to Global EC
```

Flow:

```text id="cs18"
Global EC
  ↓
start()
  ↓
square()
  ↓
multiply()
  ↓
return
```

---

## Visualization

```text id="cs19"
CALL STACK
---
| multiply          |
| square            |
| start             |
| Global EC         |
---
```

---

## Deep Dive

Mỗi stack frame là một Execution Context:

```javascript id="cs20"
{
  variableEnvironment,
  lexicalEnvironment,
  thisBinding,
  codeState
}
```

Ví dụ:

```javascript id="cs21"
function test() {
  var a = 10;
  console.log(a);
}

test();
```

Stack frame:

```text id="cs22"
test EC:
  a = 10
  console.log reference
```

---

## Performance

### 1. Stack overflow

```javascript id="cs23"
function rec() {
  rec();
}

rec();
```

Error:

```text id="cs24"
Maximum call stack size exceeded
```

---

### 2. Blocking main thread

```javascript id="cs25"
function heavy() {
  let i = 0;
  while (i < 1e9) i++;
}

heavy();
```

Result:

- UI freeze
- event loop blocked

---

## Common Bugs

### 1. Infinite recursion

```javascript id="cs26"
function loop() {
  loop();
}

loop();
```

---

### 2. Missing base case

```javascript id="cs27"
function fact(n) {
  return n * fact(n - 1);
}
```

Fix:

```javascript id="cs28"
function fact(n) {
  if (n === 1) return 1;
  return n * fact(n - 1);
}
```

---

## Common Mistakes

### 1. Nghĩ JS chạy song song trong stack

Sai:

```javascript id="cs29"
console.log(1);
console.log(2);
console.log(3);
```

JS chạy tuần tự.

---

### 2. Nhầm async nằm trong stack

```javascript id="cs30"
console.log("A");

setTimeout(() => console.log("B"), 0);

console.log("C");
```

Output:

```text id="cs31"
A
C
B
```

---

## Edge Cases

### 1. Stack limit khác nhau theo engine

```javascript id="cs32"
function deep(n) {
  if (n === 0) return;
  deep(n - 1);
}

deep(100000);
```

---

### 2. Tail recursion không luôn optimize

```javascript id="cs33"
function tail(n) {
  if (n === 0) return;
  return tail(n - 1);
}
```

---

## Real World

### React

```javascript id="cs34"
function App() {
  return Child();
}

function Child() {
  return "Hi";
}
```

Stack:

```text id="cs35"
App → Child → return
```

---

### Node.js

```javascript id="cs36"
require("http").createServer((req, res) => {
  res.end("OK");
}).listen(3000);
```

Mỗi request tạo stack frame riêng.

---

## Engine Internals

V8 pipeline:

```text id="cs37"
Source Code
  ↓
Parser
  ↓
AST
  ↓
Bytecode
  ↓
Execution Context
  ↓
Call Stack Push
```

Stack frame:

```text id="cs38"
+---------------------+
| Function Frame      |
| local variables     |
| return address      |
+---------------------+
```

---

## Related Concepts

- Execution Context → đơn vị trong stack
- Event Loop → xử lý async ngoài stack
- Memory Heap → lưu object
- Global Execution Context → frame đầu tiên

---

## Learn Next

- Event Loop
- Async JavaScript
- Closures
- Memory Heap

---

## Summary

Call Stack là cấu trúc LIFO quản lý toàn bộ execution flow của JavaScript, đảm bảo function được gọi và trả về đúng thứ tự, tạo nền tảng cho synchronous execution.

Quan trọng nhất:

- Mỗi function call tạo một stack frame
- JS chạy single-thread trong stack
- Stack overflow xảy ra khi recursion sai
- Async không chạy trực tiếp trong stack mà thông qua event loop
