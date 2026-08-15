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