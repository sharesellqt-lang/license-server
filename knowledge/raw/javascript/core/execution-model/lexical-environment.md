---
id: lexical-environment
title: Lexical Environment
order: 7
category: javascript

tags: 
  - lexical-scope
  - execution-context
  - scope-chain
  - javascript-runtime
  - closure
  - variable-resolution
summary: Lexical Environment is the internal structure used by JavaScript engines to store variable bindings and resolve identifiers based on where code is physically written.

difficulty: intermediate
importance: high
estimated_time: 50min
prerequisites: 
  - execution-context
  - global-execution-context
  - hoisting
  - scope-chain-basics
related: 
  - execution-context
  - variable-environment
  - scope-chain
  - closure
next: 
  - closure
  - scope-chain
  - this-binding
---

# Lexical Environment

## Definition

Lexical Environment là cấu trúc nội bộ trong JavaScript engine dùng để quản lý **bindings (biến, function, const, let)** dựa trên **vị trí viết code (lexical position)**, không phải nơi hàm được gọi.

Mỗi Execution Context đều chứa một Lexical Environment.

Ví dụ:

```javascript id="le1"
let x = 10;

function outer() {
  let y = 20;

  function inner() {
    console.log(x + y);
  }

  inner();
}

outer();
```

Output:

```text id="le2"
30
```

Giải thích:

- inner tìm `y` trong outer Lexical Environment
- không có → đi ra global Lexical Environment để tìm `x`

---

## Intuition

Hãy tưởng tượng Lexical Environment như hệ thống “phòng làm việc có tủ hồ sơ riêng”.

Ví dụ đời thực:

- mỗi phòng (function) có tài liệu riêng
- nếu không có → đi sang phòng cha

```javascript id="le3"
function roomA() {
  let document = "A";

  function roomB() {
    console.log(document);
  }

  roomB();
}

roomA();
```

Output:

```text id="le4"
A
```

Trực giác:

- roomB không có document
- nhưng có thể “mượn” từ roomA

---

## Mental Model

Lexical Environment = 2 phần chính:

```text id="le5"
Lexical Environment = {
  Environment Record: {
    bindings (variables, functions)
  },
  Outer Reference: <parent lexical environment>
}
```

Ví dụ:

```javascript id="le6"
let a = 1;

function f1() {
  let b = 2;

  function f2() {
    let c = 3;
  }
}
```

Mô hình:

```text id="le7"
Global LE
  ↓
f1 LE
  ↓
f2 LE
```

Scope chain:

```text id="le8"
f2 → f1 → global
```

---

## Why It Exists

### 1. Variable resolution theo lexical scope

```javascript id="le9"
let x = 100;

function test() {
  console.log(x);
}

test();
```

Nếu không có lexical environment → không biết x nằm ở đâu.

---

### 2. Hỗ trợ nested functions

```javascript id="le10"
function A() {
  let x = 1;

  function B() {
    function C() {
  console.log(x);
    }
    C();
  }

  B();
}
A();
```

---

### 3. Nền tảng của closure

```javascript id="le11"
function outer() {
  let count = 0;

  return function inner() {
    count++;
    return count;
  };
}

const fn = outer();
fn();
fn();
```

Output:

```text id="le12"
1
2
```

---

## Example

```javascript id="le13"
function parent() {
  let message = "Hello Lexical Environment";

  function child() {
    console.log(message);
  }

  child();
}

parent();
```

Output:

```text id="le14"
Hello Lexical Environment
```

---

## Execution Flow

```text id="le15"
1. Create Global Execution Context
2. Create Global Lexical Environment
   - x = 10
   - outer = function
3. Call outer()
4. Create outer Lexical Environment
   - y = 20
5. Call inner()
6. Create inner Lexical Environment (empty bindings)
7. Resolve variables:
   - y found in outer LE
   - x found in global LE
8. Execute console.log
```

Flow:

```text id="le16"
inner LE
  ↓ not found
outer LE
  ↓ found y
global LE
  ↓ found x
```

