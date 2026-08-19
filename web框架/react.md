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