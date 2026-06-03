---

---

# Untitled

id: v8-basics
title: V8 Engine Basics
category: javascript
tags:
- javascript
- v8
- engine
- runtime
- jit
- garbage-collection
- hidden-classes
summary: Hiểu cách V8 engine hoạt động bên trong, từ parsing, bytecode, JIT compilation đến optimization và garbage collection.
difficulty: intermediate
importance: high
estimated_time: 50 min

### V8 Engine Basics

## Definition

V8 là JavaScript engine được phát triển bởi Google.

Nó dùng để:

- parse JavaScript
- compile JavaScript
- execute JavaScript
- optimize performance
- manage memory

V8 là engine của:

- Google Chrome
- Node.js
- Electron
- nhiều runtime hiện đại khác

## Intuition

JavaScript chỉ là text:
```js
const x = 10;
````

CPU không hiểu JavaScript.

CPU chỉ hiểu:
```txt id="c2udl0"
machine code
```

V8 tồn tại để:
```txt id="wmy2r7"
JavaScript
→ machine code
→ CPU
```

Mental model:
```txt id="67j3cx"
V8 = translator + optimizer + memory manager
```

### Why V8 quan trọng?

Trước đây JavaScript rất chậm.

Nó chỉ được xem là:
```txt id="7ehgdc"
scripting language cho browser
```

V8 thay đổi điều đó bằng:

- JIT compilation
- optimization pipeline
- hidden classes
- inline caching
- efficient garbage collection

Đó là lý do:
```txt id="r5mzrb"
Node.js tồn tại được
```

## Visualization
```txt id="8h2u0x"
JavaScript Source
        │
        ▼
┌─────────────────┐
│     Parser      │
└────────┬────────┘
         ▼
┌─────────────────┐
│       AST       │
└────────┬────────┘
         ▼
┌─────────────────┐
│    Ignition     │
│  Interpreter    │
└────────┬────────┘
         ▼
┌─────────────────┐
│    Bytecode     │
└────────┬────────┘
         ▼
┌─────────────────┐
│     TurboFan    │
│ Optimizing JIT  │
└────────┬────────┘
         ▼
Machine Code
```

### High Level Architecture

V8 gồm nhiều subsystem:

| Component         | Responsibility      |
| ----------------- | ------------------- |
| Parser            | Parse source code   |
| Ignition          | Interpreter         |
| TurboFan          | Optimizing compiler |
| Heap              | Memory storage      |
| Garbage Collector | Cleanup memory      |
| Call Stack        | Function execution  |

### Parsing

Ví dụ:
```js id="9fs2f6"
const total = price * quantity;
```

V8 parse source code thành:
```txt id="kz7c1k"
AST (Abstract Syntax Tree)
```

### AST Visualization
```txt id="4e5l1r"
VariableDeclaration
 └── VariableDeclarator
      ├── Identifier(total)
      └── BinaryExpression(*)
           ├── Identifier(price)
           └── Identifier(quantity)
```

Engine không chạy raw text.

Nó chạy internal structures.

### Ignition Interpreter

Sau parsing:
```txt id="jlwmxs"
AST
→ Bytecode
```

V8 dùng:
```txt id="stxcr8"
Ignition
```

để generate bytecode.

### Bytecode

Ví dụ:
```js id="dpx9g7"
const x = 1 + 2;
```

Bytecode simplified:
```txt id="3ztsmx"
LOAD 1
LOAD 2
ADD
STORE x
```

Bytecode giúp:

- execute nhanh hơn AST
- dễ optimize
- portable hơn machine code

## Execution Flow
```txt id="0m2u1x"
Source Code
→ Parse
→ AST
→ Bytecode
→ Execute
```

## JIT Compilation

### Problem

Interpreter rất flexible nhưng không cực nhanh.

Nếu code chạy nhiều lần:
```js id="92g5xd"
for (let i = 0; i < 1e6; i++) {
    sum(1, 2);
}
```

thì V8 muốn optimize.

### TurboFan

V8 dùng:
```txt id="4nyczz"
TurboFan
```

để optimize hot code.

Flow:
```txt id="7okj8g"
Bytecode
→ profiling
→ optimized machine code
```

### Hot Functions

Function được gọi rất nhiều lần:
```txt id="8wejrb"
hot function
```

Ví dụ:
```js id="2r6f0r"
function add(a, b) {
    return a + b;
}
```

Nếu gọi hàng triệu lần:
```txt id="49h3u4"
V8 optimize aggressively
```

### Deep Dive — Speculative Optimization

V8 optimize dựa trên assumption.

Ví dụ:
```js id="kkm7zv"
function add(a, b) {
    return a + b;
}
```

V8 có thể assume:
```txt id="r7ll4l"
a,b luôn là number
```

và generate machine code riêng cho number.

## Deoptimization

Nếu assumption sai:
```js id="efocsy"
add("a", "b");
```

V8 phải:
```txt id="s0wjhj"
deoptimize
```

quay lại generic path.

## Common Mistakes — Type Instability

Không tốt:
```js id="zq4vq6"
sum(1, 2);
sum("a", "b");
sum({}, []);
```

Engine khó optimize.

### Better Pattern

Tốt hơn:
```js id="9v15zz"
sum(1, 2);
sum(3, 4);
sum(5, 6);
```

Stable types giúp optimization hiệu quả hơn.

### Hidden Classes

JavaScript object dynamic:
```js id="c4m7k5"
const user = {};
user.name = "Alex";
```

Nếu lookup dynamic hoàn toàn sẽ rất chậm.

V8 tạo:
```txt id="frvbx6"
Hidden Classes
```

để optimize property access.

### Example — Stable Object Shape

Tốt:
```js id="3jqk0v"
const user1 = {
    name: "A",
    age: 20
};

