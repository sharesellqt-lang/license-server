---
id: hoisting
title: Hoisting in JavaScript
category: javascript
tags: [javascript, hoisting, execution-context, scope, var, let, const]
summary: Hoisting là cơ chế JavaScript đưa khai báo biến và function lên đầu scope trong giai đoạn creation phase của execution context.
difficulty: intermediate
importance: 5
estimated_time: "30min"
---

# Hoisting in JavaScript

## Definition

**Hoisting** là cơ chế trong JavaScript mà trong đó các khai báo:

- `function declarations`
- `var variables`

được “đưa lên đầu scope” trong **Creation Phase của Execution Context** trước khi code được chạy.

👉 Lưu ý quan trọng:

> Hoisting không phải là “di chuyển code vật lý”, mà là cơ chế memory allocation trước khi execution.

---

## Intuition

Hãy tưởng tượng JavaScript như một người dọn phòng trước khi bắt đầu làm việc:

- Trước khi chạy code:
  - tất cả “đồ dùng” (variables, functions) được đặt sẵn lên bàn
- Sau đó mới bắt đầu chạy từng dòng

👉 Nhưng:

- `var` → đặt sẵn nhưng rỗng (undefined)
- `function` → đặt sẵn đầy đủ
- `let/const` → có nhưng bị khóa (TDZ)

---

## Mental Model

```text
Creation Phase:
  - scan toàn bộ code
  - hoist declarations
  - setup memory

Execution Phase:
  - chạy code từng dòng
```

---

## Example

### 1. var hoisting

```js
console.log(a);
var a = 10;
```

### JS hiểu như:

```js
var a;
console.log(a);
a = 10;
```

### Output:

```
undefined
```

---

### 2. function hoisting

```js
foo();

function foo() {
  console.log("Hello");
}
```

### Output:

```
Hello
```

👉 function declaration được hoist full.

---

### 3. let / const (TDZ)

```js
console.log(a);
let a = 10;
```

### Output:

```
ReferenceError
```

👉 Vì nằm trong Temporal Dead Zone.

---

## Execution Flow

```text
1. Creation Phase
   - var a = undefined
   - function foo() ready

2. Execution Phase
   - console.log(a)
   - a = 10
```

---

## Deep Dive

### Hoisting thực chất là gì?

Trong engine (V8):

- Khi tạo Execution Context:
  - quét AST
  - tạo memory bindings
  - phân loại:
    - var → initialized undefined
    - function → fully assigned
    - let/const → uninitialized (TDZ)

---

## Common Bugs

### 1. Unexpected undefined

```js
console.log(user);
var user = "John";
```

👉 output: undefined

---

### 2. Function overwrite bug

```js
function test() {
  console.log("first");
}

function test() {
  console.log("second");
}

test();
```

👉 output: second

---

## Common Mistakes

### 1. Nghĩ let cũng hoist giống var

❌ Sai:

```js
console.log(a);
let a = 5;
```

👉 let có hoisting nhưng không initialize

---

### 2. Nghĩ code chạy từ trên xuống thật sự

JS chạy theo:

- Creation Phase (hoist)
- Execution Phase

không phải line-by-line thuần túy

---

## Edge Cases

### 1. TDZ với block scope

```js
{
  console.log(a);
  let a = 10;
}
```

👉 ReferenceError

---

### 2. function inside block

```js
if (true) {
  function foo() {}
}
```

Behavior có thể khác nhau giữa strict mode / non-strict mode

---

## Performance Notes

Hoisting itself không tốn runtime cost lớn, nhưng:

- ảnh hưởng memory setup phase
- ảnh hưởng scope resolution logic

---

## Real World

Hoisting ảnh hưởng:

- debugging undefined variables
- code readability
- module initialization order
- bundler behavior (webpack, vite)

---

## Related Concepts

- Execution Context
- Scope Chain
- TDZ (Temporal Dead Zone)
- Variable Environment
- Lexical Environment
- Call Stack

---

## Learn Next

- Temporal Dead Zone deep dive
- Lexical Scope
- Function Execution Context
- Closures and hoisting interaction
- V8 execution phases

---

## Summary

Hoisting là cơ chế:

- chuẩn bị memory trước khi code chạy
- đưa declarations lên đầu scope logic
- khác nhau giữa var / let / function

👉 Hiểu hoisting = hiểu vì sao JS có undefined, TDZ và behavior “khó đoán”.
