---
Dưới đây là nội dung file markdown hoàn chỉnh:
---

id: what-is-javascript
title: What Is JavaScript
order: 1
category: javascript

tags:

- javascript
- programming-language
- browser
- runtime
- web-development
- nodejs
- frontend

summary: JavaScript là ngôn ngữ lập trình được sử dụng để tạo tính tương tác cho website và hiện nay còn được dùng để xây dựng backend, desktop application, mobile application và nhiều hệ thống khác. Hiểu JavaScript là nền tảng để học toàn bộ hệ sinh thái web hiện đại.

difficulty: beginner
importance: high
estimated_time: 25min

prerequisites: []
related:

- javascript-runtime
- execution-context
- call-stack
- event-loop
- web-apis

next:

- javascript-runtime
- execution-context
- call-stack
- event-loop
- scope

---

# What Is JavaScript

## Definition

JavaScript là một ngôn ngữ lập trình bậc cao (high-level programming language) được thiết kế ban đầu để chạy bên trong trình duyệt nhằm tạo ra các trang web có khả năng tương tác.

Nếu HTML định nghĩa cấu trúc:

```html
<h1>Hello</h1>
```

Nếu CSS định nghĩa giao diện:

```css
h1 {
  color: blue;
}
```

Thì JavaScript định nghĩa hành vi:

```js
document.querySelector("h1").addEventListener("click", () => {
  alert("Hello");
});
```

Khi người dùng click:

```text
User Click
    ↓
JavaScript
    ↓
UI Changes
```

Ngày nay JavaScript không chỉ chạy trong trình duyệt mà còn chạy trên:

- Server
- Desktop
- Mobile
- IoT
- Cloud Functions

Ví dụ:

```js
console.log("JavaScript runs everywhere");
```

Output:

```text
JavaScript runs everywhere
```

---

## Intuition

Hãy tưởng tượng một website giống như một chiếc xe.

HTML:

```text
Khung xe
```

CSS:

```text
Sơn xe
```

JavaScript:

```text
Động cơ
```

Một chiếc xe đẹp nhưng không có động cơ:

```text
Không di chuyển được
```

Một website đẹp nhưng không có JavaScript:

```text
Không tương tác được
```

Ví dụ:

- Nút đăng nhập
- Menu mở rộng
- Form validation
- Chat realtime
- Infinite scroll

Tất cả đều cần JavaScript.

---

## Mental Model

Mental model đơn giản:

```text
User Action
  ↓
JavaScript
  ↓
Business Logic
  ↓
Update UI
```

Ví dụ:

```text
Click Login
  ↓
Validate Form
  ↓
Send API Request
  ↓
Receive Response
  ↓
Update Screen
```

Code:

```js
loginButton.addEventListener("click", async () => {
  const response = await fetch("/login");

  console.log("Logged In");
});
```

JavaScript đóng vai trò bộ não điều khiển luồng xử lý.

---

## Why It Exists

Những website đầu tiên gần như chỉ là tài liệu tĩnh.

Ví dụ:

```html
<h1>Welcome</h1>
```

Người dùng chỉ có thể:

- Đọc
- Click link
- Chuyển trang

Không có:

- Chat
- Animation
- Validation
- Dynamic Content

JavaScript được tạo ra để giải quyết vấn đề đó.

Ví dụ:

Thay vì gửi form lên server rồi reload toàn bộ trang:

```text
User
 ↓
Server
 ↓
Reload Entire Page
```

JavaScript cho phép:

```text
User
 ↓
JavaScript
 ↓
API
 ↓
Update Partial UI
```

Nhanh hơn rất nhiều.

---

## Example

Ví dụ đơn giản:

```html
<button id="btn">Click Me</button>
```

```js
const btn = document.getElementById("btn");

btn.addEventListener("click", () => {
  console.log("Button clicked");
});
```

Output:

```text
Button clicked
```

Điều gì xảy ra?

```text
User Click
  ↓
Browser Detects Event
  ↓
JavaScript Callback Runs
  ↓
Console Output
```

