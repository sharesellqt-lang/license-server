---
id: memory-creation-phase
title: Memory Creation Phase
order: 9
category: javascript

tags: 
  - javascript
  - execution-context
  - hoisting
  - memory-model
  - variable-environment
summary: Memory Creation Phase is the stage where JavaScript sets up variables, functions, and scope before code execution begins.

difficulty: intermediate
importance: high
estimated_time: 40min
prerequisites: 
  - execution-context
  - call-stack
  - hoisting
related: 
  - execution-context
  - scope-chain
  - hoisting
next: 
  - execution-phase
  - lexical-environment
---

# Memory Creation Phase

## Definition

Memory Creation Phase là giai đoạn đầu tiên khi JavaScript tạo Execution Context. Trong giai đoạn này, engine chưa chạy code dòng lệnh, mà chỉ “chuẩn bị bộ nhớ” cho biến, function và scope.

Ví dụ:

```javascript id="mc1"
console.log(a);
var a = 10;

function foo() {
  return "hello";
}
```

Output:

```text id="mc1-out"
undefined
```

Giải thích:

- `a` được tạo trong memory phase với giá trị `undefined`
- function `foo` được hoist toàn bộ

Flow:

```text id="mc-flow"
Creation Phase → Execution Phase
```

---

## Intuition

Hãy tưởng tượng bạn mở một nhà hàng.

Trước khi phục vụ khách:

- bạn đặt bàn
- chuẩn bị menu
- setup bếp

Ví dụ đời thực:

```text id="int1"
Chuẩn bị (memory creation)
  ↓
Phục vụ khách (execution)
```

JavaScript cũng vậy:

```javascript id="int2"
console.log(order);

var order = "pizza";
```

Bạn chưa “nấu”, chỉ mới “setup”.

---

## Mental Model

Execution Context gồm 2 phase:

```text id="mm1"
1. Memory Creation Phase
2. Execution Phase
```

Memory layout:

```text id="mm2"
Global Execution Context
 ├── Variable Environment
 │     ├── var a = undefined
 │     ├── function foo() {...}
 ├── Scope Chain
 └── this binding
```

Ví dụ:

```javascript id="mm3"
function test() {
  var x = 10;
  var y = 20;
}
```

Memory phase:

```text id="mm4"
test EC:
  x → undefined
  y → undefined
```

---

## Why It Exists

JavaScript cần Memory Creation Phase để:

### 1. Đảm bảo hoisting behavior

Ví dụ:

```javascript id="why1"
console.log(a);
var a = 5;
```

Output:

```text id="why1-out"
undefined
```

Nếu không có memory phase → code sẽ crash.

---

### 2. Setup function availability

```javascript id="why2"
sayHi();

function sayHi() {
  console.log("hi");
}
```

Output:

```text id="why2-out"
hi
```

Function được lưu hoàn chỉnh ngay từ memory phase.

---

## Example

### var vs let trong memory phase

```javascript id="ex1"
console.log(a);
// console.log(b); // TDZ error

var a = 10;
let b = 20;
```

Output:

```text id="ex1-out"
undefined
```

Memory behavior:

```text id="ex1-mem"
var a → undefined
let b → <uninitialized> (TDZ)
```

---

## Execution Flow

JavaScript chạy qua 2 bước:

```text id="flow1"
1. Memory Creation Phase
2. Execution Phase
```

Chi tiết:

```text id="flow2"
Global Context created
  ↓
Memory allocated:
  var → undefined
  function → full reference
  let/const → TDZ
  ↓
Execution starts line by line
```

Ví dụ:

```javascript id="flow3"
var x = 1;
function foo() {}
let y = 2;
```

Flow:

```text id="flow4"
Memory Phase:
  x → undefined
  foo → function reference
  y → TDZ

Execution Phase:
  x = 1
  y = 2
```

---

## Visualization

Memory table:

```text id="vis1"
Before execution:

x → undefined
foo → function()
y → TDZ
```

Stack view:

```text id="vis2"
Call Stack:
  Global Execution Context
    Memory Phase Ready
```

---

## Deep Dive

Memory Creation Phase tạo ra Lexical Environment:

```javascript id="deep1"
function outer() {
  var a = 10;
  let b = 20;
}
```

Internal structure:

```text id="deep2"
outer EC:
  Variable Environment:
    a → undefined
    b → <uninitialized>
  Outer Environment Reference → Global
```

Hoisting rules:

| Type     | Memory Phase Behavior |
| -------- | --------------------- |
| var      | undefined             |
| let      | TDZ                   |
| const    | TDZ                   |
| function | fully initialized     |

---

## Performance

Memory Creation Phase ảnh hưởng:

### 1. Startup cost

```javascript id="perf1"
function heavy() {
  var a = new Array(1000000);
}
```

Memory allocation upfront.

### 2. Optimization by engines

V8 tối ưu bằng:

- lazy initialization
- register allocation

---

## Common Bugs

### 1. Using var before assignment

```javascript id="bug1"
console.log(x);
var x = 10;
```

Output:

```text id="bug1-out"
undefined
```

---

### 2. TDZ error

```javascript id="bug2"
console.log(y);
let y = 10;
```

Output:

```text id="bug2-out"
ReferenceError
```

---

## Common Mistakes

### Thinking let behaves like var

```javascript id="mist1"
console.log(a);
let a = 5;
```

Wrong expectation:

- expect undefined

Reality:

- ReferenceError due to TDZ

---

## Edge Cases

### Function inside block

```javascript id="edge1"
{
  function test() {
    return "ok";
  }
}
```

Behavior depends on strict mode and engine.

---

### Multiple declarations

```javascript id="edge2"
var a = 1;
var a = 2;
```

Memory phase merges declarations.

---

## Real World

### React rendering phase

```javascript id="real1"
function Component() {
  const state = useState(0);
  return <div />;
}
```

Before render:

- memory setup for hooks

---

### Node.js module loading

```javascript id="real2"
const fs = require("fs");
```

Memory phase:

- module scope initialized before execution

---

## Engine Internals

V8 execution model:

```text id="engine1"
Parsing
  ↓
AST Creation
  ↓
Execution Context Creation
  ↓
Memory Creation Phase
  ↓
Execution Phase
```

Memory layout:

```text id="engine2"
Heap:
  objects

Stack:
  execution contexts

Lexical Environment:
  variable bindings
```

---

## Related Concepts

- Execution Context: Memory phase là bước đầu tiên
- Hoisting: kết quả của memory creation
- Scope Chain: dùng trong resolution sau khi memory setup
- TDZ: trạng thái chưa khởi tạo của let/const

---

## Learn Next

- Execution Phase
- Hoisting deep dive
- TDZ mechanics
- Lexical Environment
- Call Stack behavior

---

## Summary

Memory Creation Phase là giai đoạn JavaScript engine chuẩn bị toàn bộ bộ nhớ cho variables, functions và scope trước khi code chạy. Nó quan trọng vì giải thích hoisting, TDZ, và cách execution context hoạt động. JavaScript không chạy code ngay lập tức mà luôn setup memory trước, và điều này quyết định cách biến được truy cập trong toàn bộ runtime.
