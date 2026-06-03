---

---

# Untitled
````markdown
id: heap-vs-stack
title: Heap vs Stack in JavaScript
category: javascript
tags:
  - javascript
  - heap
  - stack
  - memory
  - execution-context
  - references
  - garbage-collection
summary: Hiểu sự khác nhau giữa stack và heap trong JavaScript, cách runtime lưu dữ liệu, references hoạt động và ảnh hưởng tới performance.
difficulty: intermediate
importance: high
estimated_time: 45 min

## Heap vs Stack in JavaScript

## Definition

JavaScript runtime thường quản lý memory bằng hai vùng chính:

- Stack
- Heap

Hiểu hai vùng này cực kỳ quan trọng để hiểu:

- variables
- references
- closures
- garbage collection
- performance
- memory leaks

## Intuition

Mental model đơn giản:
```txt
Stack = bàn làm việc ngăn nắp
Heap = kho chứa đồ linh hoạt
````

Stack:

- rất nhanh
- push/pop có thứ tự
- dùng cho execution flow

Heap:

- dynamic
- chứa data phức tạp
- linh hoạt hơn

## Visualization
```txt
STACK                          HEAP
┌──────────────┐               ┌────────────────────┐
│ x:10         │               │                    │
├──────────────┤               │ {name:"Alex"}      │
│ user ────────┼──────────────▶│                    │
└──────────────┘               └────────────────────┘
```

### Stack Memory

Stack thường dùng cho:

- execution contexts
- function calls
- local variables
- primitive values
- references

Stack hoạt động theo:
```txt
LIFO
Last In First Out
```

## Example — Call Stack
```js
function a() {
    b();
}

function b() {
    console.log("hello");
}

a();
```

Execution stack:
```txt
GLOBAL
  a
    b
```

Khi `b()` kết thúc:
```txt
GLOBAL
  a
```

### Why Stack Fast?

Stack allocation rất nhanh vì runtime chỉ cần:
```txt
push
pop
```

Ví dụ conceptually:
```txt
topPointer++
topPointer--
```

Không cần memory lookup phức tạp.

## Stack Characteristics

| Property       | Stack      |
| -------------- | ---------- |
| Fast           | Yes        |
| Ordered        | Yes        |
| Small          | Usually    |
| Cleanup        | Automatic  |
| Access Pattern | Sequential |

### Primitive Values

Ví dụ:
```js
const a = 10;
const b = a;
```

Visualization:
```txt
STACK
┌──────────┐
│ a:10     │
├──────────┤
│ b:10     │
└──────────┘
```

Primitive thường:
```txt
copy by value
```

## Example — Primitive Independence
```js
let a = 10;
let b = a;

b = 20;

console.log(a);
```

Output:
```txt
10
```

Vì `b` nhận value copy riêng.

### Heap Memory

Heap dùng cho:

- objects
- arrays
- functions
- closures
- dynamic structures

Ví dụ:
```js
const user = {
    name: "Alex"
};
```

Object thường allocate trong heap.

## Object References

Visualization:
```txt
STACK                       HEAP
┌────────────┐              ┌────────────────┐
│ user ──────┼─────────────▶│ {name:"Alex"} │
└────────────┘              └────────────────┘
```

Variable thường không chứa object trực tiếp.

Nó chứa:
```txt
reference
```

### Reference Copy
```js
const a = {
    value: 1
};

const b = a;
```

Visualization:
```txt
STACK
┌────────────┐
│ a ─────────┼────┐
├────────────┤    │
│ b ─────────┼────┘
└────────────┘

HEAP
┌────────────────┐
│ {value:1}      │
└────────────────┘
```

Không copy object.

Chỉ copy reference.

## Example — Shared Mutation
```js
const a = {
    value: 1
};

const b = a;

b.value = 999;

console.log(a.value);
```

Output:
```txt
999
```

Vì:
```txt
a và b cùng trỏ tới một object
```

### Mental Model

Primitive:
```txt
copy value thật
```

Object:
```txt
copy reference
```

## Execution Context and Stack

Khi function gọi:
```js
function test() {
    const x = 10;
}
```

runtime tạo:
```txt
execution context
```

và push vào stack.

Khi function return:
```txt
execution context bị pop
```

### Stack Overflow
```js
function loop() {
    loop();
}