const user2 = {
    name: "B",
    age: 30
};
```

Cùng shape:
```txt id="cw8im7"
name
age
```

V8 reuse optimization.

### Common Mistake — Shape Pollution
```js id="mvncbq"
const user = {};

user.name = "A";

if (random) {
    user.age = 20;
}

delete user.name;
```

Object shape thay đổi liên tục.

Engine deoptimize.

## Inline Caching

Ví dụ:
```js id="jz0ybw"
user.name
```

Nếu property luôn cùng vị trí:
```txt id="07ql9m"
V8 cache memory offset
```

Access nhanh hơn rất nhiều.

### Call Stack

Ví dụ:
```js id="pdx4ow"
function a() {
    b();
}

function b() {
    console.log("hello");
}

a();
```

Stack:
```txt id="3h0q5t"
GLOBAL
  a
    b
```

### Heap Memory

Primitive thường nằm stack.

Object thường nằm heap.

Ví dụ:
```js id="js6yem"
const user = {
    name: "Alex"
};
```

Object được allocate trong heap memory.

## Garbage Collection

V8 tự quản lý memory.

Nếu object không còn reachable:
```txt id="grxk7i"
GC sẽ reclaim memory
```

## Deep Dive

Simplified flow:
```txt id="0ptvfj"
1. Mark reachable objects
2. Unmarked objects = garbage
3. Free memory
```

### Example — Memory Leak
```js id="ifh2gl"
const cache = [];

function save() {
    cache.push(new Array(1000000));
}
```

Nếu cache không clear:
```txt id="nr72x3"
memory leak
```

### Deep Dive — Generational GC

V8 chia heap thành:
```txt id="x44v0k"
Young Generation
Old Generation
```

Ý tưởng:
```txt id="9a04zh"
đa số object chết rất sớm
```

Object mới:

- allocate ở young gen
- cleanup rất nhanh

Object sống lâu:

- promote sang old gen

### Event Loop Relationship

V8 KHÔNG tự xử lý:

- timers
- DOM
- network
- rendering

Những cái đó thuộc runtime.

Ví dụ browser runtime:
```txt id="n0a5m7"
V8
+
Web APIs
+
Event Loop
```

### Runtime vs Engine

Sai lầm phổ biến:
```txt id="g2kkbz"
JavaScript = V8
```

Sai.

V8 chỉ là:
```txt id="56q1tw"
engine
```

Runtime còn có:

- Web APIs
- event loop
- rendering
- networking

## Real World — Node.js

Node.js dùng:
```txt id="ijb9zd"
V8 + libuv
```

V8 execute JavaScript.

libuv handle:

- filesystem
- networking
- event loop
- async IO

## Performance Tips

### 1. Stable Object Shapes

Tốt:
```js id="e7ebgj"
const user = {
    name: "",
    age: 0
};
```

### 2. Stable Types

Tốt:
```js id="gby2fr"
sum(1, 2);
sum(3, 4);
```

Không tốt:
```js id="m8twx4"
sum(1, "2");
```

### 3. Tránh Massive Allocation

Không tốt:
```js id="j3tnst"
for (let i = 0; i < 1000000; i++) {
    arr.push({});
}
```

GC pressure rất lớn.

## Common Bugs

### Bug 1 — Stack Overflow
```js id="3o4m0j"
function loop() {
    loop();
}

loop();
```

Error:
```txt id="x8p4ly"
Maximum call stack size exceeded
```

### Bug 2 — Memory Leak
```js id="v6d3jr"
window.data = hugeObject;
```

Reference global giữ object sống mãi.

## Edge Cases

### typeof null
```js id="qk4b7d"
typeof null
```

Kết quả:
```txt id="4ggt1l"
object
```

Historical engine bug.

### NaN
```js id="x3if1p"
typeof NaN
```

Kết quả:
```txt id="q9w5g8"
number
```

## Security

### Prototype Pollution
```js id="ahvh3l"
obj["__proto__"].admin = true;
```

Có thể phá internal object behavior.

## Mental Model
```txt id="c0lqyr"
V8 cố biến JavaScript dynamic
thành code gần giống static language
```

Đó là lý do:

- hidden classes
- inline caching
- speculative optimization
- JIT compilation

tồn tại.

## Related Concepts

- engine-overview.md
- parser-and-ast.md
- hidden-classes.md
- jit-compilation.md
- garbage-collection.md
- event-loop.md
- execution-context.md
- call-stack.md

## Learn Next

Sau bài này nên học:

1. parser-and-ast.md
2. bytecode.md
3. jit-compilation.md
4. hidden-classes.md
5. inline-caching.md
6. garbage-collection.md
7. deoptimization.md

## Summary

V8 là modern JavaScript engine cực kỳ tối ưu.

Pipeline chính:

Source
→ Parser
→ AST
→ Bytecode
→ Interpreter
→ Optimizing Compiler
→ Machine Code
```

Các kỹ thuật quan trọng:

- Ignition Interpreter
- TurboFan
- Hidden Classes
- Inline Caching
- Generational GC
- Speculative Optimization

Điểm quan trọng nhất:
```txt id="1e3mny"
JavaScript dynamic
nhưng V8 cố optimize như static language
```

Đó là lý do JavaScript hiện đại có thể chạy cực nhanh.
```
```

```