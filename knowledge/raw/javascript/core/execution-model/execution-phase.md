---
id: execution-phase
title: Execution Phase
order: 10
category: javascript

tags: 
  - execution-context
  - javascript-runtime
  - call-stack
  - runtime-phase
  - memory-vs-execution
summary: Execution Phase is the stage in JavaScript execution context where code is executed line-by-line after memory creation, using already allocated variables and functions.

difficulty: beginner
importance: high
estimated_time: 40min
prerequisites: 
  - execution-context
  - memory-creation-phase
  - hoisting
  - lexical-environment
related: 
  - call-stack
  - execution-context
  - memory-creation-phase
  - event-loop
next: 
  - call-stack
  - event-loop
  - closure
---

# Execution Phase

## Definition

Execution Phase là giai đoạn thứ hai trong Execution Context lifecycle của JavaScript, nơi code được chạy **từng dòng một (line-by-line execution)** sau khi Memory Creation Phase đã hoàn tất.

Ở giai đoạn này:

- biến đã được hoist
- function đã được lưu trong memory
- engine bắt đầu “thực thi logic”

Ví dụ:

```javascript id="ep1"
var a = 10;
var b = 20;

function sum(x, y) {
  return x + y;
}

var result = sum(a, b);
console.log(result);
```

Output:

```text id="ep2"
30
```

Execution Phase là nơi JavaScript “thực sự chạy”.

---

## Intuition

Hãy tưởng tượng 2 giai đoạn:

- Memory Phase: chuẩn bị nguyên liệu
- Execution Phase: nấu ăn

Ví dụ đời thực:

```javascript id="ep3"
let rice = "raw";
let water = "available";

function cook() {
  return "cooked rice";
}

let meal = cook();
console.log(meal);
```

Trực giác:

- Memory Phase: chuẩn bị gạo + nước + công thức
- Execution Phase: bắt đầu nấu

Output:

```text id="ep4"
cooked rice
```

---

## Mental Model

Execution Phase hoạt động như một **instruction runner**:

```text id="ep5"
Execution Context
  ↓
Memory Phase (setup)
  ↓
Execution Phase (run code line by line)
```

Mô hình runtime:

```text id="ep6"
Line 1 → execute
Line 2 → execute
Line 3 → execute
```

Ví dụ:

```javascript id="ep7"
let a = 1;
let b = 2;
let c = a + b;
```

Execution order:

```text id="ep8"
1. assign a
2. assign b
3. compute c
```

---

## Why It Exists

### 1. Tách setup và execution

Ví dụ:

```javascript id="ep9"
console.log(a);
var a = 10;
```

Nếu không tách phase:

- engine không biết a tồn tại

---

### 2. Cho phép hoisting hoạt động

```javascript id="ep10"
sayHi();

function sayHi() {
  console.log("Hi");
}
```

Memory Phase:

- sayHi tồn tại

Execution Phase:

- gọi function

---

### 3. Đảm bảo deterministic execution order

```javascript id="ep11"
let x = 1;
let y = x + 1;
let z = y + 1;
```

---

## Example

### Basic execution flow

```javascript id="ep12"
let a = 5;
let b = 10;
let sum = a + b;

console.log(sum);
```

Output:

```text id="ep13"
15
```

---

### Function execution

```javascript id="ep14"
function multiply(x, y) {
  return x * y;
}

let result = multiply(3, 4);
console.log(result);
```

Output:

```text id="ep15"
12
```

---

## Execution Flow

Ví dụ:

```javascript id="ep16"
let x = 2;
let y = 3;
let z = x * y;
```

Flow:

```text id="ep17"
1. Create Execution Context
2. Memory Phase:
   x → undefined
   y → undefined
   z → undefined
3. Execution Phase:
   x = 2
   y = 3
   z = x * y
```

Runtime flow:

```text id="ep18"
Line 1 → assign x
Line 2 → assign y
Line 3 → compute z
```

---

## Visualization

Stack + execution:

```text id="ep19"
Call Stack
---
Global Execution Context
---

Execution Phase:
a = 10
b = 20
sum = a + b
```

Memory vs Execution:

```text id="ep20"
Memory Phase:
a → undefined
b → undefined

Execution Phase:
a → 10
b → 20
```

---

## Deep Dive

### 1. Variable assignment happens here

```javascript id="ep21"
var a;
a = 10;
```

---

### 2. Function invocation happens here

```javascript id="ep22"
function f() {
  return 1;
}

f();
```

Execution Phase:

- function call triggered
- new execution context created

---

### 3. Expression evaluation

```javascript id="ep23"
let result = 2 + 3 * 4;
```

Engine:

```text id="ep24"
1. multiply 3 * 4
2. add 2
3. assign result
```

---

## Performance

### 1. Execution cost depends on operations

```javascript id="ep25"
for (let i = 0; i < 1000000; i++) {
  let x = i * 2;
}
```

Cost:

- loop execution heavy

---

### 2. Function call overhead

```javascript id="ep26"
function a() {}
function b() {}

a();
b();
```

---

## Common Bugs

### 1. Using variable before assignment

```javascript id="ep27"
console.log(a);
var a = 10;
```

Output:

```text id="ep28"
undefined
```

---

### 2. Wrong execution order assumption

```javascript id="ep29"
let x = y;
let y = 10;
```

Error:

```text id="ep30"
ReferenceError
```

---

## Common Mistakes

### 1. Nghĩ JS chạy “all at once”

Sai:

- JS không chạy toàn bộ code cùng lúc

---

### 2. Nhầm Memory Phase là execution

Sai:

- Memory Phase chỉ setup
- Execution Phase mới chạy logic

---

## Edge Cases

### 1. Function hoisting + execution mismatch

```javascript id="ep31"
sayHi();

var sayHi = function () {
  console.log("hi");
};
```

Output:

```text id="ep32"
TypeError
```

---

### 2. Temporal Dead Zone interaction

```javascript id="ep33"
console.log(a);
let a = 10;
```

Error:

```text id="ep34"
ReferenceError
```

---

## Real World

### React rendering flow

```javascript id="ep35"
function App() {
  let state = 0;
  state++;
  return state;
}
```

Execution Phase:

- component function runs line-by-line

---

### Node.js script execution

```javascript id="ep36"
console.log("start");
require("./module");
console.log("end");
```

---

## Engine Internals

V8 pipeline:

```text id="ep37"
Parsing
  ↓
Memory Creation Phase
  ↓
Execution Phase
  ↓
Bytecode execution
```

Execution engine:

```text id="ep38"
Instruction Pointer:
  executes line-by-line
  updates memory state
```

Call stack:

```text id="ep39"
Global EC
  ↓ function EC
  ↓ nested EC
```

---

## Related Concepts

- Execution Context → container of execution phase
- Memory Creation Phase → setup before execution
- Call Stack → manages execution contexts
- Event Loop → schedules execution phases
- Lexical Environment → variable resolution during execution

---

## Learn Next

- Call Stack
- Event Loop
- Closure
- Microtask Queue
- Execution Context Lifecycle

---

## Summary

Execution Phase là giai đoạn JavaScript thực thi code sau khi Memory Creation Phase đã hoàn tất, nơi tất cả statements được chạy theo thứ tự từ trên xuống dưới.

Quan trọng:

- Code chạy line-by-line
- Biến đã được chuẩn bị từ Memory Phase
- Function calls tạo execution context mới
- Đây là giai đoạn quyết định hành vi runtime thực tế

Điều quan trọng nhất: JavaScript không “chạy cùng lúc”, mà chạy từng dòng trong Execution Phase dựa trên trạng thái đã được thiết lập trước đó.
