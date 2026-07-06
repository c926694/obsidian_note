# 核心语法
## jsx
react的组件就是一个jsx文件，可以写html和js
是一个函数
这个函数需要return ()
- react返回的内容只能由一个根元素
多级元素用空元素包裹
```
<>

</>
```
```js
import logo from './logo.svg';

import './App.css';

function App() {

  return (

    <div className="App">

      <header className="App-header">

        <img src={logo} className="App-logo" alt="logo" />

      </header>

    </div>

  );

}

  

export default App;
```
## if
react的插值用{}引起,通过三目运算符来实现if渲染

```js
const flag=true

const title="hh"
function App() {

  return (

    <div>

      {flag ? <h1 title={title}>true</h1> : <h1>false</h1>}

    </div>

  );

}
```
## 循环
.map进行循环
jsx只允许一个根元素,这在列表循环中写的jsx语法也是生效的
于是可以用<></>包裹多级根元素
但是在指定key的情况下用Fragement标签
可以将fragement标签理解为带css的空标签
```js
function App() {

  const list=[{id:1,name:"John"},{id:2,name:"Jane"},{id:3,name:"Bob"}];

  const listContent=list.map((item)=> {

    return (

      <Fragment key={item.id}>

        <ul>{item.name}</ul>

        <h1>----------</h1>

      </Fragment>

    )

  })

  return (

    <div>

      {listContent}

    </div>

  )

}
```
## 事件
```js
function handlerClick(e) {

  console.log('点击了');

}

  

function App() {

  return (

    <button onClick={handlerClick}>点击我</button>

  )

}
```