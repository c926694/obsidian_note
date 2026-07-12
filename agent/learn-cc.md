# agent-loop
## 主循环
一个工具+一个循环=agent
llm call后根据tool_calls表查看需要调用的工具，然后对工具名进行匹配后获取参数进行工具调用
```py
def agent_loop(messages):  
    while True:  
        response = llm.chat.completions.create(  
            model=MODEL_NAME,  
            messages=messages,  
            tools=TOOLS,  
            max_tokens=8000,  
        )  
        assistant_message = response.choices[0].message  
        messages.append(assistant_message.model_dump(exclude_none=True))  
  
        if not assistant_message.tool_calls:  
            return assistant_message.content  
  
        for tool_call in assistant_message.tool_calls:  
            if tool_call.function.name != "cmd":  
                continue  
  
            tool_args = json.loads(tool_call.function.arguments)  
            command_output = run_cmd(tool_args["command"])  
            messages.append(  
                {  
                    "role": "tool",  
                    "tool_call_id": tool_call.id,  
                    "content": command_output,  
                }  
            )
```
![Agent Loop](https://learn.shareai.run/course-assets/s01_agent_loop/agent-loop.svg)
## 工具定义
```py
TOOLS = [{  
    "type": "function",  
    "function": {  
        "name": "cmd",  
        "description": (  
            "在 Windows CMD 中执行命令，并返回标准输出或错误信息。"  
            "当用户要求查询或操作本地 Windows 系统时，应调用此工具。"  
        ),  
        "parameters": {  
            "type": "object",  
            "properties": {  
                "command": {  
                    "type": "string",  
                    "description": (  
                        "完整的 Windows CMD 命令，例如 "                        "'dir'、'cd'、'mkdir test'、"  
                        "'python main.py'、'ipconfig'。"  
                    )  
                }  
            },  
            "required": ["command"]  
        }  
    }  
}]  
  
```
## 执行函数
```py

SYSTEM = f"""  
你是一个具有执行 cmd 命令权限的助手，你现在处于 {os.getcwd()} 目录下。  
当用户要求查询本地环境或执行命令时，调用工具；否则直接简短回答。  
如果调用工具，只返回必要结果，不要编造命令输出。  
  
"""  
  
  
def run_cmd(command:str):  
    """执行 cmd 命令并返回标准输出或错误信息。"""  
    completed = subprocess.run(  
        ["cmd", "/c", command],  
        capture_output=True,  
        text=True,  
        encoding="utf-8",  
        errors="replace",  
        timeout=30,  
    )  
    output_text = (completed.stdout or "") + (completed.stderr or "")  
    return output_text.strip() or "命令执行成功，但没有输出。"
```
## query
```py
def main():  
    messages = [{"role": "system", "content": SYSTEM}]  
    while True:  
        try:  
            query = input("<<<请输入你的问题：")  
        except EOFError:  
            break  
        if not query.strip():  
            break  
        messages.append({"role": "user", "content": query})  
        final_text = agent_loop(messages)  
        print(final_text)  
  
if __name__ == "__main__":  
    sys.stdout.reconfigure(encoding="utf-8")  
    main()
```