# React 核心语法

## 一、插值（Interpolation）

JSX 中用 `{}` 嵌入 JavaScript 表达式：

```jsx
function App() {
  const name = "小明"
  const age = 25
  const user = { name: "小红", age: 22 }
  const isOnline = true
  const todos = ["吃饭", "睡觉", "写代码"]

  return (
    <div>
      {/* 1. 变量插值 */}
      <h1>你好，{name}！</h1>

      {/* 2. 表达式 */}
      <p>明年你 {age + 1} 岁了</p>

      {/* 3. 对象属性 */}
      <p>{user.name} 今年 {user.age} 岁</p>

      {/* 4. 三元表达式 */}
      <p>状态：{isOnline ? "在线" : "离线"}</p>

      {/* 5. 函数调用 */}
      <p>大写的名字：{name.toUpperCase()}</p>

      {/* 6. 数组 join */}
      <p>待办：{todos.join("、")}</p>

      {/* 7. 不能直接放对象，会报错 */}
      {/* ❌ {user}  会报 Objects are not valid as a React child */}

      {/* 8. 不能放 if/for 语句（它们是语句，不是表达式） */}
    </div>
  )
}
```

---

## 二、条件渲染（if）

### 方式 1：三元表达式（最常用）

```jsx
function Greeting({ isLogin, name }) {
  return (
    <div>
      <h1>{isLogin ? `欢迎回来，${name}` : "请登录"}</h1>
    </div>
  )
}
```

### 方式 2：&& 短路

```jsx
function Notification({ message }) {
  return (
    <div>
      <h1>消息中心</h1>
      {message && <p className="notice">{message}</p>}
      {/* 只有 message 有值时才渲染 */}
    </div>
  )
}
```

### 方式 3：if/else 变量

```jsx
function UserStatus({ role }) {
  let badge

  if (role === "admin") {
    badge = <span className="badge-admin">管理员</span>
  } else if (role === "vip") {
    badge = <span className="badge-vip">VIP 用户</span>
  } else {
    badge = <span className="badge-normal">普通用户</span>
  }

  return <div>{badge}</div>
}
```

### 方式 4：立即执行函数（不推荐，了解即可）

```jsx
function Score({ score }) {
  return (
    <div>
      成绩：
      {(() => {
        if (score >= 90) return "优秀"
        if (score >= 60) return "及格"
        return "不及格"
      })()}
    </div>
  )
}
```

---

## 三、列表渲染（循环）

### 基础：用 `map()`

```jsx
function TodoList() {
  const todos = [
    { id: 1, text: "学习 React", done: false },
    { id: 2, text: "写项目", done: true },
    { id: 3, text: "复习面试题", done: false },
  ]

  return (
    <ul>
      {todos.map((todo) => (
        <li key={todo.id}>
          {todo.done ? "✅" : "⬜"} {todo.text}
        </li>
      ))}
    </ul>
  )
}
```

### key 是必须的

```jsx
// ✅ 用唯一 id
todos.map(todo => <li key={todo.id}>{todo.text}</li>)

// ✅ 没有 id 时用 index（但影响性能，不推荐，可能导致 bug）
todos.map((todo, index) => <li key={index}>{todo.text}</li>)
```

### 过滤 + 循环组合

```jsx
function FilteredList() {
  const numbers = [1, 2, 3, 4, 5, 6]

  return (
    <ul>
      {numbers
        .filter((n) => n % 2 === 0) // [2, 4, 6]
        .map((n) => (
          <li key={n}>{n} 是偶数</li>
        ))}
    </ul>
  )
}
```

### 从对象数组渲染表格

```jsx
function UserTable() {
  const users = [
    { id: 1, name: "小明", role: "admin" },
    { id: 2, name: "小红", role: "vip" },
    { id: 3, name: "小刚", role: "user" },
  ]

  return (
    <table border="1">
      <thead>
        <tr>
          <th>ID</th>
          <th>姓名</th>
          <th>角色</th>
        </tr>
      </thead>
      <tbody>
        {users.map((user) => (
          <tr key={user.id}>
            <td>{user.id}</td>
            <td>{user.name}</td>
            <td>{user.role}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
```

---

## 四、组合示例

```jsx
function App() {
  const [todos, setTodos] = useState([
    { id: 1, text: "学习插值", done: false },
    { id: 2, text: "学习条件渲染", done: false },
    { id: 3, text: "学习列表渲染", done: true },
  ])

  const [filter, setFilter] = useState("all")

  return (
    <div>
      <h1>React 学习清单</h1>

      {/* 条件渲染 */}
      {todos.length === 0 && <p>暂无待办</p>}

      {/* 列表渲染 */}
      <ul>
        {todos
          .filter((todo) => {
            if (filter === "done") return todo.done
            if (filter === "active") return !todo.done
            return true // all
          })
          .map((todo) => (
            <li key={todo.id}>
              {/* 插值 + 三元 */}
              {todo.done ? "✅" : "⬜"} {todo.text}
            </li>
          ))}
      </ul>
    </div>
  )
}
```

---

## 速记口诀

```
{}里放表达式，别放 if 和 for
三目用来做判断，短路也能显神通
循环就用 map()，记得加 key
条件太多抽变量，代码干净又清楚
```
