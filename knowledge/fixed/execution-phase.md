---
id: execution-phase
title: JavaScript Execution Phase
access: pro
category: javascript
tags:
  - javascript
  - execution-context
  - hoisting
  - call-stack
  - runtime
summary:
  short: Giai đoạn JavaScript thực thi code sau khi creation phase kết thúc.
difficulty: 3
importance: 5
estimated_time: "18 minutes"
---

# JavaScript Execution Phase

## Definition

Execution Phase là giai đoạn JavaScript bắt đầu chạy từng dòng code sau khi Creation Phase hoàn thành.

Trong phase này:

- Variables được gán giá trị thực
- Function được gọi
- Expressions được tính toán
- Code chạy từ trên xuống dưới
- Call stack bắt đầu hoạt động liên tục

Nói đơn giản:

Creation Phase chuẩn bị môi trường.

Execution Phase thực sự chạy chương trình.

---

## Intuition

Hãy tưởng tượng JavaScript giống một đoàn làm phim.

### Creation Phase

Là lúc:

- dựng sân khấu
- chuẩn bị diễn viên
- setup ánh sáng
- đánh dấu vị trí

Nhưng chưa quay phim.

### Execution Phase

Là lúc:

- camera bắt đầu chạy
- diễn viên bắt đầu diễn
- hành động thực sự xảy ra

Mọi thứ mà user nhìn thấy đều xảy ra ở Execution Phase.

---

## Example

```js
var x = 10;

function greet() {
  console.log("Hello");
}

console.log(x);

greet();
````

---

## Execution Flow

JavaScript sẽ chạy như sau:

### Step 1

```js
var x = 10;
```

Variable `x` được gán giá trị `10`.

---

### Step 2

```js
console.log(x);
```

Output:

```txt
10
```

---

### Step 3

```js
greet();
```

Function được gọi.

Một execution context mới được tạo.

---

### Step 4

```js
console.log("Hello");
```

Output:

```txt
Hello
```

---

## Deep Dive

Execution Phase không đơn giản chỉ là "chạy code".

Bên trong runtime có rất nhiều thứ xảy ra:

- scope chain lookup
- memory access
- call stack push/pop
- function invocation
- closure resolution
- async scheduling

Ví dụ:

```js
function outer() {

  let x = 10;

  return function inner() {
    console.log(x);
  };
}

const fn = outer();

fn();
```

Khi `fn()` chạy:

JavaScript phải:

1. tìm biến `x`
2. không thấy trong local scope
3. đi lên outer lexical environment
4. lấy giá trị `10`

Đây là Execution Phase thực sự.

---

## Mental Model

Một mental model rất tốt:

### Creation Phase

= compiler setup

### Execution Phase

= CPU execution

Creation:

```txt
"Chuẩn bị mọi thứ"
```

Execution:

```txt
"Thực sự chạy"
```

---

## Visualization

```txt
GLOBAL EXECUTION CONTEXT

┌─────────────────────┐
│ Creation Phase      │
│                     │
│ x = undefined       │
│ greet = fn()        │
└─────────────────────┘

          ↓

┌─────────────────────┐
│ Execution Phase     │
│                     │
│ x = 10              │
│ console.log(x)      │
│ greet()             │
└─────────────────────┘
```

---

## Common Mistakes

### Nghĩ rằng JavaScript đọc xong mới chạy

Sai.

JavaScript chạy gần như line-by-line trong execution phase.

---

### Nghĩ rằng function declaration chạy lại mỗi lần gọi

Sai.

Function declaration được setup ở Creation Phase.

Execution Phase chỉ invoke function.

---

### Không hiểu execution context mới được tạo khi gọi function

Ví dụ:

```js
function test() {
  let x = 1;
}

test();
```

Khi `test()` chạy:

JavaScript tạo:

```txt
Function Execution Context
```

mới hoàn toàn.

---

## Edge Cases

## Function Expression

```js
sayHi();

var sayHi = function () {
  console.log("hi");
};
```

Output:

```txt
TypeError
```

Vì:

Execution Phase chạy:

```js
undefined();
```

---

## Temporal Dead Zone

```js
console.log(a);

let a = 5;
```

Execution Phase sẽ throw:

```txt
ReferenceError
```

do TDZ.

---

## Real World

Execution Phase cực kỳ quan trọng trong:

- React rendering
- Event handling
- Async systems
- Node.js servers
- State management
- Closure-heavy applications

Ví dụ React:

```js
function Component() {

  const [count, setCount] = useState(0);

  console.log(count);

  return <div>{count}</div>;
}
```

Mỗi lần component render:

Execution Phase chạy lại toàn bộ function component.

Đây là lý do React re-render hoạt động.

---

## Engine Internals

Trong V8:

Execution Phase liên quan tới:

- Ignition Interpreter
- Bytecode execution
- Inline cache lookup
- Hidden class access
- Stack frame allocation

Ban đầu:

V8 interpret bytecode.

Sau đó:

Hot code có thể được optimize bởi TurboFan.

---

## Related Concepts

- Execution Context
- Creation Phase
- Call Stack
- Hoisting
- Lexical Environment
- Scope Chain
- Closure
- Event Loop

---

## Learn Next

Sau bài này nên học tiếp:

1. Execution Context
2. Call Stack
3. Hoisting
4. Scope Chain
5. Closure
6. Event Loop
7. JavaScript Engine Internals

---

## Summary

Execution Phase là giai đoạn JavaScript thực sự chạy code.

Trong phase này:

- variables nhận giá trị
- function được invoke
- expressions được tính
- call stack hoạt động
- closures được resolve
- runtime bắt đầu xử lý logic thật

Nếu không hiểu Execution Phase:

sẽ rất khó hiểu:

- hoisting
- closure
- async
- React rendering
- event loop
- scope chain
- JavaScript engine behavior

```

```