Đây là ví dụ nhỏ nhất về tính tương tác của JavaScript.

---

## Execution Flow

Khi trình duyệt tải file JavaScript:

```js
const name = "Phong";

console.log(name);
```

Flow:

```text
Source Code
  ↓
Parser
  ↓
AST
  ↓
Bytecode
  ↓
Execution
  ↓
Output
```

Kết quả:

```text
Phong
```

Ví dụ lớn hơn:

```js
function greet() {
  console.log("Hello");
}

greet();
```

Flow:

```text
Global Context
  ↓
greet()
  ↓
console.log()
  ↓
Return
```

---

## Visualization

Kiến trúc tổng quát:

```text
Browser
│
├── HTML
├── CSS
└── JavaScript
```

Khi website chạy:

```text
User
  ↓
Browser
  ↓
JavaScript
  ↓
DOM
  ↓
Screen Update
```

Ví dụ:

```js
document.body.style.background = "black";
```

Flow:

```text
JavaScript
    ↓
DOM
    ↓
Render Engine
    ↓
New Screen
```

---

## Deep Dive

JavaScript là ngôn ngữ:

### Dynamic Typing

Có thể thay đổi kiểu dữ liệu.

```js
let value = 10;

value = "hello";
```

Hợp lệ.

---

### Garbage Collected

Không cần tự giải phóng bộ nhớ.

```js
let user = {
  name: "Phong"
};

user = null;
```

Engine sẽ tự thu hồi bộ nhớ khi cần.

---

### Prototype-Based

Kế thừa thông qua prototype.

```js
const animal = {
  eat() {
    console.log("eat");
  }
};

const dog = Object.create(animal);

dog.eat();
```

Output:

```text
eat
```

---

### First-Class Functions

Function có thể được truyền như dữ liệu.

```js
function run(fn) {
  fn();
}

run(() => {
  console.log("Hello");
});
```

Output:

```text
Hello
```

Đây là nền tảng của:

- React
- Express
- Node.js
- Async Programming

---

## Performance

JavaScript từng bị xem là chậm.

Ngày nay các engine hiện đại sử dụng:

```text
JIT Compiler
```

để tối ưu code trong quá trình chạy.

Ví dụ:

```js
for (let i = 0; i < 1000000; i++) {}
```

Engine có thể tối ưu vòng lặp này.

Tuy nhiên JavaScript vẫn có chi phí:

### Single Thread

```text
One Call Stack
```

Ví dụ:

```js
while (true) {}
```

Trình duyệt sẽ bị treo.

---

### DOM Manipulation Cost

```js
for (let i = 0; i < 10000; i++) {
  document.body.innerHTML += "<div></div>";
}
```

Thao tác DOM liên tục rất tốn kém.

---

## Common Bugs

### Undefined Errors

```js
console.log(user.name);
```

Output:

```text
ReferenceError
```

Vì:

```js
user
```

chưa tồn tại.

---

### Wrong Type

```js
console.log("5" + 1);
```

Output:

```text
51
```

Nhiều người mong đợi:

```text
6
```

---

### Async Confusion

```js
console.log(1);

setTimeout(() => {
  console.log(2);
}, 0);

console.log(3);
```

Output:

```text
1
3
2
```

Không phải:

```text
1
2
3
```

---

## Common Mistakes

### Học Framework Trước JavaScript

Nhiều người học:

```text
React
Vue
Angular
```

trước khi hiểu JavaScript.

Kết quả:

```text
Biết framework
Không hiểu runtime
```

---

### Lạm Dụng Global Variables

```js
let user = {};
```

xuất hiện khắp nơi.

Điều này làm code khó bảo trì.

---

### Không Hiểu Event Loop

```js
fetch("/api");
```

Nhiều người nghĩ:

```text
Code dừng hoàn toàn
```

Thực tế JavaScript tiếp tục chạy các phần khác.

---

## Edge Cases

### Floating Point Problem

```js
console.log(0.1 + 0.2);
```

