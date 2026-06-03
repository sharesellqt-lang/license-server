---
id: memory-model
title: JavaScript Memory Model
category: javascript
tags:
  - javascript
  - memory
  - heap
  - stack
  - references
  - garbage-collection
  - execution-context
summary: >-
  Hiểu cách JavaScript quản lý memory, stack vs heap, references, primitives,
  object identity và mental model của memory trong runtime.
difficulty: intermediate
importance: 5
estimated_time: ""55 min""
---

# JavaScript Memory Model

## Definition

Memory model là cách JavaScript runtime:

- allocate memory
- lưu variables
- quản lý references
- truy cập dữ liệu
- cleanup memory

Để hiểu JavaScript thật sự hoạt động thế nào, phải hiểu:
```txt
stack
heap
references
```

## Intuition

Nhiều người nghĩ:
```js
const a = 10;
```

chỉ là:
```txt
a chứa 10
```

Nhưng runtime thực tế phức tạp hơn.

Mental model:
```txt
Variable không phải object.
Variable thường chỉ là label/reference.
```

Ví dụ:
```js
const user = {
    name: "Alex"
};
```

`user` KHÔNG chứa object trực tiếp.

Nó thường chứa:
```txt
reference → heap memory
```

## Visualization
```txt
STACK                    HEAP
┌──────────────┐         ┌────────────────┐
│ user ────────┼────────▶│ {name:"Alex"} │
└──────────────┘         └────────────────┘
```

### Two Main Memory Areas

### Stack Memory

Dùng cho:

- execution contexts
- primitive values
- local references
- function calls

Stack:

- nhanh
- ordered
- fixed structure

### Heap Memory

Dùng cho:

- objects
- arrays
- functions
- complex data

Heap:

- dynamic
- flexible
- slower hơn stack

### Primitive Values

Primitive gồm:

- string
- number
- boolean
- null
- undefined
- bigint
- symbol

Ví dụ:
```js
const a = 10;
const b = a;
```

Visualization:
```txt
STACK
┌───────┐
│ a:10  │
├───────┤
│ b:10  │
└───────┘
```

Primitive thường copy by value.

### Example — Primitive Independence
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

Vì:
```txt
primitive copy value thật
```

### Objects

Objects behave khác.

Ví dụ:
```js
const user = {
    name: "Alex"
};
```

Visualization:
```txt
STACK                  HEAP
┌────────────┐         ┌────────────────┐
│ user ──────┼────────▶│ {name:"Alex"} │
└────────────┘         └────────────────┘
```

### Reference Copy
```js
const a = {
    count: 1
};

const b = a;
```

Không copy object.

Nó copy:
```txt
reference
```

## Visualization
```txt
STACK
┌────────────┐
│ a ─────────┼────┐
├────────────┤    │
│ b ─────────┼────┘
└────────────┘

HEAP
┌────────────────┐
│ {count:1}      │
└────────────────┘
```

### Example — Shared Mutation
```js
const a = {
    count: 1
};

const b = a;

b.count = 999;

console.log(a.count);
```

Output:
```txt
999
```

Vì:
```txt
a và b cùng reference
```

## Mental Model

Primitive:
```txt
copy value
```

Object:
```txt
copy reference
```

### Execution Context and Memory

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

trong stack.

### Call Stack Visualization
```txt
GLOBAL
  test
```

Khi function return:
```txt
execution context bị pop
```

### Heap Allocation

Object thường allocate trong heap.

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

### Deep Dive — Why Heap?

Object size dynamic.

Ví dụ:
```js
const user = {};
```

sau đó:
```js
user.name = "Alex";
user.age = 20;
user.address = {};
```

Runtime không biết trước object sẽ lớn bao nhiêu.

Heap giải quyết điều đó.

### Stack vs Heap

| Stack | Heap |
|---|---|
| Fast | Flexible |
| Ordered | Dynamic |
| Small | Large |
| Primitive-heavy | Object-heavy |
| Auto cleanup | GC managed |

### Pass By Value vs Pass By Reference?

JavaScript technically:
```txt
always pass by value
```

Nhưng với object:
```txt
value = reference
```

Ví dụ:
```js
function update(user) {
    user.name = "Changed";
}
```

Function nhận:
```txt
copy của reference
```

không phải object copy.

### Example — Reassignment
```js
function reset(user) {
    user = null;
}

const person = {
    name: "Alex"
};

reset(person);

console.log(person);
```

Output:
```txt
{name:"Alex"}
```

Vì:
```txt
reassign local reference
không ảnh hưởng outer reference
```

### Closures and Memory

Closure giữ reference tới lexical environment.

Ví dụ:
```js
function outer() {

    const data = [1,2,3];

    return function () {
        console.log(data);
    };
}
```

`data` vẫn sống sau khi outer kết thúc.

## Visualization
```txt
Closure
   │
   ▼
Lexical Environment
   │
   ▼
Heap Objects
```

## Garbage Collection

Nếu object không còn reachable:
```txt
GC cleanup memory
```

Ví dụ:
```js
let user = {
    name: "Alex"
};

user = null;
```

Object cũ eligible for GC.

## Common Mistakess

### Mistake 1 — Nghĩ object được copy
```js
const a = {x:1};
const b = a;
```

Không copy object.

Copy reference.

### Mistake 2 — Deep Copy Confusion
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

### Example — Shallow Copy Problem
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

### Deep Copy

Một số cách:
```js
structuredClone(obj);
```

hoặc libraries như lodash.

## Edge Cases

### typeof null
```js
typeof null
```

Output:
```txt
object
```

Historical memory tagging bug.

### NaN
```js
typeof NaN
```

Output:
```txt
number
```

## Real World — React State

Sai:
```js
state.user.name = "Alex";
```

Vì React rely on reference comparison.

Tốt hơn:
```js
setState({
    ...state,
    user: {
        ...state.user,
        name: "Alex"
    }
});
```

## Real World — Memory Leak
```js
window.cache = hugeObject;
```

Global reference giữ object sống mãi.

## Performance

### Excessive Allocation

Không tốt:
```js
for (let i = 0; i < 1000000; i++) {
    arr.push({});
}
```

Tạo:

- heap pressure
- GC pressure

### Object Reuse

Một số systems reuse object để giảm allocation.

Ví dụ game engines.

## Engine Internals

Modern engines như V8 optimize bằng:

- hidden classes
- inline caching
- generational GC
- escape analysis

### Escape Analysis

Nếu object không escape function:
```js
function test() {
    const point = {x:1,y:2};
}
```

Engine đôi khi optimize allocation.

## Security

### Prototype Pollution
```js
obj["__proto__"].admin = true;
```

Có thể mutate object behavior toàn hệ thống.

## Mental Model

Quan trọng nhất:
```txt
Variable object thường là reference holder.
Object thật nằm heap.
```

## Related Concepts

- garbage-collection.md
- closures.md
- execution-context.md
- call-stack.md
- hidden-classes.md
- v8-basics.md
- memory-leaks.md

## Learn Next

Sau bài này nên học:

1. garbage-collection.md
2. closures.md
3. execution-context.md
4. hidden-classes.md
5. memory-leaks.md
6. weakmap.md
7. v8-basics.md

## Summary

JavaScript memory model xoay quanh:
```txt
stack
heap
references
reachability
```

Primitive:
```txt
copy by value
```

Objects:
```txt
reference-based
```

Điểm quan trọng nhất:
```txt
Object thường không nằm trong variable.
Variable chỉ giữ reference tới heap memory.
```
