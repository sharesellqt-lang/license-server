---

---

# Untitled
````markdown
id: web-apis
title: Web APIs in JavaScript
category: javascript
tags:
  - javascript
  - web-api
  - browser
  - runtime
  - event-loop
  - dom
  - async
summary: Hiểu Web APIs là gì, chúng hoạt động ở đâu trong browser runtime và cách chúng phối hợp với JavaScript engine, event loop và callback queue.
difficulty: intermediate
importance: high
estimated_time: 55 min

## Web APIs in JavaScript

## Definition

Web APIs là các APIs được browser cung cấp cho JavaScript.

Ví dụ:

- `setTimeout`
- `fetch`
- `DOM APIs`
- `localStorage`
- `WebSocket`
- `navigator`
- `geolocation`

Quan trọng:
```txt
Web APIs KHÔNG thuộc JavaScript language.
````

Chúng thuộc:
```txt
Browser Runtime Environment
```

## Intuition

Nhiều người nghĩ:
```js
setTimeout(() => {}, 1000);
```

là JavaScript feature.

Sai.

JavaScript engine chỉ execute JavaScript.

Nó không biết:

- timer
- network
- DOM
- rendering
- mouse click

Mental model:
```txt
JavaScript Engine = não xử lý logic
Browser = hệ điều hành mini cung cấp APIs
```

## Visualization
```txt
                Browser Runtime
┌───────────────────────────────────────┐
│                                       │
│  ┌──────────────┐                     │
│  │ JavaScript   │                     │
│  │ Engine       │                     │
│  └──────┬───────┘                     │
│         │                             │
│         ▼                             │
│  ┌──────────────┐                     │
│  │   Web APIs   │                     │
│  └──────┬───────┘                     │
│         ▼                             │
│  ┌──────────────┐                     │
│  │ Callback     │                     │
│  │ Queue        │                     │
│  └──────┬───────┘                     │
│         ▼                             │
│  ┌──────────────┐                     │
│  │ Event Loop   │                     │
│  └──────────────┘                     │
│                                       │
└───────────────────────────────────────┘
```

### Important Insight

JavaScript language:
```txt
single-threaded
```

Nhưng browser runtime không phải single-threaded.

Browser có:

- networking threads
- rendering engine
- timer systems
- IO systems

Web APIs tận dụng những systems đó.

## Example — setTimeout
```js
console.log("A");

setTimeout(() => {
    console.log("B");
}, 1000);

console.log("C");
```

Output:
```txt
A
C
B
```

## Execution Flow
```txt
1. JS engine execute console.log("A")
2. setTimeout được giao cho Web API
3. Timer chạy bên ngoài JS engine
4. console.log("C") execute
5. Timer xong → callback vào queue
6. Event loop push callback vào call stack
7. console.log("B")
```

## Mental Model
```txt
Web APIs giống background workers
```

JavaScript:
```txt
"hãy làm việc này rồi gọi tôi sau"
```

### setTimeout Is Not Precise
```js
setTimeout(() => {
    console.log("run");
}, 0);
```

KHÔNG có nghĩa:
```txt
run immediately
```

Nó chỉ nghĩa:
```txt
run when call stack empty
```

## Example — Blocking
```js
setTimeout(() => {
    console.log("timeout");
}, 0);

while (true) {}
```

Output:
```txt
nothing
```

Vì main thread bị block.

### DOM APIs

Browser expose DOM APIs:
```js
document.querySelector("button");
```

JavaScript engine không biết DOM là gì.

DOM là Web API.

## Example — Event Listener
```js
button.addEventListener("click", () => {
    console.log("clicked");
});
```

Flow:
```txt
1. Browser register listener
2. User click button
3. Browser detect click
4. Callback push vào queue
5. Event loop execute callback
```

### Visualization — Event Listener
```txt
User Click
    │
    ▼
Browser Detect Event
    │
    ▼
Callback Queue
    │
    ▼
Event Loop
    │
    ▼
Call Stack
```

## Fetch API
```js
fetch("/api/users")
    .then(res => res.json())
    .then(data => {
        console.log(data);
    });
