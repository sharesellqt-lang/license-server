---
id: scope-chain
title: Scope Chain
category: javascript
tags: [javascript, scope, scope-chain, lexical-environment, closure, execution-context]
summary: Scope Chain là cơ chế JavaScript dùng để tìm biến bằng cách đi qua chuỗi các Lexical Environment từ trong ra ngoài.
difficulty: intermediate
importance: 5
estimated_time: "25min"
---

# Scope Chain

## Definition

**Scope Chain** là cơ chế trong JavaScript engine dùng để **tìm kiếm biến bằng cách lần theo chuỗi các Lexical Environment từ scope hiện tại ra scope cha**.

Nó hoạt động dựa trên Lexical Environment:

> Scope Chain = chuỗi các Lexical Environment liên kết với nhau qua thuộc tính `outer`

---

## Intuition

Hãy tưởng tượng bạn đang tìm một cuốn sách:

- Bạn tìm trong phòng của mình trước
- Không có → sang phòng khách
- Không có nữa → lên thư viện lớn hơn
- Cuối cùng là “global library”

👉 Scope Chain chính là cách JS “đi tìm biến theo tầng”

Quan trọng:
- JS không nhảy lung tung
- JS chỉ đi theo 1 đường thẳng lên trên

---

## Mental Model

Mỗi function tạo ra một “scope box”:

```
[Local Scope]
   ↓
[Outer Scope]
   ↓
[Global Scope]
```

Mỗi box chứa:
- Variables
- Functions
- Reference đến outer scope

---

## Example

```js
const a = 1;

function outer() {
  const b = 2;

  function inner() {
    const c = 3;
    console.log(a, b, c);
  }

  inner();
}

outer();
```

### How lookup works:

- `c` → found in inner scope
- `b` → not found → go outer()
- `a` → not found → go global

---

## Execution Flow

When `inner()` runs:

```
inner Scope
   ↓ (not found b, a)
outer Scope
   ↓ (not found a)
Global Scope
```

Variable resolution stops at first match.

---

## Deep Dive

### Scope Chain is NOT created at runtime randomly

It is created at **lexical time (when code is written)**.

```js
function A() {
  function B() {
    function C() {
      console.log(x);
    }
  }
}
```

Even before execution:
- C already “knows” its outer scope is B → A → global

---

## Closures + Scope Chain

Scope Chain is what enables closures:

```js
function create() {
  let x = 10;

  return function () {
    console.log(x);
  };
}

const fn = create();
fn(); // 10
```

Even after `create()` finished:
- Scope Chain is still preserved in memory

---

## Visualization

```
Global Scope
   ↓
create() Scope
   ↓
anonymous function Scope
```

Each scope keeps pointer to its parent.

---

## Common Mistakes

### 1. Expecting sibling scope access

```js
function a() {
  const x = 1;
}

function b() {
  console.log(x); // ❌ ReferenceError
}
```

Siblings do NOT share scope.

---

### 2. Thinking scope depends on call location

```js
function outer() {
  const x = 10;
  inner();
}

function inner() {
  console.log(x); // ❌ not accessible
}
```

Scope is lexical, not dynamic.

---

## Edge Cases

### 1. Shadowing

```js
const x = 1;

function test() {
  const x = 2;
  console.log(x); // 2
}
```

Inner scope overrides outer scope.

---

### 2. Block scope inside scope chain

```js
if (true) {
  let x = 10;
}
console.log(x); // ❌ not defined
```

Block creates its own lexical scope.

---

## Performance Notes

- Scope Chain lookup is linear
- Deep nesting = slower lookup
- Engines optimize with:
  - scope flattening
  - hidden class optimization
  - inline caching

---

## Real World Usage

### 1. Module encapsulation

```js
const module = (() => {
  let count = 0;

  return {
    inc() {
      count++;
      return count;
    }
  };
})();
```

Scope Chain keeps `count` private.

---

### 2. Event callbacks

```js
function setup() {
  const message = "hello";

  document.onclick = function () {
    console.log(message);
  };
}
```

Callback still accesses outer scope.

---

## Engine Internals

When JS runs:

1. Creates Global Scope
2. Each function call creates new scope
3. Scope links to parent via `outer`
4. Variable lookup walks Scope Chain

Garbage Collection:
- If no reference to scope → it is removed
- If closure exists → scope is retained

---

## Common Bugs

- Accidentally relying on outer variables
- Unexpected closure retention causing memory leaks
- Variable shadowing confusion

---

## Related Concepts

- Lexical Environment
- Closure
- Execution Context
- Call Stack
- Hoisting

---

## Learn Next

- lexical-environment.md
- closure.md
- execution-context.md
- hoisting.md
- call-stack.md

---

## Summary

- Scope Chain is how JS resolves variables
- It links nested lexical environments
- Lookup goes from inner → outer → global
- It is lexical (based on code position)
- It enables closures and encapsulation
