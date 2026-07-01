# 连接

一般放在一个通用的包下

```Go
global.Connection()
```

```Go
var DB *gorm.DB

func Connection() {
    dsn := "root:1234@(localhost:3306)/db01?charset=utf8mb4&parseTime=True&loc=Local"
    db, err := gorm.Open(mysql.Open(dsn), &gorm.Config{})
    if err != nil {
       panic(err)
    }
    DB = db
}
```

# 单表模型

- 表-结构体
    
- 行数据-结构体实例
    
- 列字段-结构体字段
    

## model

通过Model来明确区分是表映射的结构体

通过tag指定表的字段约束

```Go
type UserModel struct {
    Id        int64
    Name      string `gorm:"not null"`
    Age       int    `gorm:"default:18"`
    CreatedAt time.Time
}
```

## 表迁移

将结构体映射成dbTable

默认规则

User->users(表名以s结尾)

SeckillVoucher->seckill_voucher(字段名转蛇形)

- 一般只会进行创建表和新增字段
    

```Go
func migrate() {
    // 创建表
    err := global.DB.AutoMigrate(&UserModel{})
    if err != nil {
       panic(err)
    }
    fmt.Println("表创建成功")
}
```

# 钩子函数

在sql执行前和执行后执行的函数

- 需要将函数与结构体绑定
    
- 可用于数据校验、密码加密等业务逻辑
    
- 如果返回error，那么后续sql则不执行
    

```Go
func (user *UserModel) BeforeCreate(tx *gorm.DB) error {
    fmt.Println("BeforeCreate")
    //return errors.New("密码错误")
    return nil
}
```

# Crud

## insert

### 单插入

```Go
user := modles.UserModel{
    Name:      "lisi",
    Age:       18,
    CreatedAt: time.Now(),
}
err := db.Create(&user).Error
if err != nil {
    panic(err)
}
fmt.Println(user.Id)
```

### 批量插入

```Go
//批量插入数据
users := []modles.UserModel{
    {
       Name:      "zhangsan2",
       Age:       18,
       CreatedAt: time.Now(),
    },
    {
       Name:      "lisi11",
       Age:       18,
       CreatedAt: time.Now(),
    },
}
err := db.Create(users).Error
if err != nil {
    panic(err)
}
```

## Select

### First

- 默认按主键升序排
    
- 无数据报record not fund错误
    
- 查一条
    
- 如果指定主键就直接查主键
    

```Go
err := db.First(&users, 2).Error
if err != nil {
    fmt.Println(err)
}
```

### Last

- 默认按主键降序排
    
- 无数据报record not fund错误
    
- 查一条
    
- 如果指定主键就直接查主键
    

```Go
err := db.Last(&users, 2).Error
if err != nil {
    fmt.Println(err)
}
```

### Take

- 无排序
    
- 无数据返回record not fund错误
    
- 查一条
    

```Go
err := db.Take(&users, 111).Error
if err != nil {
       fmt.Println("记录不存在")
       return
}
```

### Find

- 可以查多条，一般搭配切片接收
    
- 无数据不报错
    

```Go
err := db.Find(&users).Error
if err != nil {
    fmt.Println("查询失败:", err)
    return
}
```

## Update

save是存在则更新，不存在则插入

updates能更新多个字段,传入map,否则不更新0值

