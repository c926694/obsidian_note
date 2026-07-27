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