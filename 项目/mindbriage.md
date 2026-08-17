# harness
原本service层获取agent结果还要先get_context、memory、之后要更新db
这些耦合引入harness后由harness层实现
                ┌─ 脱敏
                ├─ Trace
HTTP → Harness ─┼─ 持久化
                ├─ Context
                ├─ Metrics
                └─ Agent
                     ↓
                   Result


# agent_runtime
runtime负责资源分配、启动调度者、执行黑板

```python
def run(self, user: UserAccount, session: ChatSession, original_input: str, model_input: str) -> AgentRunResult:

        """执行一轮多 Agent 协作：装配服务 → 注册 Agent → 运行认领循环 → 转换结果。"""

        # 1. 把本轮的基础服务打包进 AgentRuntimeServices（db/settings/ai/记忆/知识等）

        services = AgentRuntimeServices(

            db=self.db,

            settings=self.settings,

            user=user,

            session=session,

            ai=self.ai,

            model_registry=self.model_registry,

            memory=self.memory,

            private_memory=self.private_memory,

            knowledge=self.knowledge,

        )

        # 2. 实例化协调器与四个专业 Agent

        coordinator_agent = CoordinatorAgent(services)

        agents = [

            UnderstandingAgent(services),

            SafetyAgent(services),

            ContextAgent(services),

            ResponseAgent(services),

        ]

        # 3. 初始化本轮协作黑板，发布 TURN_STARTED 事件

        board = CollaborationBlackboard(

            turn_id=uuid.uuid4().hex,

            user_id=user.id,

            session_id=session.public_id,

            user_input=original_input,

            model_input=model_input,

        )

        board = board.append_event(

            AgentEvent(

                type=AgentEventType.TURN_STARTED,

                actor=coordinator_agent.name,

                message="user turn published to shared task board",

            )

        )

        # 4. 注册 Agent 并交给协调器跑认领循环

        registry = AgentRegistry(agents)

        final_board = EventDrivenCoordinator(registry, coordinator_agent, self.settings).run(board)

        # 5. 把黑板协作结果转换成统一结果契约

        return self._to_result(final_board, user)
```

# coordinator
派任务->尝试接纳->无接纳则让候选agent执行任务->看一次12避免多次循环
```python
def run(self, board):
    board = self._ensure_root_task(board)          # 0. 先贴根任务"解决本轮对话"
    for round_number in range(1, max_rounds + 1):  #   最多 8 轮
        board = append(ROUND_STARTED 事件)          # 1. 标记"这一轮开始了"
        board = self._derive_missing_work(board)    # 2. 盯着黑板看缺什么 → 派任务
        board = self._try_accept_final(board)       # 3. 尝试采纳（能收工就收工）
        if board.final_artifact_id:
            return board                            #    采纳了 → 提前结束
        candidates = self._claim_candidates(board, claim_counts)  # 4. 找愿意认领的 Agent
        if not candidates:                          #    没人认领 → 兜底派回复任务再试
            board = self._derive_missing_work(board, force_response=True)
            candidates = self._claim_candidates(board, claim_counts)
            if not candidates:
                break
        for task, candidate in candidates:          # 5. 让候选 Agent 执行
            board = board.update_task(task.claim(agent)) + TASK_CLAIMED 事件
            result = candidate.agent.act(task, board)   #    Agent 干活（贴产物）
            board = board.apply_turn_result(...)        #    结果合并回黑板
        board = self._derive_missing_work(board)    # 6. 再检查一遍缺口（有新产物会触发新任务）
        board = self._try_accept_final(board)
        if board.final_artifact_id:
            return board
    return board.append(BUDGET_EXHAUSTED 事件)      # 8 轮都没收工 → 预算耗尽
```

## 派发任务
根据黑板缺口派生缺失任务：理解 → 风险 → 上下文 → 回复 → 审查 → 修改
```python
def _ensure_task_for_missing_artifact(self, board, artifact_kind, task_id, title,
                                      capability, priority, condition):
    # ① 条件不满足，或 ② 黑板上已有这类产物 → 不派（幂等）
    if not condition or board.latest_artifact(artifact_kind) is not None:
        return board
    # 否则：造一张任务，交给 _ensure_task 落板
    return self._ensure_task(board, AgentTask(
        id=task_id,
        title=title,
        description=board.user_input,          # 任务的"背景资料"就是用户原话
        priority=priority,
        required_capabilities=frozenset({capability.value}),  # ← 关键：声明"需要什么能力"
        created_by=self.coordinator_agent.name,
        metadata={"kind": artifact_kind},      # 标记"这个任务是产出哪种产物的"
    ))
```

## 采纳函数
```python
def _try_accept_final(self, board):
    if board.final_artifact_id:
        return board                        # 关卡 0：已经采纳过了 → 直接返回（幂等）
    response = board.latest_artifact("response_proposal")   # 拿最新候选回复
    review = board.latest_artifact("safety_review")         # 拿最新安全审查
    if response is None or review is None:
        return board                        # 关卡 1：没回复或没审查 → 返回
    if review.metadata.get("responseArtifactId") != response.id:
        return board                        # 关卡 2：审查审的不是这份回复 → 返回
    if not review.payload.get("approved"):
        return board                        # 关卡 3：审查驳回 → 返回
    if response.confidence < self.final_min_confidence:
        return board                        # 关卡 4：置信度不够（默认 0.6）→ 返回
    # ↓ 5 关全过，才执行采纳
    reason = "accepted after autonomous response proposal and SafetyAgent approval"
    self.coordinator_agent.remember_acceptance(response.id, reason)   # ① 记私有记忆
    return board.accept_final(response.id, self.coordinator_agent.name, reason)  # ② 正式采纳
```
## 候选者选定
### registry
注册agent
按 agent 的**能力声明**过滤出"这个任务谁能投标"，再让它们 decide 投标
```python
def candidate_decisions_for(self, task: AgentTask, board: CollaborationBlackboard) -> list[AgentCandidate]:

        """返回带认领决策的候选列表，按置信度从高到低排序。

  

        先按任务所需能力过滤 Agent，再让剩余 Agent 各自 decide()，只保留认领者。

        """

        # 1. 遍历全部注册 Agent；

        # 2. 能力不匹配的直接跳过；

        # 3. 剩余 Agent 各自 decide() 决定是否认领；

        # 4. 只保留认领者，按置信度降序返回。

        candidates = []

        for agent in self._agents:

            if not self._has_required_capability(agent, task):

                continue

            decision = agent.decide(task, board)

            if decision.claim:

                candidates.append(AgentCandidate(agent, decision))

        return sorted(candidates, key=lambda item: item.decision.confidence, reverse=True)
```

### claim
调用registry的函数并组装(task,candidate)的候选者组
```python
def _claim_candidates(self, board: CollaborationBlackboard, claim_counts: dict[str, int]):

        """挑选本轮要执行的认领候选：按优先级+置信度排序，受轮/Agent 认领上限约束。"""
```