![](https://wcncb0zsg1fn.feishu.cn/space/api/box/stream/download/asynccode/?code=ODY3ODllOTYwN2EwNzE3MGRiYjg3ZjEwYTI2ODYwYjJfaFhMeUhWakJpeTZ4RWF0SmxQY0FkNGp6NkVySWxYdWdfVG9rZW46Vmo1U2JEQnRvb01ua0x4OUZRWGM5cWswbnpnXzE3ODI4MzU0NDE6MTc4MjgzOTA0MV9WNA&add_watermark=true&scene_type=CCM)

expr用于拼凑age=age+1表达式

```Go
db.Model(&user).Update("Age", gorm.Expr("Age + ?", 1))
```

## Delete

当你表有deleted_at字段时

gorm的删除是逻辑删除，而物理删除需要加unscoped

- 查询用结构体的Find不加unscoped也能查到逻辑删除的，其余的情况查不到
    

![](https://wcncb0zsg1fn.feishu.cn/space/api/box/stream/download/asynccode/?code=MzRlMDgxZGU1Njk2MmI2NzJmZWI4NDQ5ZWZhNTE3NGZfSzA5NmV0MGlVTDREZEFxb21ORFo4VzhFbmd2WUEwSHBfVG9rZW46TThLb2I0MXM2bzRuUUp4M1VpZ2NNcm05bk5oXzE3ODI4MzU0NDE6MTc4MjgzOTA0MV9WNA&add_watermark=true&scene_type=CCM)

## Where

```Go
// 单条件
db.Where("age = ?", 18).Find(&users)

// 多条件
db.Where("age > ? AND name LIKE ?", 18, "%张%").Find(&users)

// struct 条件（零值会被忽略）
db.Where(&User{Age: 18, Name: ""}).Find(&users)

// map 条件（零值不会被忽略）
db.Where(map[string]interface{}{"age": 0, "name": ""}).Find(&users)

// 链式条件
db.Where("age > ?", 18).Where("name LIKE ?", "%张%").Find(&users)

// OR 条件
db.Where("age = ?", 18).Or("name = ?", "李四").Find(&users)

// IN 条件
db.Where("id IN ?", []int{1,2,3}).Find(&users)

// NOT 条件
db.Not("age = ?", 18).Find(&users)
```

## 查询指定字段

![](https://wcncb0zsg1fn.feishu.cn/space/api/box/stream/download/asynccode/?code=NmJiMzJhYjBiMzY5MTkzZTA1YjBiODEyMjA1MzQxYzNfNnBJVFNFYk9Hc2ZheWlXaHBRQ0MzRVp2TXZFQVVjWUhfVG9rZW46V2EyaGJnZGlWb01YcVJ4eDFVT2M2T0VibjBiXzE3ODI4MzU0NDE6MTc4MjgzOTA0MV9WNA&add_watermark=true&scene_type=CCM)

scan绑定结果映射搭配select

```Go
// Scan 查询部分字段到自定义结构体
type Result struct { Name string; Age int }
var results []Result
db.Model(&UserModel{}).Select("name, age").Where("age > ?", 18).Scan(&results)

// Pluck 查询单列
var names []string
db.Model(&UserModel{}).Pluck("name", &names)

// Find 查询整个表结构体
var users []UserModel
db.Where("age > ?", 18).Find(&users)
```

## Scopes

Scopes接收func(tx *gorm.DB) *gorm.DB，返回*gorm.DB,用于条件的构建

函数签名一致直接传

```Go
global.DB.Scopes(Age18).Find(&userList)

func Age18(tx *gorm.DB) *gorm.DB {
    return tx.Where("age > 18")
}
```

配合闭包使用

```Go
func Paginate(page, pageSize int) func(db *gorm.DB) *gorm.DB {
    return func(db *gorm.DB) *gorm.DB {
        if page < 1 {
            page = 1
        }
        offset := (page - 1) * pageSize
        return db.Offset(offset).Limit(pageSize)
    }
}
```

```Go
var users []User
db.Scopes(Paginate(2, 10)).Find(&users)
```

# 表关系

## 一对一

对于User可以根据使用频率垂直分表成User、UserDetail

UserDetail引入UserId,通过tag设置唯一索引

一般是主表->从表,即主表包含从表

**外键关联**

```Go
type UserModel struct {
    Id              int64
    Name            string           `gorm:"unique;size:16;not null"`
    Age             int              `gorm:"default:18"`
    UserDetailModel *UserDetailModel `gorm:"foreignKey:UserId"`
    CreatedAt       time.Time
    DeletedAt       gorm.DeletedAt
}
```

**逻辑外键**

配置类指定关闭物理外键

```Go
DisableForeignKeyConstraintWhenMigrating: true
```

### 插入

设置好两个实体即可

```Go
userDetail := modles.UserDetailModel{
    Email: "123@qq.com",
}
user := modles.UserModel{
    Name:            "张三",
    Age:             10,
    UserDetailModel: &userDetail,
}
db.Create(&user)
```

### 查询

preLoad先根据id查询出User

之后通过user_id in (ids)查询出UserDetail

```Go
user := modles.UserModel{}
db.Debug().Preload("UserDetailModel").First(&user)
```

### 删除

用select指定级联删除的表,并且需要Unscoped,否则都是逻辑删除

```Go
db.Unscoped().Select("UserDetailModel").Delete(&user)
```

## 一对多

User:Order=1:n

多的一方设置外键

- tag标签指定外键,写了谁就可以从谁那里开始找
    

```Go
type User struct {
    ID     int64
    Name   string

    Orders []Order `gorm:"foreignKey:UserId"`
}


type Order struct {
    ID     int64
    Price  float64
    UserId int64
}
```

- preload先查主表，再查从表
    

SELECT users

SELECT orders WHERE user_id IN (...)

```Go
db.Preload("Order").Find(&user)
```

### 关系操作

Model指定操作的表,而Association从Model获取关联表

使得最终操作的只有关联表

```Go
db.Model(&user).Association("Orders")
```

**查询**

SELECT * FROM orders WHERE user_id = user.ID;

```Go
db.Model(&user).Association("Orders").Find(&orders)
```

**新增**

UPDATE orders SET user_id = user.ID;

```Go
db.Model(&user).Association("Orders").Append(&order)
```

**删除**

本质是将外键置为NULL

UPDATE orders SET user_id = NULL;

```Go
db.Model(&user).Association("Orders").Delete(&order)
```

**清空**

UPDATE orders SET user_id = NULL WHERE user_id = user.ID;

```Go
db.Model(&user).Association("Orders").Clear()
```

**替换**

本质是Clear+Append

```Go
db.Model(&user).Association("Orders").Replace(&orders)
```

**统计**

```Go
count := db.Model(&user).Association("Orders").Count()
```

# 事务

## traction函数

```Go
err := db.Transaction(func(tx *gorm.DB) error {

        // 1. 创建订单
        if err := tx.Create(&order).Error; err != nil {
                return err // ❗ 返回 error = 自动回滚
        }

        // 2. 扣库存
        if err := tx.Model(&product).
                Update("stock", gorm.Expr("stock - ?", 1)).Error; err != nil {
                return err
        }

        return nil // ✅ 返回 nil = 提交事务
})
```

## 手动事务

```Go
tx := db.Begin()

if err := tx.Create(&order).Error; err != nil {
        tx.Rollback()
        return err
}

if err := tx.Create(&log).Error; err != nil {
        tx.Rollback()
        return err
}

tx.Commit()
```