```

Networking không chạy trong JS engine.

Browser networking system handle request.

### Deep Dive — Async Doesn't Mean Parallel JS

Nhiều người nghĩ:
```txt
JavaScript chạy nhiều dòng cùng lúc
```

Sai.

JavaScript vẫn:
```txt
single-threaded
```

Async xảy ra vì:
```txt
browser/runtime xử lý background tasks
```

## Common Mistake — Confuse JavaScript với Browser

Sai:
```txt
setTimeout là JavaScript
```

Đúng:
```txt
setTimeout là Web API
```

### Example — Node.js

Node.js không có browser.

Nhưng vẫn có:
```js
setTimeout()
```

Vì Node runtime cung cấp API tương tự thông qua:
```txt
libuv
```

## Browser Runtime Components

Browser runtime thường gồm:

| Component        | Responsibility     |
| ---------------- | ------------------ |
| JS Engine        | Execute JS         |
| Web APIs         | Timers, DOM, fetch |
| Event Loop       | Scheduling         |
| Rendering Engine | Paint UI           |
| Networking       | HTTP requests      |

### Callback Queue

Khi Web API hoàn thành:
```txt
callback được đưa vào queue
```

Ví dụ:
```js
setTimeout(() => {
    console.log("done");
}, 1000);
```

Sau 1 giây:
```txt
callback queue ← function
```

## Event Loop

Event loop liên tục check:
```txt
Call stack empty?
```

Nếu empty:
```txt
move callback từ queue → stack
```

### Visualization — Event Loop
```txt
┌────────────┐
│ Call Stack │
└─────┬──────┘
      │ empty?
      ▼
┌────────────┐
│ Event Loop │
└─────┬──────┘
      ▼
┌────────────┐
│ Callback   │
│ Queue      │
└────────────┘
```

## Microtasks vs Macrotasks

Web APIs liên quan mạnh tới:

- task queue
- microtask queue

Ví dụ:

| API          | Queue     |
| ------------ | --------- |
| setTimeout   | Macrotask |
| Promise.then | Microtask |

### Example — Promise Priority
```js
setTimeout(() => {
    console.log("timeout");
});

Promise.resolve().then(() => {
    console.log("promise");
});

console.log("sync");
```

Output:
```txt
sync
promise
timeout
```

## Why?

Promise callbacks dùng:
```txt
microtask queue
```

Microtasks được ưu tiên trước macrotasks.

## Real World — UI Rendering

Browser phải phối hợp:

- JavaScript
- rendering
- layout
- paint
- animations

Nếu JS block quá lâu:
```js
while (true) {}
```

Browser không render được.

UI freeze.

## Common Bugs

### Bug 1 — Blocking Main Thread
```js
while (true) {}
```

Toàn bộ browser UI bị freeze.

## Bug 2 — Too Many Timers
```js
setInterval(() => {
    heavyTask();
}, 1);
```

Có thể overload event loop.

### Bug 3 — Memory Leaks
```js
button.addEventListener("click", handler);
```

Nếu không remove listener đúng lúc:
```txt
memory leak
```

có thể xảy ra.

## Performance

### Expensive DOM Access

Không tốt:
```js
for (let i = 0; i < 10000; i++) {
    document.body.offsetHeight;
}
```

Có thể trigger:

- reflow
- layout thrashing

## Better Pattern

Batch DOM updates.

Ví dụ:
```js
requestAnimationFrame(() => {
    updateUI();
});
```

## Security

## Dangerous APIs

Ví dụ:
```js
localStorage
postMessage
innerHTML
```

Nếu dùng sai:

- XSS
- data leak
- injection

### Example — XSS
```js
element.innerHTML = userInput;
```

Nguy hiểm nếu input không sanitize.

## Engine Internals

JavaScript engine:
```txt
không quản lý timers hay DOM
```

Engine chỉ execute JS.

Browser runtime mới:

- manage APIs
- manage event loop
- manage rendering

### Deep Dive — Why Browser APIs Separate?

Vì JavaScript originally được thiết kế:
```txt
language nhỏ cho scripting
```

Browser vendors thêm capabilities qua APIs.

Đó là lý do:
```txt
Web APIs ≠ ECMAScript
```

## Related Concepts

- event-loop.md
- callback-queue.md
- microtask-vs-macrotask.md
- runtime-environment.md
- v8-basics.md
- dom-basics.md
- fetch-api.md

## Learn Next

Sau bài này nên học:

1. event-loop.md
2. callback-queue.md
3. microtask-vs-macrotask.md
4. fetch-api.md
5. dom-events.md
6. async-await.md
7. runtime-environment.md

## Summary

Web APIs là APIs được runtime/browser cung cấp cho JavaScript.

Quan trọng nhất:
```txt
Web APIs không phải JavaScript language.
```

Flow chính:
```txt
JavaScript
→ Web API
→ Callback Queue
→ Event Loop
→ Call Stack
```

Web APIs giúp JavaScript có khả năng:

- async operations
- DOM manipulation
- networking
- timers
- browser interaction

mà vẫn giữ:
```txt
single-threaded execution model
```
```
```

```