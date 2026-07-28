# 文本插值

通过{{var}}插入变量,插值表达式支持运算、三目运算符

```JavaScript
<script setup lang="ts">
const name = "陈鹏";
const age = 18;
const sex = true;
const obj = {
  name: "陈鹏",
  age: 18,
  sex: true,
};
</script>
<template>
  <div>
    <div>name: {{ name }}</div>
    <div>age: {{ age }}</div>
    <div>sex: {{ sex ? "男" : "女" }}</div>
    <div>obj.name: {{ obj.name }}</div>
  </div>
</template>
```

# 动态绑定

通过v-bind:样式属性 绑定属性值

简易写法 :样式属性

```JavaScript
<div v-bind:class="className" :name="name">动态绑定</div>
```

![](https://wcncb0zsg1fn.feishu.cn/space/api/box/stream/download/asynccode/?code=ZTgzMDE2ZDc1NzAzN2M4ZWI3YTFjYWIyNzg5MzMyZDVfUW5MSWFjQ0NUamY2Q3h2UEtyamVsRW1mQ09HT3EzQVNfVG9rZW46T1JwZWJQeFVCb0w2UFV4VHE5TWNwblc1bndnXzE3ODI4MzUyMTA6MTc4MjgzODgxMF9WNA&add_watermark=true&scene_type=CCM)

**style写法**

用对象写成k-v结构

```JavaScript
const styleObj = {
  fontSize: "20px",
  color: "blue"
}

<div :style="styleObj">动态绑定style</div>
```

# v-text、v-html

都可以用来**设置文本内容**,设置了之后,内容就不能写在内容区域了

**v-html会解析html**

```JavaScript
    v-text
    <div v-text="name"></div>
    v-html
    <div v-html="html"></div>
```

# 条件渲染

## V-if

通过dom增删实现

```JavaScript
<div>
    条件渲染
    <div>
      v-if v-else 
      <span v-if="condition">男</span>
      <span v-else>女</span>
    </div>
    <div>
      v-if v-else-if v-else
      <span v-if="age < 18">未成年</span>
      <span v-else-if="age >= 18 && age < 60">成年人</span>
      <span v-else>老年人</span>
    </div>
  </div>
```

## V-show

通过css显示隐藏实现

```JavaScript
<div>
      v-show
      <span v-show="condition">男</span>
      <span v-show="!condition">女</span>
</div>
```

# V-for

## 列表渲染

Item in arr

(item,index) in arr

```JavaScript
<div>
    <h1>列表渲染</h1>
    <h2>item in arr</h2>
    <ul>
      <li v-for="item in arr" :key="item">{{item}}</li>
    </ul>
    <h2>(item,index) in arr</h2>
    <ul>
      <li v-for="(item,index) in arr" :key="index">{{index}}:{{item}}</li>
    </ul>
  </div>
```

## 对象渲染

(value,key) in obj

(value,key,index) in obj

```JavaScript
<h1>对象渲染</h1>
    <ul>
      <h2>(key,value) in obj</h2>
      <li v-for="(value,key) in obj" :key="key">{{key}}:{{value}}</li>
    </ul>
    <ul>
      <h2>(value,key,index) in obj</h2>
      <li v-for="(value,key,index) in obj" :key="key">{{index}}:{{value}}:{{key}}</li>
    </ul>
```

# 事件

## 事件绑定、传参

v-on:或者@绑定事件

$event是vue模板的event

e对象只能拿到增量的东西,value需要通过元素dom获取

```JavaScript
function inputHandler(e: InputEvent) {
    const target = e.target as HTMLInputElement;
  const value = target.value;
  console.log("键盘输入中", e.data,"输入值",value);
}
```

```JavaScript
<script setup lang="ts">
function clickHandler(e: Event) {
  console.log("点击事件", e);
}

function clickHandler1(name: string, e: Event) {
  console.log("点击事件1", name);
}

function alertHandler(msg: string) {
  alert(msg);
}

function enterHandler(e: KeyboardEvent) {
  const target = e.target as HTMLInputElement;
  const value = target.value;
  console.log("enter键按下了", value);
}

function inputHandler(e: InputEvent) {
  console.log("键盘输入中", e.data);
}
function focusHandler() {
  console.log("触发焦点了");
}
function blurHandler() {
  console.log("失去焦点了");
}
</script>

<template>
  <div>
    事件绑定
    <div>点击事件 <button v-on:click="clickHandler">点我</button></div>
    <div>点击事件 <button @click="clickHandler">点我</button></div>
    <div>
      点击事件 <button @click="clickHandler1('枫枫', $event)">点我</button>
    </div>

    <div>双击事件 <button @dblclick="alertHandler('双击')">双击</button></div>
    <div>右键 <button @click.right="alertHandler('右键')">右键</button></div>
    <div>中键 <button @click.middle="alertHandler('中键')">中键</button></div>

    <div>
      enter键 <input @keydown.enter="enterHandler" placeholder="enter键" />
    </div>
    <div>input输入 <input @input="inputHandler" placeholder="input输入" /></div>
    <div>
      input触发焦点 <input @focus="focusHandler" placeholder="input触发焦点" />
    </div>
    <div>
      input失去焦点 <input @blur="blurHandler" placeholder="input失去焦点" />
    </div>
  </div>
</template>
```

## prevent、once

prevent用于阻止标签默认的跳转操作

once保证事件只触发一次

```JavaScript
<a href="https://www.baidu.com" @click.prevent="clickHandler('陈鹏')">百度</a>
    <button @click.once="clickHandler('陈鹏')">点我</button>
```

## 事件冒泡

只要你父级有事件能触发，那你点击子元素无论子元素有没有绑定事件

这个事件都会传递给父级

```JavaScript
<template>
  <div>
    <div class="A" @click="clickHandler($event,'A')">
      A
      <div class="B" @click="clickHandler($event,'B')">
        B
        <button @click="clickHandler($event,'button')">点击</button>
      </div>
    </div>
  </div>
</template>
```

**阻止事件冒泡**

**绑定事件的时候加stop即可**

**这样自己就不会传递事件上去**

```JavaScript
<template>
  <div>
    <div class="A" @click="clickHandler($event,'A')">
      A
      <div class="B" @click.stop="clickHandler($event,'B')">
        B
        <button @click.stop="clickHandler($event,'button')">点击</button>
      </div>
    </div>
  </div>
</template>
```

## .self

消除自身对事件冒泡的影响

```JavaScript
<template>
  <div>
    <div class="A" @click="clickHandler($event,'A')">
      A
      <div class="B" @click.self="clickHandler($event,'B')">
        B
        <button @click="clickHandler($event,'button')">点击</button>
      </div>
    </div>
  </div>
</template>
```

## 连用.self、.stop

stop在后就不会阻止事件冒泡

```JavaScript
<div class="A" @click="clickHandler($event, 'A')">
  A
  <div class="B" @click.stop.self="clickHandler($event, 'B')">
    B
    <button @click="clickHandler($event, 'Button')">button</button>
  </div>
</div>
```

1. `@click.stop.self`：点击 button → 事件冒泡到 B → `.stop` 先触发（阻断冒泡到 A）→ 再判断`.self`（触发源是 button≠B，所以 B 的事件不执行）→ 最终：A 无响应，B 无响应，只有 button 自己执行。
    
2. `@click.self.stop`：点击 button → 事件冒泡到 B → 先判断`.self`（触发源是 button≠B，B 的事件直接不执行）→ `.stop` 因 “事件未执行” 也不会触发 → 事件继续冒泡到 A → 最终：button 执行，B 无响应，A 执行。
    

## 事件委托

将子元素的事件委托给父元素统一处理,而不是给每个子元素都绑定事件

通过事件冒泡传递target给父元素,父元素进行逻辑判断是否是子元素触发的事件

```JavaScript
<script setup lang="ts">

function clickNumber1(e:Event) {
  const target=e.target as HTMLDivElement;
  if (target.classList.contains('item')) {
    console.log(target.dataset['item']);
  }
}
</script>

<template>
  <div class="list" @click="clickNumber1">
    <div class="item"  :data-item="item" v-for="item in 20" :key="item">{{ item }}</div>
  </div>
</template>

<style>
.list {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  grid-gap: 20px;
  background-color: red;
  padding: 20px;
}
.list .item {
  width: 100px;
  height: 100px;
  background-color: skyblue;
}
</style>
```

# V-model

## ref

用于双向输入绑定

常用于表单

实现数据<=>输入框

- `ref("")`：创建一个响应式数据容器（存储 msg 的值），保证数据变化时视图自动更新 ；
    
- `v-model="msg"`：把这个响应式数据和输入框做双向绑定，实现「用户输入 → msg 自动更新」「msg 手动修改 → 输入框内容自动更新」
    

```JavaScript
<script setup lang="ts">
import { ref } from "vue";
const msg = ref("默认值");
</script>

<template>
  <div>
    <div>
      <input type="text" placeholder="请输入内容" v-model="msg" />
    </div>
    <div>输入的默认值:{{ msg }}</div>
  </div>
</template>
```

## reactive

reactive，一般用reactive给对象设置响应式

```JavaScript
<script setup lang="ts">
import { ref, reactive } from "vue";
const data=reactive({
  name:'',
  age:0,
  gender:true,
  like:[],
})
</script>

<template>
  <div>
    <input type="text" v-model="data.name" placeholder="请输入姓名">
    <br>
    <input type="number" v-model="data.age" placeholder="请输入年龄">
    <br>
    <input type="radio" v-model="data.gender" value="true">男
    <input type="radio" v-model="data.gender" value="false">女
    <br>
    <input type="checkbox" v-model="data.like" value="羽毛球">羽毛球
    <input type="checkbox" v-model="data.like" value="篮球">篮球
    <input type="checkbox" v-model="data.like" value="足球">足球
    <br>
    data:{{data}}
  </div>
</template>
```

## 实现原理

通过给表单绑定一个事件,当内容变化时触发事件,将变量value设置为表单value

```JavaScript
const text=ref('')
function f(e:Event) {
  text.value=(e.target as HTMLInputElement).value
}
```

# 计算属性

对插值变量进行复杂的逻辑处理

每次都需要渲染,无缓存

```JavaScript
const list=ref([{done:true},{done:false},{done:true}])

完成的任务数量:{{list.filter(item=>item.done).length}}
```

## 无参computed

使用computed计算属性**得到变量值**

传递的函数不变,那么函数就执行一次,计算得到的变量就相当于有**缓存**

函数一变,计算变量也会跟着变

```JavaScript
<script setup lang="ts">
import { ref, reactive,computed } from "vue";
const list=ref([{done:true},{done:false},{done:true}])
const doneCount=computed(()=>{
  console.log("计算了....");
  
  return list.value.filter(item=>item.done).length
})
</script>

<template>
  <div>
    完成的任务数量:{{doneCount}}
    完成的任务数量:{{doneCount}}
  </div>
</template>
```

## 有参computed

**computed返回变量是函数**

**但是这样就失去了缓存功能,实际开发不这样写**

```JavaScript
<script setup lang="ts">
import { ref, reactive,computed } from "vue";
const menuList=[{name:'首页'},{name:'列表'},{name:'详情'}]
const menu=computed(()=>{
  return (index:number)=> {
    return menuList[index].name
  }
})

</script>

<template>
  <div>
    {{menu(0)}}
    <br>
    {{menu(1)}}
    <br>
    {{menu(2)}}
  </div>
</template>
```

## 可读可写的computed

可以对fullName进行拆分

```JavaScript
<script setup lang="ts">
import { ref, reactive,computed } from "vue";
const firstName = ref('陈')
const lastName = ref('鹏')

const fullName = computed({
  get() {
    return `${firstName.value} ${lastName.value}`
  },
  set(value) {
    const [first = '', last = ''] = value.split(' ')
    firstName.value = first
    lastName.value = last
  }
})

</script>

<template>
  <div>
    <input v-model="fullName">
    <br>
    {{firstName}}
    <br>
    {{lastName}}
  </div>
</template>
```

# Watch

## 单变量监听

监听单变量变化并**执行一段逻辑**

```JavaScript
<script setup lang="ts">
import { ref, watch } from "vue";
const text = ref("");

watch(text, (newValue, oldValue) => {
  console.log("文本发生了变化", newValue, oldValue);
})
</script>

<template>
<div>
  <input type="text" placeholder="输入" v-model="text">
</div>
</template>
```

## 多变量监听

这里实际上就是监听数组

```JavaScript
// 监听多个目标：数组形式
watch([name, age], ([newName, newAge], [oldName, oldAge]) => {
  console.log('姓名变化：', oldName ,'->', newName)
  console.log('年龄变化：', oldAge ,'->', newAge)
  // 比如：姓名/年龄变化时，同步更新用户信息
})
```

## 对象监听

- 监听完整对象拿到的就是对象变量
    
- 监听对象字段,拿到的就是对象字段
    
- 对象监听默认是deep监听
    

```JavaScript
<script setup>
import { reactive, watch } from 'vue'
const user = reactive({ name: '张三', info: { age: 18 } })

// 监听 reactive 对象：默认深度监听（无需配置 deep: true）
watch(user, (newVal, oldVal) => {
  console.log('user 任意属性变化', newVal)
})

// 监听 reactive 对象的单个属性（需用函数返回）
watch(() => user.info.age, (newAge) => {
  console.log('年龄变化：', newAge)
})
</script>
```

## watch配置

![](https://wcncb0zsg1fn.feishu.cn/space/api/box/stream/download/asynccode/?code=YjgzMWY1MTYyZDQ1YmUzM2FkZTdjYWU1NWVlNGM3ODJfeDdxSktEdDlOZ3luYmlFdmlCOTlRa2ZVQ2YyOWxxNWFfVG9rZW46SDRGVGJRU0pJbzhrM2t4aW1SQ2N3VGJObkZnXzE3ODI4MzUyMTA6MTc4MjgzODgxMF9WNA&add_watermark=true&scene_type=CCM)

## watchEffect

**watchEffect 不用写监听源，它自己看你函数里用了谁：**

```JavaScript
watchEffect(()=>{
  console.log("we:",we.value);
})
```

## 监听器

watch、watchEffect函数都会返回一个watchHandler监听器对象

可以给按钮加上pause、resume、stop事件来操作监听使用权

```JavaScript
    const weHandler = watchEffect(() => {
  console.log("we:", we.value);
});
    
    
    <button @click="weHandler.pause">取消监听</button>
    <button @click="weHandler.resume">恢复监听</button>
```

# 组件

## 组件通信

### Props

- props 是 Vue 里**父组件给子组件传数据**的方式
    
- 单向数据流：父组件数据更新 → 子组件 props 自动更新，但子组件不能直接修改 props（否则会触发警告）。
    
- 类型校验：可定义 props 的类型、默认值、必填项，提升组件健壮性。
    

父

- 父组件导入子组件并使用模板的话会导入子组件的template
    

```JavaScript
<script setup lang="ts">
import props from '@/components/props.vue'
import { ref } from "vue";
const name = ref("张三");

</script>

<template>
  <props :name="name" age="18" />

  <input type="text" v-model="name">
</template>
```

子

```JavaScript
<script setup lang="ts">
const props = defineProps({
  name: {},
  age: {},
});
</script>

<template>
  <div>
    <h1>{{ name }}</h1>
    <p>年龄：{{ age }}</p>
  </div>
</template>
```

#### 类型定义

```JavaScript
<script setup lang="ts">const props = defineProps({
  msg: {
    type: String,
    required: true,
    default: "", // 非必填时生效
  },
  count: {
    type: Number,
    default: 0
  },
  // 复杂类型（默认值需用函数返回，避免引用类型共享）user: {
    type: Object,
    default: () => ({name: '默认用户', age: 18})
  },
  // 自定义校验status: {
    type: String,
    validator: (value) => {
      return ['success', 'error', 'warning'].includes(value)
    }
  }
})
```

父

```JavaScript
<script setup lang="ts">

import Com from "@/components/com.vue";
const user = {
  name: "张三",
  age: 18,
}
</script>

<template>
  <div>
    <com msg="xxx" :count="1" :user="user" status="warning"></com>
  </div>
</template>
```

#### ts类型定义

```JavaScript
<script setup lang="ts">
interface Props {
  name?: string
  age: number
}
const props = withDefaults(defineProps<Props>(), {
  name: "默认姓名",
});
</script>

<template>
  <div>
    <h1>{{ name }}</h1>
    <p>年龄：{{ age }}</p>
  </div>
</template>
```

```JavaScript
<script setup lang="ts">
import props from '@/components/props.vue'
import { ref } from "vue";
const name = ref<string | undefined>(undefined)
</script>

<template>
  <props :name="name" :age="18" />

  <input type="text" v-model="name">
</template>
```

### Emits

emits 是 Vue 里子组件向父组件发送事件的方式。

事件可以携带参数

#### 发送事件

子组件

- send是事件名字,[]放事件携带的参数,父组件可以接收
    

```JavaScript
<script setup lang="ts">

const emit = defineEmits<{
  send: [msg: string]
}>()

function sendMsg() {
  emit('send', '你好父组件')
}
</script>

<template>
  <button @click="sendMsg">发送</button>
</template>
```

父组件

- 给导入的子组件绑定事件处理函数
    

```JavaScript
<script setup lang="ts">
import Child from './components/emits.vue'

function handleSend(msg: string) {
  console.log('收到子组件消息：', msg)
}
</script>

<template>
  <Child @send="handleSend" />
</template>
```

### 组件双向绑定

父组件用 v-model 绑定数据给子组件时，

子组件不能直接修改这个 props，

只需要 emit 对应的 update 事件，把新值发回父组件，

父组件的数据就会自动更新。

- 变量更新的事件名有规范,更新name,事件名就是'updata:name'
    

#### 单数据

子

当Input事件触发,通过emit发送更新事件给父组件

```JavaScript
<script setup lang="ts">
import { ref } from "vue";
interface props {
  modelValue: string;
}
const props = defineProps<props>();
  //子组件通过props接收父组件的参数
  // 子组件通过emit向父组件发送事件
const emit = defineEmits(["update:modelValue"]);

function send(e :Event) {
  console.log('触发send');
  
  const value=(e.target as HTMLInputElement).value
  emit("update:modelValue", value);
}
</script>

<template>
  <div>
    <input type="text"  :value="props.modelValue" @input="send" placeholder="请输入内容">
    <p>子组件的值：{{props.modelValue}}</p>
  </div>
</template>

<style scoped></style>
```

父

父组件给子组件通过v-model传参

会默认处理子组件emit的值

```JavaScript
<script setup lang="ts">
import vmodel from '@/components/vmodel1.vue'
import { ref } from 'vue'
const data=ref('xxs')

</script>

<template>
  <div>
    <vmodel v-model="data"  />
    <p>父组件的值：{{ data }}</p>
  </div>
</template>

<style scoped>

</style>
```

#### 多数据

子

```JavaScript
<script setup lang="ts">
import { ref } from 'vue'

interface Props {
  name: string
  age :number
}

const props=defineProps<Props>()

const emit=defineEmits(['update:name','update:age'])

function updateName(e:Event) {
  const name=(e.target as HTMLInputElement).value
  emit('update:name',name)
}

function updateAge(e:Event) {
  const age=Number((e.target as HTMLInputElement).value)
  emit('update:age',age)
}
</script>

<template>
  <div>
    <input type="text" :value="props.name" @input="updateName">
    <input type="number" :value="props.age" @input="updateAge">
  </div>
</template>

<style scoped>

</style>
```

父

```XML
<script setup lang="ts">
import vmodel from '@/components/props.vue'
import { ref } from 'vue'

const name=ref('xxs')

const age=ref(18)

</script>

<template>
  <div>
    <vmodel v-model:name="name" v-model:age="age"></vmodel>
    <p>name:{{name}}</p>
    <p>age:{{age}}</p>
  </div>
</template>

<style scoped>

</style>
```

### 隔代数据传递

通过provide,inject实现

- 如果要响应式数据,provide的类型要是ref,对象用reactive
    

子

```XML
<script setup lang="ts">
import { ref,inject } from 'vue'

const name=inject('name')
const msg=inject('msg')
</script>
<template>
  <div>
    <p>name:{{name}}</p>
    <input type="text" v-model="msg">
    <br>
    <p>msg:{{msg}}</p>
  </div>
</template>

<style scoped>

</style>
```

父

```XML
<script setup lang="ts">
import Sub from '@/components/sub.vue'
import { provide,ref } from 'vue'

const name='cpp'
const msg=ref('hello')
provide('name',name)
provide('msg',msg)
</script>

<template>
  <div>
    <Sub></Sub>
  </div>
</template>

<style scoped>

</style>
```

### Mitt

用于组件通信,数据只能发一个,多数据用[]、对象处理

1. 创建mitt全局对象
    

```TypeScript
import mitt from "mitt";
const emitter = mitt();
export default emitter;
```

2. 发生数据
    

```XML
<script setup lang="ts">
import { ref } from 'vue'
import emitter from '@/utils/mitt.ts'
const msg='我是小学生'

function sendMsg() {
  emitter.emit('send', msg)
}

</script>

<template>
  <div>
    <button @click="sendMsg">发送msg到父组件</button>
  </div>
</template>

<style scoped>

</style>
```

3. 接收数据
    

```XML
<script setup lang="ts">
import emitter from '@/utils/mitt.ts'
import Sub from '@/components/sub.vue'
emitter.on('send',(msg)=>{
  console.log(msg);
})

</script>

<template>
  <div>
    <Sub></Sub>
  </div>
</template>

<style scoped>

</style>
```

### 组件插槽

父组件往子组件指定位置塞内容

#### 默认插槽

子

```XML
<template>
  <div class="card">
    <slot></slot>
  </div>
</template>
```

父

```XML
<Card>
  <h2>标题</h2>
  <p>这是父组件传进来的内容</p>
</Card>
```

最终效果

```XML
<div class="card">
  <h2>标题</h2>
  <p>这是父组件传进来的内容</p>
</div>
```

#### 具名插槽

- 具名插槽需要给slot添加name属性
    

子组件

```XML
<script setup lang="ts">

</script>

<template>
  <div>
    <div class="head">
      <slot name="head"></slot>
    </div>
    <div class="body">
      <!--使用默认插槽-->
      <slot></slot>
    </div>
    <div class="footer">
      <!--通过name给插槽起个名字-->
      <slot name="footer"></slot>
    </div>
  </div>
</template>

<style scoped>
div{
  color: #2c3e50;
}
.head{
  background-color: #ee4a4a;
  padding: 20px;
}
.body{
  background-color: bisque;
  padding: 20px;
}
.footer{
  background-color: salmon;
  padding: 20px;
}
</style>
```

父组件

- 具名插槽父组件需要用template渲染,然后指定slot-name
    

```XML
<script setup lang="ts">
import Slot2 from "@/components/slot2.vue";
</script>

<template>
  <div>
    <slot2>单独替换默认插槽</slot2>
    <slot2>
      <template #default>默认插槽</template>
      <template #footer>footer</template>
      <template v-slot:head>head</template>
    </slot2>
  </div>
</template>
```

## 组件生命周期

创建 -> 挂载到页面 -> 更新 -> 卸载

1. 创建阶段：组件实例初始化，尚未挂载到 DOM
    
2. 挂载阶段：组件实例挂载到 DOM 树，页面可见
    
3. 更新阶段：组件响应式数据变化，触发视图更新
    
4. 卸载阶段：组件从 DOM 树移除，实例销毁
    

常见生命周期函数

```TypeScript
import {
  onBeforeMount,
  onMounted,
  onBeforeUpdate,
  onUpdated,
  onBeforeUnmount,
  onUnmounted
} from 'vue'
```

删除需要清理数据，比如定时器

```XML
<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
let timer: number

onMounted(() => {
  timer = window.setInterval(() => {
    console.log('定时器运行')
  }, 1000)
})

onUnmounted(() => {
  clearInterval(timer)
})
function clearimer() {
  clearInterval(timer)
}

</script>

<template>
  <div>
    <button @click="clearimer">删除定时器</button>
  </div>
</template>

<style scoped></style>
```

## 组件dom获取

原生ts或js可以获取dom

vue里,用ref保存dom;给组件ref属性绑定一个ref变量,这样dom创建后会将dom存放到ref.value中

```XML
<script setup lang="ts">
import { ref } from "vue";
const domRef = ref();
function getDom() {
  const dom = document.getElementById("btn") as HTMLButtonElement;
  console.log(dom);
  console.log(domRef.value);
}
</script>

<template>
  <div>
    <button ref="domRef" id="btn" @click="getDom">获取dom元素</button>
  </div>
</template>

<style scoped></style>
```

## nextTick

vue的dom更新默认是异步批量更新的

因此,当inc的时候拿到的count,是旧值,而页面上看到的是dom更新之后的新值

要解决旧值问题,可以通过nextTick

当你操作dom的时候,nextTick会检查是否是新值，不是就等待dom更新完成

```XML
<script setup lang="ts">
import { ref,nextTick } from 'vue'

const count=ref(0)
const countRef=ref()

function countIncrement() {
  count.value++
  //回调写法
  nextTick(()=>{
    console.log('count更新了');
    console.log(countRef.value.innerText);
  })
}

</script>

<template>
  <div>
    <button @click="countIncrement">更新count</button>
    <span ref="countRef">count:{{ count }}</span>
  </div>
</template>

<style scoped>

</style>
```

## 组合式函数

用于封装逻辑函数

- 调用者传递初始值
    
- 函数根据初始值创建响应式状态
    
- 提供对应的状态变化函数给调用者
    

```XML
import { ref } from 'vue

export function useCounter(initValue:number) {
  const count = ref(initValue)
  const increment = () => {
    count.value++
  }
  const decrement = () => {
    count.value--
  }
  const reset=()=>{
    count.value=initValue
  }
  return {
    count,
    increment,
    decrement,
    reset
  }
}
```

```XML
<script setup lang="ts">
import {useCounter} from './use_tools/useCount'

const { count, increment, decrement, reset } = useCounter(0)
</script>

<template>
  <div>
    <p>Count: {{ count }}</p>
    <button @click="increment">Increment</button>
    <button @click="decrement">Decrement</button>
    <button @click="reset">Reset</button>
  </div>
</template>

<style scoped>

</style>
```

## 内置组件

### Component

动态组件,用于**动态渲染**不同的组件

- **is**属性绑定**组件名**,组件名通过**计算属性**来确定
    
- 将逻辑判断和渲染解耦了,避免了if、else的处理
    

```XML
<script setup lang="ts">
import { ref, computed } from "vue";
import c1 from "./components/c1.vue";
import c2 from "./components/c2.vue";

const disable = ref(false);
const currentCom = computed(() => {
  return disable.value ? c2 : c1;
});
</script>

<template>
  <div>
    <button @click="disable = !disable">切换组件</button>
    <component :is="currentCom"></component>
  </div>
</template>

<style scoped></style>
```

### Keep-alive

**给组件加缓存**

子组件number++之后，父组件销毁子组件，再显示组件，number会重新归0

应该很好理解，因为组件销毁了，组件再重新创建的时候，number重新赋值了

**使用keep-alive的效果就是，响应式状态会被保留**

用法也很简单，**直接使用****`keep-alive`****包裹对应组件就好**

```XML
<script setup lang="ts">
import { ref } from "vue";
import c3 from "./components/c3.vue";
const disable = ref(false);
</script>

<template>
  <div>
    <button @click="disable = !disable">切换</button>
    <keep-alive>
      <c3 v-if="!disable"></c3>
    </keep-alive>
  </div>
</template>

<style scoped></style>
```

#### 缓存范围

在要缓存的组件定义name

```XML
defineOptions({
  name: "c3"
})
```

给keep-alive设置include或者exclude属性

```XML
<keep-alive include="c3">
  <c3 v-if="isShow"></c3>
</keep-alive>
```

# 前后端联调

## vite读取环境变量

在.env文件自定义环境变量

![](https://wcncb0zsg1fn.feishu.cn/space/api/box/stream/download/asynccode/?code=YWMxOTlkNzQwY2E1Mjk5NTI2ZDg0Zjc0OTZiNjE5N2FfREpoMWxlc2xEd2JBdjc5dVlHdWtzUXk0QXlueHQ1a1JfVG9rZW46Rjg0S2Jvbktob1JiaXN4Q2J5Q2NVdXNDbjNiXzE3ODI4MzUyMTA6MTc4MjgzODgxMF9WNA&add_watermark=true&scene_type=CCM)

  

```XML
VITE_API_URL=http://localhost:3001
```

package.json文件指定vite构建脚本模式

Npm run dev

Npm run test

这样读取的分别是

.env.dev

.env.test

```JSON
"dev": "vite --mode dev",
"test": "vite --mode test"
```

打印读取的环境变量

```TypeScript
console.log('VITE_API_URL:',import.meta.env.VITE_API_URL) // 输出环境变量的值;
```

## 跨域

浏览器-服务器之间的请求当且仅当IP、端口、协议一致才是一个域

从不同域得到的res,浏览器会丢弃并报403跨域问题

vite设置代理解决跨域问题

```JSON
server: {
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  }
```

```TypeScript
fetch('api/user/6')
  .then(res => res.json())
  .then(data => {
    console.log(data)
  })
```

## Axios

### promise

Promise = 一个未来才会有结果的东西

  

这里返回的是一个promise对象

```TypeScript
axios.get('/api/user/list')
```

then写法处理回调

http.status处于200~299触发then,其它触发catch

```TypeScript
axios.get('/api/user/list')
  .then((res) => {
    console.log(res.data)
  })
  .catch((err) => {
    console.error(err)
  })
```

async、await

async表示该函数是一个异步函数

await等待promise完成

```TypeScript
async function getUserList() {
  try {
    const res = await axios.get('/api/user/list')
    userList.value = res.data
  } catch (err) {                             
    console.error(err)
  }
}
```

### Crud

axios.get()

.then

.catch

```TypeScript
interface User {
  id?: number;
  username: string;
  password: string;
  createdAt?: string;
  updatedAt?: string;
}
const user = ref<User>({ username: "", password: "" });
const userList = ref<User[]>([]);

function getUserList() {
  console.log("获取用户列表");

  axios
    .get("/api/user/list")
    .then((res) => {
      userList.value = res.data;
      console.log("用户列表", res.data);
    })
    .catch((err) => {
      console.error("获取用户列表失败", err);
    });
}

function createUser() {
  console.log("创建用户", user.value);
  axios
    .post("/api/user", user.value)
    .then((res) => {
      console.log("创建用户成功", res.data);
    })
    .catch((err) => {
      console.error("创建用户失败", err);
    });
}

function deleteUser() {
  axios
    .delete(`/api/user/${user.value.id}`)
    .then((res) => {
      console.log("删除用户成功", res.data);
    })
    .catch((err) => {
      console.error("删除用户失败", err);
    });
}
function getUserByID() {
  axios
    .get(`/api/user/${user.value.id}`)
    .then((res) => {
      console.log("获取用户成功", res.data);
    })
    .catch((err) => {
      console.error("获取用户失败", err);
    });
}

function updateUser() {
  axios
    .put(
      `/api/user/password/${user.value.password}/${user.value.id}`,
      user.value,
    )
    .then((res) => {
      console.log("更新用户成功", res.data);
    })
    .catch((err) => {
      console.error("更新用户失败", err);
    });
}
```

### 配置

提供一个全局axios对象

设置请求拦截器加上token

设置响应拦截器让请求获取的直接是后端数据

```TypeScript
import axios from 'axios'

const useAxios = axios.create({
  timeout : 5000,
  baseURL : ''
})

useAxios.interceptors.request.use((config)=> {
  config.headers.Authorization = 'Bearer ' + localStorage.getItem('token')
  return config
})

useAxios.interceptors.response.use((response) => {
  return response.data
})
export default useAxios
```

api封装

```TypeScript
import useAxios from './index'

export interface User {
  id : number
  username : string
  password : string
  createdAt : string
  updatedAt : string
}

export function getUserListApi() {
  return useAxios.get<User[]>('/api/user/list')
}
```

使用

```XML
<script setup lang="ts">
import { getUserListApi } from '@/api/user_api'
import type { User } from '@/api/user_api'
import { ref } from 'vue'

const userList = ref<User[]>([])

function getUserList() {
  getUserListApi()
    .then((res) => {
      userList.value = res.data
      console.log(res.data);
      
    })
    .catch((err) => {
      console.error(err)
    })
}

</script>

<template>
  <div>
    <button @click="getUserList">获取用户列表</button>
    <div v-if="userList.length>0">
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>用户名</th>
            <th>创建时间</th>
            <th>更新时间</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="user in userList" :key="user.id">
            <td>{{ user.id }}</td>
            <td>{{ user.username }}</td>
            <td>{{ user.createdAt }}</td>
            <td>{{ user.updatedAt }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>

</style>
```

# 路由

## 定义路由

router/index.ts导入组件编写路由配置

```TypeScript
{
      path: '/user',
      name: 'user',
      component: UserView,
    }
```

main.ts使用router

```TypeScript
import './assets/main.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'

const app = createApp(App)
console.log('VITE_API_URL:',import.meta.env.VITE_API_URL) // 输出环境变量的值;

app.use(createPinia())
app.use(router)

app.mount('#app')
```

导入路由组件

```XML
<template>
  <div>
    <router-view ></router-view>
  </div>
</template>
```

## 路由结构

路由出口,当当前路径匹配到路由时会加载对应的组件

```XML
<router-view></router-view>
```

一个特殊的a标签，实现路径切换

```XML
<RouterLink to="/">首页</RouterLink>
<RouterLink to="/user">用户</RouterLink>
```

子路由

```TypeScript
import { createRouter, createWebHistory } from 'vue-router'

import UserLayout from '@/views/user/UserLayout.vue'
import UserProfile from '@/views/user/UserProfile.vue'
import UserSetting from '@/views/user/UserSetting.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/user',
      component: UserLayout,
      children: [
        {
          path: 'profile',
          component: UserProfile
        },
        {
          path: 'setting',
          component: UserSetting
        }
      ]
    }
  ]
})

export default router
```

## 路由跳转

有**函数跳转**和**标签属性**跳转两种模式

```TypeScript
<script setup lang="ts">
import { useRouter } from 'vue-router'

const router = useRouter()

function goUser() {
  router.push('/user')
}
</script>

<template>
  <button @click="goUser">去用户页</button>
  <button @click="router.push('/')">去首页</button>
  <router-link to="/user">用户</router-link>
  <router-link to="/">首页</router-link>
  <router-view ></router-view>
</template>
```

## 两种路由模式

1. history模式 createWebHistory
    

/xxx

/admin

/admin/user

如果没有正确的配置nginx，在部署之后有可能会出现404

1. hash模式 createWebHashHistory
    

/#/admin1

/#/

/#/admin1/home

## 动态路由

```TypeScript
{
    path: "/article/:id",
    name: "articleDetail",
    component: articleDetail,
}
```

路由跳转的时候，需要传这个动态参数

```TypeScript
<router-link :to="{name: 'articleDetail', params: {id: 1}}">article 1</router-link>
<router-link :to="{name: 'articleDetail', params: {id: 2}}">article 2</router-link><router-link :to="{name: 'articleDetail', params: {id: 3}}">article 3</router-link>
```

在视图中获取这个值

```TypeScript
<script setup lang="ts">
import {useRoute} from "vue-router";
import {watch} from "vue";

const route = useRoute()

watch(()=>route.params, ()=>{
  console.log("路由路径发生了变化")
})

</script>

<template><div>article detail {{ route.params.id }}</div></template>
```

还可以通过watch监听路由的变化

# nginx部署vue

1. 打包dist
    

```Bash
npm run build
```

2. 编写nginx.conf
    

```Bash
server {
    listen 80;
    server_name localhost;

    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://host.docker.internal:8080/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

3. 创建项目并将dist、nginx.conf放到里面
    

```Bash
mkdir vue3_study
```

4. Docker 部署
    

nginx代理配置的是本地后端,需要设置特定地址

因为如果代理localhost、127.0.0.1是默认会找容器的本地地址

```Bash
docker run -d --name vue-nginx \
  --add-host=host.docker.internal:host-gateway \
  -p 81:80 \
  -v "$PWD/dist:/usr/share/nginx/html:ro" \
  -v "$PWD/nginx.conf:/etc/nginx/conf.d/default.conf:ro" \
  nginx
```