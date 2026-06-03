---
id: garbage-collection
title: Garbage Collection in JavaScript
category: javascript
tags:
  - javascript
  - garbage-collection
  - memory
  - gc
  - v8
  - heap
  - memory-leak
summary: >-
  Hiểu cách JavaScript Garbage Collection hoạt động, mark-and-sweep,
  generational GC, memory leaks và cách engine quản lý memory.
difficulty: intermediate
importance: 5
estimated_time: "50 min"
---

# Garbage Collection in JavaScript

## Definition

Garbage Collection (GC) là cơ chế tự động quản lý memory trong JavaScript.

GC chịu trách nhiệm:

- tìm object không còn dùng
- reclaim memory
- giải phóng heap

Ví dụ:
```js
let user = {
    name: "Alex"
};

user = null;
```

Object cũ không còn reachable.

GC sẽ eventually cleanup memory đó.

## Intuition

JavaScript developer không cần:
```c
free(pointer);
```

như C/C++.

Engine tự làm việc đó.

Mental model:
```txt
GC giống người dọn rác tự động
```

- object còn dùng → giữ lại
- object không ai dùng → dọn

## Visualization
```txt
Object Created
      │
      ▼
Reachable?
 ├── YES → Keep
 └── NO
        │
        ▼
 Garbage Collector
        │
        ▼
 Memory Freed
```

## Definition

JavaScript memory thường gồm:

| Area | Purpose |
|---|---|
| Stack | primitive + execution context |
| Heap | objects, arrays, functions |

Ví dụ:
```js
const user = {
    name: "Alex"
};
```

`user` reference nằm stack.

Object nằm heap.

## Intuition

GC dựa trên:
```txt
reachability
```

Nếu object còn reachable:
```txt
GC không xóa
```

Ví dụ:
```js
const user = {
    name: "Alex"
};
```

`user` còn reference.

Object còn sống.

### Unreachable Objects
```js
let user = {
    name: "Alex"
};

user = null;
```

Object cũ:
```txt
không còn reference
```

→ eligible for garbage collection.

## Deep Dive

Đây là core algorithm phổ biến.

Flow:
```txt
1. Mark reachable objects
2. Sweep unreachable objects
3. Free memory
```

### Example — Mark Phase
```js
const user = {
    address: {
        city: "HCM"
    }
};
```

GC mark:
```txt
GLOBAL
 └── user
      └── address
```

Tất cả reachable.

### Example — Sweep Phase
```js
let user = {
    name: "Alex"
};

user = null;
```

Object không reachable nữa.

GC sweep memory đó.

## Execution Flow
```txt
Allocate Object
      │
      ▼
Object Referenced
      │
      ▼
Reachability Analysis
      │
      ▼
Unused?
 ├── No → Keep
 └── Yes → Collect
```

### Deep Dive — Circular References

Ngày xưa một số GC fail với circular references.

Ví dụ:
```js
const a = {};
const b = {};

a.ref = b;
b.ref = a;
```

Nếu không còn root reference:
```txt
GC hiện đại vẫn cleanup được
```

Vì mark-and-sweep check reachability.

Không chỉ check reference count.

## Common Mistakes — Memory Leak
```js
const cache = [];

function store() {
    cache.push(new Array(1000000));
}
```

Nếu cache không clear:
```txt
memory tăng mãi
```

GC không thể cleanup vì object vẫn reachable.

## Real World — Event Listener Leak
```js
button.addEventListener("click", handler);
```

Nếu element bị remove nhưng listener còn giữ reference:
```txt
memory leak có thể xảy ra
```

###### Example — Closure Leak
```js
function outer() {

    const hugeData = new Array(1000000);

    return function () {
        console.log("hello");
    };
}
```

Closure giữ lexical environment.

`hugeData` có thể vẫn sống.

###### Mental Model

GC không quan tâm:
```txt
"bạn còn muốn object không"
```

GC chỉ quan tâm:
```txt
"còn reachable không"
```

###### V8 Generational GC

V8 chia heap thành:
```txt
Young Generation
Old Generation
```

###### Young Generation

Object mới allocate ở đây.

Ý tưởng:
```txt
đa số object chết rất sớm
```

Ví dụ:
```js
function test() {
    const temp = {};
}
```

Object chỉ sống rất ngắn.

###### Old Generation

Object sống lâu sẽ được promote.

Ví dụ:
```js
window.app = {
    users: []
};
```

Sống suốt app lifecycle.

###### Deep Dive — Minor vs Major GC

###### Minor GC

- nhanh
- cleanup young generation
- xảy ra thường xuyên

###### Major GC

- chậm hơn
- cleanup old generation
- expensive hơn

###### Stop The World

GC thường cần pause JavaScript execution.

Gọi là:
```txt
Stop The World
```

Nếu heap quá lớn:
```txt
GC pause có thể gây lag
```

## Performance

###### Excessive Allocation

Không tốt:
```js
for (let i = 0; i < 1000000; i++) {
    arr.push({});
}
```

Tạo:

- allocation pressure
- GC pressure

###### Better Pattern

Reuse object nếu phù hợp.
```js
const point = {
    x: 0,
    y: 0
};
```

###### Common Mistakes

###### Mistake 1 — Nghĩ GC chạy ngay
```js
obj = null;
```

KHÔNG có nghĩa:
```txt
memory free ngay lập tức
```

GC chạy khi engine quyết định.

###### Mistake 2 — Global Variables
```js
window.data = hugeObject;
```

Global references làm object sống mãi.

###### Mistake 3 — Forgotten Timers
```js
setInterval(() => {
    console.log(data);
}, 1000);
```

Interval giữ closure reference.

## Edge Cases

###### Detached DOM
```js
const div = document.createElement("div");
```

Nếu DOM remove nhưng JS reference còn:
```txt
memory chưa được free
```

###### WeakMap

WeakMap cho phép key được GC.

Ví dụ:
```js
const wm = new WeakMap();

let user = {};

wm.set(user, "data");

user = null;
```

Object có thể được GC.

###### WeakRef

Modern JavaScript có:
```txt
WeakRef
```

cho weak references.

Nhưng dùng rất cẩn thận.

## Engine Internals

V8 dùng:

- generational GC
- incremental marking
- concurrent sweeping
- compaction

để giảm pause time.

###### Real World

GC ảnh hưởng:

- React apps
- games
- Node.js servers
- animation
- large data apps

Memory leak nhỏ nhưng lâu dài có thể crash app.

## Security

###### Memory Exhaustion

Infinite allocation:
```js
const arr = [];

while (true) {
    arr.push(new Array(1000000));
}
```

Có thể gây:

- browser crash
- tab kill
- process out of memory

## Related Concepts

- v8-basics.md
- memory-management.md
- closures.md
- execution-context.md
- heap-vs-stack.md
- memory-leaks.md
- weakmap.md

## Learn Next

Sau bài này nên học:

1. heap-vs-stack.md
2. memory-leaks.md
3. closures.md
4. weakmap.md
5. weakref.md
6. v8-basics.md
7. event-loop.md

## Summary

Garbage Collection là cơ chế tự động cleanup memory trong JavaScript.

Core idea:
```txt
reachable objects survive
unreachable objects collected
```

Modern engines như V8 dùng:

- mark and sweep
- generational GC
- incremental GC
- concurrent GC

Điểm quan trọng nhất:
```txt
GC không free object vì "không dùng nữa"
GC free object vì "không còn reachable"
```
