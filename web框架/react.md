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

# 渲染
## 列表
通过map返回组件的形式渲染
数组的修改要传入一个新数组
```tsx
<div>

        {list.map((item) => {

          return <div key={item.id}>{item.name}</div>;

        })}

      </div>

      <div>

        <button

          onClick={() =>

            setList([

              ...list,

              { id: list.length + 1, name: "cp" + (list.length + 1) },

            ])

          }

        >

          添加元素

        </button>

      </div>
```

## 条件
return的时候通过三目运算符
```tsx
<div>

        {list.map((item)=> {

          return item.id % 2 === 0 ? <div key={item.id}>{item.name}</div> : null

        })}

      </div>
```

# Hooks
生命周期函数
[]表示组件挂载的时候调用
[count]表示count渲染的时候调用
啥也不写的表示任何数据渲染的时候调用
return的回调函数则是组件卸载的时候调用
```tsx
useEffect(() => {

    console.log("变化", count);

    document.title = `You clicked ${count} times`;

  }, [count]);

  

  useEffect(() => {

    console.log("挂载");

  }, []);

  

  useEffect(() => {

    console.log("更新");

  });
  
  useEffect(() => {

    return () => {

      console.log("卸载");

    };

  });
```

# useRef
## 获取dom
用于获取标签dom的
可以执行dom的方法
```tsx
const inputRef= useRef<HTMLInputElement>(null)

useEffect(() => {

    inputRef.current?.focus()

    console.log("更新");

  });
  
<input ref={inputRef}>

        </input>
```

## 存储数据
useRef修改后不会被主动渲染
可以用于保存count的上一个值
因为count修改后
```tsx
  const countRef = useRef(0);
  useEffect(() => {

    inputRef.current?.focus()

    countRef.current = count

    console.log("更新");

  });
```