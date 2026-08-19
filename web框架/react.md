# tsx语法
一个组件就是一个tsx文件，一个函数
useState提供状态变量和修改状态的函数
return后面可以写html+js/ts
```tsx
function App() {

  const [count, setCount] = useState(0)

  return (
      <>
      <div onClick={()=>{setCount(count+1)}}>

        {count}

      </div>

      </>

  )

}
export default App
```

# 组件通信
## props
子组件也是函数，父组件传参通过属性进行传参
子组件需要用一个props来接收参数
因此props写到函数的参数位置
传递函数props要定义一个ReactNode类型
```tsx
interface HelloWorldProps {

  title: string;

  render?: () => React.ReactNode;

}

  
  

export const HelloWorld = (props: HelloWorldProps) => {

  return (

    <div>

      {props.title}

      {props.render?.()}

    </div>

  )

}
```

```tsx
function App() {

  

  return (

    <>

    <HelloWorld title="Hello World" render={() => <h1>cp</h1>} />

    </>

  )

}
```

## 子组件回调数据
父组件通过一个函数拿到子组件的数据并通过子组件调用该函数

```tsx
const [count, setCount] = useState(0)

  return (

    <div>

      {props.title}----{count}<button onClick={() => setCount(count + 1)}>+</button>

      {props.render?.(count)}

    </div>

  )
```

```tsx
return (

    <>

    <HelloWorld title="Hello World" render={(count) => <h1>cp{count}</h1>} />

    </>

  )
```

# 事件
事件触发后执行绑定函数
无参则直接函数名
有参需要写成箭头函数的形式
```tsx
function handleClick(name:string) {

    console.log(name);

  setCount(count + 1)

}

<button onClick={() => handleClick("cp")}>+</button>
```

## onChange
给表单元素value绑定的
```tsx
function App() {

  const [name, setName] = useState("")

  

  return (

    <>

    <input

      value={name}

      onChange={(e) => setName(e.target.value)}

    />

    {name}

    </>

  )

}
```

# state
## 修改对象
useState声明的如果是引用类型修改则需要传一个新对象
**对象写法**
```tsx
const [user, setUser] = useState({

    name: "cp",

    age: 18,

  });
  function handleAdd() {

    setUser({

      ...user,

      age: user.age + 1,

    });

  }
```

**回调函数写法**
这里是从函数中获取原来的对象更新
在连续更新的情况更好，因为始终拿到的是上一个对象的值
更推荐
```tsc
function handleAdd() {

    setUser((prev) => ({

      ...prev,

      age: prev.age + 1,

    }));

  }
```