---
````md
---

id: how-js-executes-code
title: How JS Executes Code
order: 999
category: javascript

tags:

- javascript
- execution-context
- call-stack
- event-loop
- v8

summary: JavaScript execution is a multi-layer runtime process involving parsing, execution contexts, call stack, memory heap, and event loop coordination. It is critical because it defines how synchronous and asynchronous code actually runs, and understanding it prevents race conditions, stack overflows, and async bugs.

difficulty: intermediate
importance: high
estimated_time: 45min

prerequisites:

- variables-and-scope
- functions-in-javascript
- asynchronous-javascript

related:

- execution-context
- call-stack
- event-loop

next:

- event-loop-deep-dive

---

# How JS Executes Code

## Definition

JavaScript execution is the full lifecycle of how code is transformed into executable instructions inside a JS engine (like V8). It includes parsing, creating execution contexts, managing memory, executing synchronous code via the call stack, and delegating asynchronous work to Web APIs or Node APIs.

Example:

```js
function add(a, b) {
  return a + b;
}

console.log(add(2, 3));
````

Output:

```text
5
```

Even this simple code goes through parsing → memory allocation → execution context creation → stack execution → output.

Example mental snapshot:

```text
Code → AST → Execution Context → Call Stack → Output
```

---

## Intuition

Imagine a single chef in a kitchen.

Only one dish is cooked at a time, and everything must go through the chef.

Example:

```js
console.log("A");
console.log("B");
```

Output:

```text
A
B
```

Real-world mapping:

```text
Chef        → Call Stack
Orders      → Function calls
Ingredients → Memory (heap)
Delivery    → Async callbacks
```

Even if multiple orders arrive at once, only one is processed at a time.

---

## Mental Model

JavaScript runtime is a coordinated system:

```text
Source Code
   ↓
Parser (AST)
   ↓
Global Execution Context
   ↓
Call Stack (sync execution)
   ↓
Heap (memory storage)
   ↓
Web/Node APIs (async work)
   ↓
Event Loop
   ↓
Task Queues
```

Example:

```js
let x = 10;

function double(n) {
  return x * n;
}

double(5);
```

Execution model:

```text
Global Context:
x = 10
double stored in memory

Call Stack:
double(5)
→ returns 50
→ popped
```

---

## Why It Exists

JavaScript runs in environments like browsers where blocking execution freezes UI.

Example:

```js
console.log("Start");

setTimeout(() => {
  console.log("Delayed");
}, 1000);

console.log("End");
```

Output:

```text
Start
End
Delayed
```

Without async delegation:

```text
UI freezes → no clicks → bad UX
```

So JS offloads long tasks instead of blocking the call stack.

---

## Example

```js
var a = 2;

function square(n) {
  var result = n * n;
  return result;
}

console.log(square(a));
```

Output:

```text
4
```

Execution flow:

```text
1. Global Execution Context created
2. a = undefined → 2
3. square stored in memory
4. square(a) invoked
5. new Function Execution Context created
6. result computed
7. returned to global context
```

---

## Execution Flow

```text
Parsing Phase
   ↓
Memory Creation Phase (hoisting)
   ↓
Execution Phase
   ↓
Function Call → New Execution Context
   ↓
Push to Call Stack
   ↓
Execute function
   ↓
Pop from Call Stack
   ↓
Async tasks → Web APIs
   ↓
Event Loop → Queue → Call Stack
```

Example:

```js
function a() {
  b();
}

function b() {
  console.log("Hello");
}

a();
```

Flow:

```text
Global
 → a()
    → b()
  → console.log()
 → unwind
```

---

## Visualization

Call Stack:

```text
| console.log |
| b()         |
| a()         |
| Global      |
```

After execution:

```text
| Global |
```

Async system:

```text
Call Stack     Web APIs      Queue
----------     --------      -----
run code
setTimeout → timer runs → callback stored
stack empty → event loop → callback pushed
```

---

## Deep Dive

### Memory Creation Phase

```js
console.log(a);
var a = 10;
```

Memory phase:

```text
a = undefined
```

Execution phase:

```text
console.log(undefined)
a = 10
```

Output:

```text
undefined
```

---

### Execution Context Structure

Each function creates:

- Variable environment
- Lexical environment
- This binding

Example:

```js
function multiply(x) {
  let y = 2;
  return x * y;
}

multiply(5);
```

Flow:

```text
multiply context created
x = 5
y = 2
return 10
context destroyed
```

---

## Performance

Performance depends on:

- Call stack depth
- Heap allocations
- Async queue pressure

Example bad recursion:

```js
function crash() {
  crash();
}

crash();
```

Output:

```text
RangeError: Maximum call stack size exceeded
```

Better:

```js
function loop() {
  for (let i = 0; i < 1e6; i++) {}
}

loop();
```

Trade-off:

- recursion: expressive but risky
- iteration: safer but less elegant

---

## Common Bugs

### Hoisting bug

```js
console.log(a);
var a = 10;
```

Output:

```text
undefined
```

---

### Async timing bug

```js
let value;

setTimeout(() => {
  value = 42;
}, 0);

console.log(value);
```

Output:

```text
undefined
```

---

## Common Mistakes

Assuming async is synchronous:

```js
let user;

fetch("/api").then(() => {
  user = "John";
});

console.log(user);
```

Output:

```text
undefined
```

Mistake: expecting immediate execution.

---

## Edge Cases

Block scope behavior:

```js
if (true) {
  let x = 10;
}

console.log(x);
```

Error:

```text
ReferenceError
```

---

Nested execution contexts:

```js
function outer() {
  function inner() {
    return "done";
  }
  return inner();
}

outer();
```

Each call creates a stack frame.

---

## Real World

React rendering:

```js
function App() {
  console.log("Render");
  return "UI";
}

App();
```

Each render:

- execution context created
- function executed
- UI returned

Node.js server:

```js
const http = require("http");

http.createServer((req, res) => {
  res.end("OK");
}).listen(3000);
```

Each request:

- callback enters event loop
- execution context created
- response returned

---

## Engine Internals

V8 pipeline:

```text
JS Code
 ↓
Parser → AST
 ↓
Ignition (interpreter)
 ↓
Bytecode
 ↓
TurboFan (compiler)
 ↓
Machine Code
```

Memory model:

```text
Stack → execution contexts
Heap  → objects
```

Example:

```js
let obj = { a: 1 };
```

- object stored in heap
- reference stored in stack

---

## Related Concepts

- Execution Context: runtime environment where code runs inside the call stack.
- Call Stack: LIFO structure managing synchronous execution order.
- Event Loop: system moving async callbacks into the call stack.
- Memory Heap: storage for objects and dynamic allocations.

---

## Learn Next

- Event Loop Deep Dive: learn microtasks vs macrotasks scheduling and priority.
- Closures: understand how execution contexts persist after function return.
- Garbage Collection: learn how V8 frees unused heap memory automatically.

---

## Summary

JavaScript execution is a structured runtime system that transforms code into execution contexts managed by the call stack while using a heap for memory and an event loop for asynchronous operations. It is important because it determines how all JS programs behave in real environments. The key idea is that JavaScript is single-threaded but capable of async execution through delegation and scheduling mechanisms rather than parallel execution.

```
```

```