---

## Visualization

Lexical Environment Chain:

```text id="le17"
GLOBAL LE
  ↓
outer LE
  ↓
inner LE
```

Memory view:

```text id="le18"
GLOBAL:
  x = 10
  outer → function

outer:
  y = 20

inner:
  (empty)
```

---

## Deep Dive

### 1. Environment Record

```javascript id="le19"
function test() {
  let a = 1;
  const b = 2;
  var c = 3;
}
```

Environment Record:

```text id="le20"
a → 1
b → 2
c → 3
```

---

### 2. Outer Lexical Reference

```javascript id="le21"
function A() {
  function B() {
    function C() {}
  }
}
```

Chain:

```text id="le22"
C → B → A → Global
```

---

### 3. Variable resolution algorithm

```javascript id="le23"
let x = 10;

function f() {
  console.log(x);
}
```

Steps:

```text id="le24"
1. check local LE
2. if not found → outer LE
3. repeat until global
```

---

## Performance

### 1. Deep scope chain cost

```javascript id="le25"
function a() {
  function b() {
    function c() {
  function d() {
  console.log("deep lookup");
  }
    }
  }
}
```

Cost:

- lookup nhiều tầng → tăng overhead nhỏ

---

### 2. Closure memory retention

```javascript id="le26"
function outer() {
  let big = new Array(1000000);

  return function inner() {
    return big[0];
  };
}
```

---

## Common Bugs

### 1. Unexpected ReferenceError

```javascript id="le27"
function test() {
  console.log(x);
}
test();
```

---

### 2. Shadowing variable

```javascript id="le28"
let x = 10;

function test() {
  let x = 20;
  console.log(x);
}
test();
```

Output:

```text id="le29"
20
```

---

## Common Mistakes

### 1. Nghĩ JS tìm biến theo nơi gọi

Sai:

```javascript id="le30"
let x = 10;

function f() {
  console.log(x);
}

function g() {
  let x = 20;
  f();
}

g();
```

Output:

```text id="le31"
10
```

---

### 2. Nhầm lexical scope với dynamic scope

JS KHÔNG dùng dynamic scope.

---

## Edge Cases

### 1. Block scope interaction

```javascript id="le32"
{
  let x = 1;
}
console.log(x);
```

Error:

```text id="le33"
ReferenceError
```

---

### 2. Closure giữ reference, không giữ snapshot

```javascript id="le34"
function outer() {
  let obj = { value: 1 };

  return function inner() {
    return obj;
  };
}
```

---

## Real World

### React hooks closure trap

```javascript id="le35"
function Component() {
  let count = 0;

  setTimeout(() => {
    console.log(count);
  }, 1000);
}
```

---

### Event listeners

```javascript id="le36"
function init() {
  let user = "JS Engine";

  document.addEventListener("click", () => {
    console.log(user);
  });
}
```

---

## Engine Internals

V8 model:

```text id="le37"
Execution Context
  ↓
Lexical Environment
  ↓
Environment Record
  ↓
Outer Lexical Reference
```

Lookup process:

```text id="le38"
current LE
  ↓ not found
outer LE
  ↓ not found
global LE
```

---

## Related Concepts

- Execution Context → container của Lexical Environment
- Scope Chain → chuỗi lookup
- Closure → giữ Lexical Environment sau execution
- Hoisting → ảnh hưởng initialization trong Environment Record

---

## Learn Next

- Closure
- Scope Chain
- This Binding
- Variable Environment
- Event Loop

---

## Summary

Lexical Environment là cấu trúc cốt lõi của JavaScript dùng để lưu trữ bindings và thực hiện variable resolution dựa trên vị trí viết code.

Quan trọng:

- Mỗi execution context có lexical environment riêng
- Lookup biến đi theo scope chain (outer references)
- Là nền tảng của closures
- Quyết định cách JavaScript resolve variables trong runtime

Điều quan trọng nhất: JavaScript luôn tìm biến theo **lexical position**, không phải theo nơi hàm được gọi.
