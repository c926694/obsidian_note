# chatModel与Message
```go
cfg := &openai.ChatModelConfig{  
    Model:   os.Getenv("MODEL_NAME"),  
    APIKey:  os.Getenv("API_KEY"),  
    BaseURL: os.Getenv("BASE_URL"),  
}  
client, err := openai.NewChatModel(ctx, cfg)  
if err != nil {  
    panic(err)  
}
```

```go
msgs := []*schema.Message{  
    schema.SystemMessage("你是一个助手，请按照要求回答"),  
    schema.UserMessage("go咋实现任意目录启动程序后的读取目标文件"),  
}  
res, err := client.Generate(ctx, msgs)  
if err != nil {  
    panic(err)  
}  
fmt.Println(res.Content)
```

## stream
```go
chunks, err := client.Stream(ctx, msgs)  
if err != nil {  
    panic(err)  
}  
defer chunks.Close()  
for {  
    chunk, err := chunks.Recv()  
    if errors.Is(err, io.EOF) {  
       break  
    }  
    if err != nil {  
       fmt.Println(err)  
    }  
    fmt.Println(chunk.Content)  
}
```
## chatTemplate
结构化系统提示词构建
**Placeholder**对应的变量必须是**[]*schema.Message**类型
```go
tpl := prompt.FromMessages(  
    schema.FString,  
    schema.SystemMessage(  
       "你是{brand}客服。只依据已知资料回答。",  
    ),  
    schema.MessagesPlaceholder("history", true),  
    schema.UserMessage(  
       "资料：\n{context}\n\n问题：{question}",  
    ),  
)  
  
messages, err := tpl.Format(ctx, map[string]any{  
    "brand":    "小米手机",  
    "history":  []*schema.Message{schema.UserMessage("我现在用的是红米k20")},  
    "context":  "红米k40s1999元",  
    "question": "我想换个手机",  
})
```