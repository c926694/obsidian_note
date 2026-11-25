# 事件循环

JavaScript 是单线程语言，一次只能执行一段代码。事件循环（Event Loop）负责协调同步与异步任务，决定代码的执行顺序。

## 核心组成

- **调用栈（Call Stack）**：后进先出，执行同步代码。栈为空时事件循环才会取出任务执行。
- **任务队列**：存放等待执行的回调，分为两类。
  - **宏任务（Macrotask）**：`script` 整体代码、`setTimeout`、`setInterval`、`setImmediate`、I/O、`MessageChannel`、UI 渲染。
  - **微任务（Microtask）**：`Promise.then/catch/finally`、`queueMicrotask`、`MutationObserver`、`async/await` 后续部分、Node 的 `process.nextTick`。

## 执行流程

```
宏任务 → 清空调用栈 → 清空所有微任务 → 可能触发渲染 → 下一个宏任务
```

1. 从宏任务队列取出一个任务执行（首个宏任务是 `<script>` 整体代码）。
2. 该宏任务执行过程中产生的微任务会依次进入微任务队列。
3. 当前宏任务执行完毕后，**一次性清空微任务队列**；微任务执行中新产生的微任务也会在当前这一轮执行完。
4. 浏览器可能在此时进行 UI 渲染。
5. 再取出下一个宏任务，重复上述步骤。

## 关键结论

- 微任务优先级高于宏任务，每个宏任务结束后都会先清空微任务。
- `process.nextTick` 在 Node 中比 `Promise.then` 更早执行。
- `async` 函数内部，`await` 之前的代码同步执行；`await` 之后的代码等价于 `.then` 回调，属于微任务。

## 示例

```js
console.log('1'); // 同步

setTimeout(() => console.log('2'), 0); // 宏任务

Promise.resolve().then(() => console.log('3')); // 微任务

console.log('4'); // 同步
// 输出顺序：1 4 3 2
```

解释：同步代码先打印 `1`、`4`；随后清空微任务队列打印 `3`；最后处理宏任务打印 `2`。

### async/await 示例

```js
async function foo() {
  console.log('A'); // 同步执行
  await Promise.resolve();
  console.log('B'); // await 之后，进入微任务
}

console.log('1');

setTimeout(() => console.log('2'), 0); // 宏任务

foo();

Promise.resolve().then(() => console.log('3')); // 微任务

console.log('4');

// 输出顺序：1 A 4 3 B 2
```

解释：`foo()` 被调用时先同步打印 `A`，遇到 `await` 后暂停函数，把后续代码 `console.log('B')` 注册为微任务并立即返回。接着同步打印 `4`。微任务队列此时顺序为 `foo` 的续体、`then` 的 `3`，所以先打印 `B` 再打印 `3`。最后处理宏任务打印 `2`。

注意：`await` 后面即使跟的是普通值（如 `await 1`），`await` 之后的部分依然会被包装成微任务，需要等当前同步代码执行完才会继续。
