用户消息
      │
      ▼
  ┌─────────────────────────────────────────┐
  │  Orchestrator（编排器 = 调度中心）        │
  │                                         │
  │  1. 先问 IntentRecognizer：这是什么问题？ │
  │     ├─ LLM 语义（70%）                  │
  │     ├─ Embedding 匹配（20%）            │
  │     └─ 关键词兜底（10%）                 │
  │                                         │
  │  2. 根据意图选 Agent：                   │
  │     TECHNICAL → TechnicalAgent           │
  │     BILLING/ACCOUNT → BillingAgent       │
  │     其余 → GeneralAgent                  │
  │     复合问题 → 并行派发多个              │
  │                                         │
  │  3. Agent 调 LLM 生成回复                │
  │     失败 → 降级到 GeneralAgent           │
  │     回复含"转人工" → 标记 escalated      │
  └─────────────────────────────────────────┘
      │
      ▼
    返回响应

  一句话：识别器负责看懂问题，编排器负责分配任务，Agen
  t 负责回答问题，三者分工明确，失败了各层都有兜底~

✻ Sautéed for 15s

❯ 总结要涉及到这个文件的类                            

● agents/agent_orchestrator.py 完整总结：

  ┌─ 枚举 ─────────────────────────────────────┐
  │  AgentType          4 种 Agent 类型标识      │
  └─────────────────────────────────────────────┘

  ┌─ 数据类 ───────────────────────────────────────┐
  │  AgentStats         运行时统计 + routing_score() │
  │  AgentResponse      单次 Agent 处理结果          │
  │  Request            传入编排器的请求
  │
  │  OrchestratorResult 编排器最终返回               │
  └─────────────────────────────────────────────────┘

  ┌─ Agent 层 ─────────────────────────────────────┐
  │  BaseAgent          基类，封装 LLM
  调用/统计/Skill注入/升级检测 │
  │    ├─ GeneralAgent     通用客服（兜底）          │
  │    ├─ TechnicalAgent   技术支持                  │
  │    └─ BillingAgent     账单服务                  │
  └─────────────────────────────────────────────────┘

  ┌─ 编排层 ───────────────────────────────────────┐
  │  AgentOrchestrator  调度中心                     │
  │    ├─ 持有 IntentRecognizer（意图识别器）        │
  │    ├─ 持有 _pool（Agent 池）                    │
  │    ├─ run()               主入口                │
  │    ├─ run_parallel()      并行协作              │
  │    ├─ _route()            意图 → Agent 类型     │
  │    ├─ _collaboration_targets() 复合问题检测     │
  │    ├─ _best_agent()       性能路由选最优实例     │
  │    ├─ _execute()          执行 + 降级           │
  │    ├─ get_stats()         暴露统计给 Monitor    │
  │    └─ update_routing_penalties() 接收 Monitor 反馈
  │
  └─────────────────────────────────────────────────┘

  类之间的关系：

  - AgentOrchestrator 创建并管理三个 Agent（通过
  _pool）
  - AgentOrchestrator 依赖 IntentRecognizer 做意图判断
  - 三个 Agent 继承 BaseAgent，各自只定义
  system_prompt
  - BaseAgent.handle() 返回
  AgentResponse，编排器包装成 OrchestratorResult
  - AgentStats 挂在每个 Agent 实例上，Monitor 通过
  get_stats() 读取、通过 update_routing_penalties()
  写入惩罚系数
  - Request 从外部传入，OrchestratorResult 向外部返回

  数据流向：Request → 编排器 → 识别器判断意图 → 路由选
  Agent → Agent 用 AgentStats 被选中 →
  BaseAgent.handle() 调 LLM → AgentResponse →
  编排器包装成 OrchestratorResult 返回~
