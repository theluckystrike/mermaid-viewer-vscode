# Service notes

This file has five Mermaid blocks. The fourth one has a syntax error on purpose.

## Request flow

```mermaid
flowchart LR
  client --> gateway --> service --> db[(DB)]
```

## Login

```mermaid
sequenceDiagram
  Browser->>Server: POST /login
  Server-->>Browser: 302 to /home
```

Some text between the blocks.

## States

~~~mermaid
stateDiagram-v2
  [*] --> Draft
  Draft --> Review
  Review --> Published
~~~

## Broken on purpose

```mermaid
flowchart TD
  A --> B
  B --> --> C
```

## Share of work

```mermaid
pie
  "Docs" : 2
  "Code" : 5
  "Tests" : 3
```

```js
// not a diagram
console.log('hello');
```
