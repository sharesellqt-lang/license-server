---
id: scope-chain
title: Scope Chain
order: 8
category: javascript

tags: 
  - javascript
  - scope
  - lexical-scope
  - closures
  - execution-context
summary: Scope Chain is the mechanism JavaScript uses to resolve variable lookups through nested lexical environments.

difficulty: intermediate
importance: high
estimated_time: 40min
prerequisites: 
  - execution-context
  - lexical-scope
  - call-stack
related: 
  - closures
  - hoisting
  - variable-environment
next: 
  - closures
  - this-binding
---

# Scope Chain

## Definition

Scope Chain là cơ chế JavaScript dùng để tìm và resolve biến khi code được thực thi. Khi một biến được truy cập, JavaScript sẽ tìm trong scope hiện tại trước, nếu không thấy thì tiếp tục tìm trong scope cha, rồi tiếp tục đi lên global scope cho đến khi tìm thấy hoặc kết thúc.

Ví dụ:

```javascript
const a = 10;

function outer() {
  const b = 20;

  function inner() {
    const c = 30;

    console.log(a); // global scope
    console.log(b); // outer scope
    console.log(c); // inner scope
  }

  inner();
}

outer();
```

Output:

```
10
20
30
```

Flow lookup:

```
inner → outer → global
```

---

## Intuition

Hãy tưởng tượng bạn đang tìm một đồ vật trong nhà nhiều tầng.

Ví dụ đời thực:

```
Phòng ngủ (inner scope)
  ↓ không thấy remote
Phòng khách (outer scope)
  ↓ không thấy
Nhà kho (global scope)
  ↓ tìm thấy
```

JavaScript hoạt động giống hệt:

```javascript
const theme = "dark";

function page() {
  function header() {
    console.log(theme);
  }

  header();
}

page();
```

Output:

```
dark
```

---

## Mental Model

Scope Chain = chuỗi các Lexical Environment liên kết với nhau.

```text
[Inner Scope]
  ↓
[Outer Scope]
  ↓
[Global Scope]
  ↓
null
```

Ví dụ:

```javascript
function A() {
  const x = 1;

  function B() {
    const y = 2;

    function C() {
  const z = 3;
  console.log(x + y + z);
    }

    C();
  }

  B();
}

A();
```

Lookup flow:

```
C → B → A → Global
```

---

## Why It Exists

Scope Chain tồn tại để giải quyết bài toán variable resolution trong nested functions mà không cần copy toàn bộ biến.

Ví dụ vấn đề nếu không có scope chain:

```javascript
function outer() {
  const bigData = new Array(1000000).fill(1);

  function inner() {
    console.log(bigData.length);
  }

  inner();
}
```

Nếu không có scope chain:

- inner phải copy bigData → cực kỳ tốn bộ nhớ

Nhờ scope chain:

- inner chỉ giữ reference tới outer scope

---

## Example

Shadowing + scope chain:

```javascript
const value = "global";

function first() {
  const value = "first";

  function second() {
    const value = "second";

    function third() {
  console.log(value);
    }

    third();
  }

  second();
}

first();
```

Output:

```
second
```

Giải thích:

- third không có value
- tìm lên second trước
- dừng tại match đầu tiên

---

## Execution Flow

JavaScript tạo execution context cho mỗi function:

```text
Global Context
  value = "global"

first()
  Context:
    value = "first"

second()
  Context:
    value = "second"

third()
  Context:
    (no value)
```

Lookup flow:

```
third → second → first → global
```

---

## Visualization

Scope tree:

```text
Global
 └── first
  └── second
  └── third
```

Variable lookup:

```text
third scope
  ↓ not found
second scope
  ↓ found
return value
```

---

## Deep Dive

Scope Chain thực chất là chain của Lexical Environment objects.

```javascript
function outer() {
  let a = 10;

  function inner() {
    let b = 20;
    console.log(a + b);
  }

  inner();
}
```

Internal structure:

```text
inner Lexical Environment
  - b = 20
  - Outer → outer Lexical Environment

outer Lexical Environment
  - a = 10
  - Outer → Global Lexical Environment
```

Lookup algorithm:

```
1. Check local environment
2. If not found → go outer reference
3. Repeat until null
```

---

## Performance

Scope chain lookup cost depends on depth.

Example deep nesting:

```javascript
let a = 1;

function l1() {
  function l2() {
    function l3() {
  function l4() {
  console.log(a);
  }
  l4();
    }
    l3();
  }
  l2();
}

l1();
```

Lookup path:

```
l4 → l3 → l2 → l1 → global
```

Impact:

- deeper chain = slower lookup
- modern engines optimize via inline caching

---

## Common Bugs

### 1. Shadowing confusion

```javascript
const x = 10;

function test() {
  const x = 20;
  console.log(x);
}

test(); // 20
```

### 2. Accidental global leak

```javascript
function foo() {
  y = 100; // no declaration
}

foo();
console.log(globalThis.y); // 100
```

---

## Common Mistakes

### Thinking function uses caller scope

```javascript
const a = 1;

function A() {
  console.log(a);
}

function B() {
  const a = 999;
  A();
}

B(); // 1, not 999
```

---

## Edge Cases

### Block scope vs function scope

```javascript
{
  let a = 10;
}

console.log(a); // ReferenceError
```

### Temporal Dead Zone

```javascript
console.log(a); // ReferenceError
let a = 10;
```

---

## Real World

Closure example (React-like hook):

```javascript
function useCounter() {
  let count = 0;

  return function increment() {
    count++;
    console.log(count);
  };
}

const inc = useCounter();

inc(); // 1
inc(); // 2
```

Node.js middleware:

```javascript
function createLogger(prefix) {
  return function (req) {
    console.log(prefix, req.url);
  };
}
```

---

## Engine Internals

V8 engine representation:

```text
Call Stack
  ↓
Execution Context
  ↓
Lexical Environment
  ↓
Outer Reference Chain
```

Optimization techniques:

- inline caching
- hidden classes
- scope flattening

Example optimized function:

```javascript
function sum() {
  const a = 1;
  const b = 2;
  return a + b;
}
```

Engine may store `a`, `b` in registers instead of chain lookup.

---

## Related Concepts

- **Closures**: scope chain enables functions to remember outer variables.
- **Lexical Scope**: defines how scope chain is formed.
- **Execution Context**: creates scope environments.
- **Hoisting**: affects visibility inside scope chain.

---

## Learn Next

- Closures
- Execution Context deep dive
- Hoisting mechanics
- This binding rules
- Call stack vs scope chain

---

## Summary

Scope Chain là cơ chế JavaScript dùng để resolve biến bằng cách đi qua chuỗi lexical environments từ scope hiện tại lên scope cha cho đến global scope. Nó quan trọng vì quyết định cách variable lookup hoạt động, là nền tảng cho closures và lexical scoping, và ảnh hưởng trực tiếp đến hành vi runtime của code. Điều quan trọng nhất cần nhớ là JavaScript luôn tìm biến theo nơi khai báo (lexical scope), không phải nơi gọi, và scope chain chính là cơ chế thực thi điều đó.