Output:

```text
0.30000000000000004
```

Không phải:

```text
0.3
```

---

### Equality Confusion

```js
console.log([] == false);
```

Output:

```text
true
```

Điều này thường gây bất ngờ.

---

### NaN

```js
console.log(typeof NaN);
```

Output:

```text
number
```

Dù NaN có nghĩa là:

```text
Not A Number
```

---

## Real World

JavaScript hiện diện gần như mọi nơi.

### Frontend

Ví dụ:

- React
- Vue
- Svelte
- Next.js

Website:

```text
User
 ↓
JavaScript
 ↓
Interactive UI
```

---

### Backend

Node.js cho phép:

```js
const http = require("http");
```

JavaScript chạy trên server.

---

### Mobile

Ví dụ:

- React Native

Một codebase có thể chạy trên:

```text
Android
iOS
```

---

### Desktop

Ví dụ:

- VS Code
- Discord
- Slack

đều sử dụng JavaScript trong một phần kiến trúc của chúng.

---

## Engine Internals

JavaScript không tự chạy.

Nó cần một engine.

Ví dụ:

```text
Chrome  → V8
Firefox → SpiderMonkey
Safari  → JavaScriptCore
```

Quá trình:

```text
JavaScript Source
  ↓
Parser
  ↓
AST
  ↓
Bytecode
  ↓
Optimization
  ↓
Machine Code
```

Ví dụ:

```js
const x = 10;
```

Engine phải:

```text
Parse
Allocate Memory
Execute
Store Value
```

mọi thứ đều diễn ra phía dưới runtime.

---

## Related Concepts

### JavaScript Runtime

Môi trường chạy JavaScript.

Bao gồm:

```text
Call Stack
Web APIs
Event Loop
Queues
```

---

### Execution Context

Mỗi khi function chạy:

```js
function hello() {}
```

Engine tạo Execution Context.

---

### Call Stack

Quản lý function calls.

```text
hello()
 ↓
stack frame
```

---

### Event Loop

Cho phép xử lý bất đồng bộ.

```js
setTimeout(...)
```

---

### Web APIs

Cung cấp:

```text
fetch
setTimeout
DOM
Events
```

---

## Learn Next

Sau khi hiểu JavaScript là gì, nên học tiếp:

1. JavaScript Runtime
2. Execution Context
3. Call Stack
4. Memory Creation Phase
5. Scope
6. Lexical Environment
7. Scope Chain
8. Event Loop
9. Web APIs
10. Async/Await

Đây là chuỗi kiến thức nền tảng giúp hiểu JavaScript ở mức runtime thay vì chỉ mức cú pháp.

---

## Summary

JavaScript là ngôn ngữ lập trình được tạo ra để mang tính tương tác vào web và hiện nay đã phát triển thành một trong những ngôn ngữ phổ biến nhất thế giới. Nó cho phép xử lý sự kiện người dùng, cập nhật giao diện, giao tiếp với server, xây dựng backend, mobile app và nhiều loại hệ thống khác.

Điểm quan trọng của JavaScript không nằm ở cú pháp mà nằm ở runtime của nó. Khi chương trình chạy, JavaScript Engine sẽ parse code, tạo execution context, quản lý call stack và phối hợp với event loop để xử lý các tác vụ bất đồng bộ.

Hiểu JavaScript là hiểu cách code được thực thi, cách dữ liệu được quản lý và cách trình duyệt hoặc Node.js vận hành phía sau. Đây là nền tảng bắt buộc trước khi học các chủ đề nâng cao như Execution Context, Call Stack, Scope, Event Loop và các framework hiện đại.

Điều quan trọng nhất cần nhớ là JavaScript không chỉ là một ngôn ngữ để làm website động. Nó là ngôn ngữ trung tâm của hệ sinh thái web hiện đại, và việc hiểu rõ runtime của JavaScript sẽ quyết định khả năng xây dựng ứng dụng lớn, debug lỗi phức tạp và tối ưu hiệu năng trong thực tế.