loop();
```

Error:
```txt
Maximum call stack size exceeded
```

Vì stack có giới hạn.

## Deep Dive — Why Heap Exists?

Object size dynamic.

Ví dụ:
```js
const user = {};
```

Sau đó:
```js
user.name = "Alex";
user.age = 20;
user.skills = [];
```

Runtime không thể biết trước:
```txt
object sẽ lớn bao nhiêu
```

Heap cho phép dynamic allocation.

## Heap Allocation

Ví dụ:
```js
const arr = [1, 2, 3];
```

Visualization:
```txt
STACK                HEAP
┌────────┐           ┌────────────┐
│ arr ───┼──────────▶│ [1,2,3]    │
└────────┘           └────────────┘
```

### Garbage Collection

Heap memory được cleanup bằng:
```txt
Garbage Collector
```

Nếu object không còn reachable:
```txt
memory sẽ được reclaim
```

Ví dụ:
```js
let user = {
    name: "Alex"
};

user = null;
```

Object cũ eligible for GC.

## Execution Flow
```txt
Create Object
     │
     ▼
Allocate in Heap
     │
     ▼
Reference Stored in Stack
     │
     ▼
Reference Lost?
 ├── No → Keep
 └── Yes
        │
        ▼
Garbage Collection
```

### Closures and Heap
```js
function outer() {

    const data = [1,2,3];

    return function () {
        console.log(data);
    };
}
```

`data` vẫn sống sau khi `outer` kết thúc.

Vì closure giữ reference.

## Visualization — Closure
```txt
Closure
   │
   ▼
Lexical Environment
   │
   ▼
Heap Objects
```

## Common Mistakess

## Mistake 1 — Nghĩ object nằm trong variable

Sai.

Variable object thường chỉ giữ:
```txt
reference
```

## Mistake 2 — Confuse Reassignment
```js
let a = {
    x: 1
};

let b = a;

b = null;
```

Không xóa object nếu:
```txt
a vẫn reference object
```

## Mistake 3 — Shallow Copy
```js
const a = {
    nested: {
        value: 1
    }
};

const b = {...a};
```

Đây chỉ là:
```txt
shallow copy
```

Nested object vẫn shared.

## Example — Shallow Copy Problem
```js
const a = {
    nested: {
        value: 1
    }
};

const b = {...a};

b.nested.value = 999;

console.log(a.nested.value);
```

Output:
```txt
999
```

## Edge Cases

## Detached DOM
```js
const div = document.createElement("div");
```

Nếu DOM remove nhưng JS reference còn:
```txt
object vẫn sống trong heap
```

### Huge Arrays
```js
const arr = new Array(100000000);
```

Heap usage tăng cực lớn.

Có thể crash process.

## Performance

### Stack Faster Than Heap

Stack allocation:
```txt
rất nhanh
```

Heap allocation:

- dynamic
- cần GC
- fragmentation
- slower

## Excessive Allocation

Không tốt:
```js
for (let i = 0; i < 1000000; i++) {
    arr.push({});
}
```

Tạo:

- heap pressure
- GC pressure

## Real World — React

React rely heavily on:
```txt
reference comparison
```

Ví dụ:
```js
prevObj === nextObj
```

để detect state changes.

## Real World — Memory Leak
```js
window.cache = hugeObject;
```

Global reference giữ heap object sống mãi.

## Engine Internals

Modern engines như V8 optimize memory bằng:

- hidden classes
- inline caching
- generational GC
- pointer compression

## Security

## Memory Exhaustion
```js
const arr = [];

while (true) {
    arr.push({});
}
```

Có thể gây:

- browser crash
- out-of-memory
- denial of service

### Deep Dive — Pointer Concept

Reference thực tế thường là:
```txt
memory address / pointer
```

Ví dụ conceptually:
```txt
user → 0xA1F2
```

Pointer trỏ tới heap location.

## Related Concepts

- memory-model.md
- garbage-collection.md
- closures.md
- execution-context.md
- call-stack.md
- v8-basics.md
- memory-leaks.md

## Learn Next

Sau bài này nên học:

1. memory-model.md
2. garbage-collection.md
3. closures.md
4. execution-context.md
5. hidden-classes.md
6. memory-leaks.md
7. v8-basics.md

## Summary

JavaScript memory model chủ yếu gồm:
```txt
Stack
Heap
```

Stack:

- nhanh
- ordered
- execution contexts
- primitives
- references

Heap:

- dynamic
- objects
- arrays
- functions
- GC managed

Điểm quan trọng nhất:
```txt
Object thường nằm heap.
Variable thường giữ reference.
```
```
```

```