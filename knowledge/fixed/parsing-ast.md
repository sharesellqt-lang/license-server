---
id: parsing-ast
title: Parsing and AST in JavaScript
category: javascript
tags:
  - javascript
  - parser
  - ast
  - tokenization
  - compiler
  - engine
summary: 'Hiểu cách JavaScript engine parse source code, tạo token và xây dựng AST.'
difficulty: intermediate
importance: 5
estimated_time: ""45 min""
---

# Parsing and AST in JavaScript

## Definition

Trước khi JavaScript engine execute code:
```js
const x = 1 + 2;
```

engine phải:

1. đọc source code
2. parse syntax
3. tạo AST
4. compile/execution

AST là:
```txt
Abstract Syntax Tree
```

Nó là representation dạng cây của source code.

## Intuition

JavaScript source code chỉ là text.

Engine không execute raw text trực tiếp.

Nó phải biến code thành structured data.

Mental model:
```txt
Parser giống người đọc ngữ pháp
```

## Visualization
```txt
Source Code
     │
     ▼
Tokenization
     │
     ▼
Parser
     │
     ▼
AST
     │
     ▼
Compilation / Execution
```

### Tokenization

Ví dụ:
```js
let age = 20;
```

Tokens:
```txt
Keyword(let)
Identifier(age)
Operator(=)
Literal(20)
Punctuation(;)
```

### AST Example

Code:
```js
const x = 1 + 2;
```

AST simplified:
```txt
VariableDeclaration
 └── VariableDeclarator
      ├── Identifier(x)
      └── BinaryExpression(+)
           ├── Literal(1)
           └── Literal(2)
```

## Execution Flow
```txt
Source Code
→ Tokens
→ AST
→ Bytecode
→ Execution
```

## Real World

### Babel

Babel parse JavaScript thành AST rồi transform AST.

### ESLint

ESLint traverse AST để detect issues.

### Prettier

Prettier parse → AST → format lại code.

## Common Mistakess

### Nghĩ engine execute text trực tiếp

Sai.

Engine execute internal structures.

### Confuse AST với DOM

AST là structure của JavaScript.

DOM là structure của HTML.

## Edge Cases

### Automatic Semicolon Insertion
```js
return
{
    ok: true
}
```

Parser có thể insert semicolon sai expectation.

## Summary

Flow chính:
```txt
Source Code
→ Tokenization
→ Parsing
→ AST
→ Compilation
→ Execution
```

Điểm quan trọng nhất:
```txt
Engine không execute raw text.
Engine execute parsed structures.
```
