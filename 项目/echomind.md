# 意图识别器
三路融合 + 加权投票

```py
async def recognize(self, message: str, history=None) -> IntentResult:
    key = self._cache_key(message)
    if key in self._cache:
        self.cache_hits += 1
        return self._cache[key]
    self.cache_misses += 1

    t0 = time.monotonic()

    llm_task = asyncio.create_task(self._llm_recognize(message, history))
    emb_task = asyncio.create_task(self._embedding_recognize(message)) if self._embedding_enabled else None
    pat = self._pattern_recognize(message)

    if emb_task:
        llm, emb = await asyncio.gather(llm_task, emb_task)
    else:
        llm = await llm_task
        emb = {"intent": IntentCategory.OTHER, "confidence": 0.0}

    intent = self._vote(llm, emb, pat)
    entities = await self._extract_entities(message)
    urgency = self._urgency(message, intent)
```
## llm意图
1. 构造消息-意图模板
2. 用户最近3条信息上下文
3. 用户询问消息
```py
    async def _llm_recognize(  
        self,  
        message: str,  
        history: Optional[List[Dict[str, str]]],  
    ) -> Dict[str, Any]:  
        """策略 1：LLM 语义理解（Few-shot + 上下文）。"""  
        message = self._clean_text(message)  
        # 构建 Few-shot 示例  
        examples = "\n".join(  
            f'  消息: "{t}" → 意图: {cat.value}'  
            for cat, tpls in _TEMPLATES.items()  
            for t in tpls[:1]  # 每类取 1 条，控制 prompt 长度  
        )  
        # 最近 3 轮对话上下文  
        ctx = ""  
        if history:  
            ctx = "\n最近对话:\n" + "\n".join(  
                f"  {self._clean_text(m.get('role', 'user'))}: {self._clean_text(m.get('content', ''))}"  
                for m in history[-3:]  
            )  
  
        prompt = f"""你是客服意图分析专家。根据示例判断用户意图，返回 JSON。  
  
示例:  
{examples}  
  
{ctx}  
用户消息: "{message}"  
  
返回格式（仅 JSON，不要其他文字）:  
{{"intent": "<意图值>", "confidence": <0-1>, "reasoning": "<一句话说明>"}}  
  
可选意图: {", ".join(c.value for c in IntentCategory)}"""  
        prompt = self._clean_text(prompt)  
  
        try:  
            resp = await self.client.messages.create(  
                model=self.model,  
                max_tokens=256,  
                temperature=0.1,  
                messages=[{"role": "user", "content": prompt}],  
            )  
            raw = extract_text_content(resp.content)  
            s, e = raw.find("{"), raw.rfind("}") + 1  
            data = json.loads(raw[s:e])  
            try:  
                data["intent"] = IntentCategory(data["intent"])  
            except ValueError:  
                data["intent"] = IntentCategory.OTHER  
            return data  
        except Exception as ex:  
            logger.warning(f"LLM 识别失败: {ex}")  
            return {"intent": IntentCategory.OTHER, "confidence": 0.0, "reasoning": "LLM 失败", "failed": True}
```
## embedding意图
这里如果base_url是兼容anthropicSDK模型这不会启用这层意图,因为第三方模型目前无embedding能力
_local_embedding是给embedding模型兜底用的
```py
async def _embedding_recognize(self, message: str) -> Dict[str, Any]:  
    """策略 2：Embedding 向量相似度匹配。"""  
    try:  
        await self._load_template_embeddings()  
        msg_vec = await self._embed_text(message)  
  
        best_cat, best_score = IntentCategory.OTHER, 0.0  
        for cat, vecs in self._tpl_embeddings.items():  
            score = max(_cosine(msg_vec, v) for v in vecs)  
            if score > best_score:  
                best_score, best_cat = score, cat  
  
        return {"intent": best_cat, "confidence": best_score}  
    except Exception as ex:  
        logger.warning(f"Embedding 识别失败: {ex}")  
        return {"intent": IntentCategory.OTHER, "confidence": 0.0}
```
## 关键词匹配
```py
def _pattern_recognize(self, message: str) -> Dict[str, Any]:  
    """策略 3：关键词模式匹配（同步，零延迟兜底）。"""  
    msg = message.lower()  
    patterns = {  
        IntentCategory.ESCALATION: ["投诉", "经理", "转人工", "supervisor"],  
        IntentCategory.COMPLAINT:  ["太差", "糟糕", "horrible", "等了很久"],  
        IntentCategory.QUERY:      ["?", "？", "怎么", "什么", "status"],  
        IntentCategory.REQUEST:    ["帮我", "需要", "please", "help"],  
        IntentCategory.GREETING:   ["你好", "嗨", "hello", "hi"],  
        IntentCategory.BILLING:    ["退款", "扣款", "发票", "refund"],  
        IntentCategory.TECHNICAL:  ["崩溃", "报错", "error", "crash"],  
        IntentCategory.ACCOUNT:    ["密码", "邮箱", "账户", "password"],  
    }  
    best_cat, best_score = IntentCategory.OTHER, 0.0  
    for cat, kws in patterns.items():  
        hits = sum(1 for kw in kws if kw in msg)  
        if hits:  
            score = hits / len(kws)  
            if score > best_score:  
                best_score, best_cat = score, cat  
    return {"intent": best_cat, "confidence": best_score}
```
## 投票决策
根据三路的意图及可信度按照权重算每个意图的可信度
最终根据可信度进行意图判断(<0.5视为都没把握，降级到other)
```py
def _vote(self, llm: Dict, emb: Dict, pat: Dict) -> IntentCategory:  
    """加权投票。embedding 不可用时权重自动转移到 LLM 和 Pattern。"""  
    if llm.get("failed"):  
        if emb.get("intent") != IntentCategory.OTHER and emb.get("confidence", 0.0) > 0:  
            return emb["intent"]  
        if pat.get("intent") != IntentCategory.OTHER and pat.get("confidence", 0.0) > 0:  
            return pat["intent"]  
        return IntentCategory.OTHER  
  
    if self._embedding_enabled:  
        weights = [(llm, 0.7), (emb, 0.2), (pat, 0.1)]  
    else:  
        weights = [(llm, 0.85), (pat, 0.15)]  
    scores: Dict[IntentCategory, float] = {}  
    for result, w in weights:  
        cat  = result.get("intent", IntentCategory.OTHER)  
        conf = result.get("confidence", 0.0)  
        scores[cat] = scores.get(cat, 0.0) + w * conf  
  
    best = max(scores, key=scores.get)  # type: ignore  
    return best if scores[best] >= self.threshold else IntentCategory.OTHER
```
# 编排器
依赖于意图识别器提供意图
```py
async def run(self, req: Request) -> OrchestratorResult:  
    """  
    处理一次请求的完整流程：  
      意图识别 → 路由选 Agent → 执行 → 检查升级 → 返回结果  
    """    t0 = time.monotonic()  
  
    # 1. 意图识别（如果调用方已识别则跳过）  
    if req.intent is None:  
        intent_result = await self._intent_recognizer.recognize(req.message, history=req.history)  
        req.intent  = intent_result.intent  
        req.urgency = intent_result.urgency  
  
    # 复杂问题自动并行协作，例如同一句同时涉及登录故障和扣款/退款。  
    collaboration = self._collaboration_targets(req)  
    if len(collaboration) > 1:  
        return await self.run_parallel(req, collaboration)  
  
    # 2. 路由：选择 Agent 类型  
    agent_type = self._route(req.intent, req.urgency)  
  
    # 3. 执行（含降级）  
    response = await self._execute(req, agent_type)  
  
    # 4. 升级检查  
    escalated = False  
    if response.escalate or req.urgency == UrgencyLevel.CRITICAL or req.intent == IntentCategory.ESCALATION:  
        escalated = True  
        logger.warning(f"请求 {req.request_id} 触发升级: urgency={req.urgency}")  
        # 生产环境：此处创建工单、通知人工客服  
  
    return OrchestratorResult(  
        request_id=req.request_id,  
        response=response.content,  
        agent_type=response.agent_type,  
        intent=req.intent,  
        escalated=escalated,  
        latency_ms=(time.monotonic() - t0) * 1000,  
    )
```

## 是否并行判断
通过关键词匹配
```py
def _collaboration_targets(self, req: Request) -> List[AgentType]:  
    """  
    判断是否需要多个 Agent 并行协作。  
  
    意图识别通常只返回一个主意图；这里用领域关键词补充检测复合问题，    例如"登录报错且被重复扣款"需要技术和账单 Agent 同时处理。  
    """    msg = req.message.lower()  
    targets: List[AgentType] = []  
  
    technical_kws = ["崩溃", "报错", "error", "crash", "无法登录", "登录失败", "500", "401"]  
    billing_kws = ["退款", "扣款", "发票", "账单", "支付", "订阅", "refund", "invoice"]  
  
    if req.intent == IntentCategory.TECHNICAL or any(kw in msg for kw in technical_kws):  
        targets.append(AgentType.TECHNICAL)  
    if req.intent in (IntentCategory.BILLING, IntentCategory.ACCOUNT) or any(kw in msg for kw in billing_kws):  
        targets.append(AgentType.BILLING)  
  
    # 保持顺序去重，并只返回当前有实例的 Agent 类型。  
    deduped = list(dict.fromkeys(targets))  
    return [agent_type for agent_type in deduped if self._pool.get(agent_type)]
```
## 路由
```py
def _route(self, intent: Optional[IntentCategory], urgency: Optional[UrgencyLevel]) -> AgentType:  
    """  
    三层路由决策：  
      1. 意图映射  
      2. 紧急度覆盖（CRITICAL 直接升级）  
      3. 默认 GENERAL    """    if urgency == UrgencyLevel.CRITICAL:  
        return AgentType.ESCALATION  
  
    if intent and intent in self._INTENT_ROUTING:  
        target = self._INTENT_ROUTING[intent]  
        # 如果目标类型有可用实例则使用，否则降级  
        if target in self._pool and self._pool[target]:  
            return target  
  
    return AgentType.GENERAL
```
## 执行

项目架构支持同一类型agent有多个实例,水平扩展
每个agent实例的生命周期是服务性的，从服务启动到结束
```py
# Agent 池：每种类型可有多个实例（水平扩展）  
self._pool: Dict[AgentType, List[BaseAgent]] = {  
    AgentType.GENERAL:   [GeneralAgent(client, model, skill_manager)],  
    AgentType.TECHNICAL: [TechnicalAgent(client, model, skill_manager)],  
    AgentType.BILLING:   [BillingAgent(client, model, skill_manager)],  
}
```
先获取到best_agent
然后调用，专属agent失败则降级
```py
def _best_agent(self, agent_type: AgentType) -> Optional[BaseAgent]:  
    """  
    性能路由：从同类 Agent 中选 routing_score() 最高的。  
    这是"基于在线表现动态调整路由"的核心。  
    """    agents = self._pool.get(agent_type, [])  
    if not agents:  
        return None  
    return max(agents, key=lambda a: a.stats.routing_score())  
  
async def _execute(self, req: Request, agent_type: AgentType) -> AgentResponse:  
    """执行 Agent，失败时降级到 GeneralAgent。"""  
    agent = self._best_agent(agent_type)  
    if agent is None:  
        agent = self._best_agent(AgentType.GENERAL)  
    if agent is None:  
        return AgentResponse(  
            agent_type=AgentType.GENERAL,  
            content="服务暂时不可用，请稍后重试。",  
            success=False,  
        )  
  
    response = await agent.handle(req)  
  
    # 专属 Agent 失败时降级到 GeneralAgent    if not response.success and agent_type != AgentType.GENERAL:  
        logger.warning(f"{agent_type.value} 失败，降级到 GeneralAgent")  
        fallback = self._best_agent(AgentType.GENERAL)  
        if fallback:  
            response = await fallback.handle(req)  
  
    return response
```
# skill

1. 加载：启动时扫描目录
```py
_skill_manager = SkillManager(root_dir=skills_dir)   
  _skill_manager.load()       # 扫描 skills/ 目录，解析
  Markdown/JSON                                        
  _orchestrator = AgentOrchestrator(...,               
  skill_manager=_skill_manager) 
```
2. 请求时动态匹配
编排器调用llm前，先构建skill
匹配规则是看agent_type是否命中SKILL.md的agents、keywords
```py
 def _build_system_prompt(self, req: Request) -> str: 
      skill_prompt = self._skill_manager.prompt_for(   
          req.message,              #                  
  用消息内容匹配关键字                                 
          self.agent_type.value     # 用 Agent         
  类型匹配白名单                                       
      )                                                
      if not skill_prompt:                             
          return self.system_prompt                    
      # 拼进 system prompt                             
      return f"{self.system_prompt}\n\n[动态           
  Skills]\n{skill_prompt}" 
```
3. 热重载：运行时刷新，无需重启

```py
@app.post("/skills/reload")
async def reload_skills():
    _skill_manager.reload()                        # 重新扫描文件
    _orchestrator.set_skill_manager(_skill_manager) # 更新所有 Agent 的引用
    return _skill_manager.summary()

```
链路总结：

skills/ 目录里的 SKILL.md
  ↓ 启动时 load() → 解析成内存对象
  ↓ 请求时 prompt_for(message, agent_type) → 匹配规则
  ↓ 拼入 system prompt → 发给 LLM
  ↓ POST /skills/reload → 重新扫描 → 下次请求就用新的

"热"就热在第三步——改完 Skill 文件后调一下接口，下一个请求的 system prompt 里就是新内容了，服务一直没断
# 记忆系统




|      |                       |                  |
| ---- | --------------------- | ---------------- |
| 层级   | 存储                    | 内容               |
| 工作记忆 | Redis                 | 当前会话最近消息，24h TTL |
| 情景记忆 | ChromaDB episodic     | 压缩后的历史对话摘要       |
| 用户画像 | ChromaDB user_profile | 用户偏好和关键实体        |
** message / history / context 三者区别 **            
                          
  - message：用户原话，原样传递                       
  - history：[{role, content}]                        
  结构化列表，只给意图识别用                          
  - context：Memory + RAG 拼成的一大段背景文本，给    
  Agent LLM 当 [背景信息] 注入                        
  - history 和 context 里的 [最近对话] 来自同一份     
  recent_messages，格式不同、消费者不同
  
**  写入时机 **                                        
                                                      
  - 工作记忆：每次 /chat 收发消息立刻写入（同步）     
  - 情景记忆：工作记忆攒到 ≥15 条时 _compress() 触发  
  - 用户画像：每次 /chat 结束后 asyncio.create_task   
  异步更新
  
**记忆上下文**
```py
class MemoryContext:  
    """传给 Agent 的完整上下文。"""  
    recent_messages:  List[Message]   # 工作记忆：最近对话  
    relevant_history: List[str]       # 情景记忆：语义相关的历史片段  
    user_profile:     Dict[str, Any]  # 用户画像：偏好、常用实体  
    summary:          str             # 当前会话摘要（压缩后）
```
## get_context
```py
async def get_context(self, user_id: str, conv_id: str, query: str = "") -> MemoryContext:  
    """  
    构建完整的记忆上下文。  
  
    query 用于从情景记忆中检索语义相关的历史片段。  
    """    # 1. 工作记忆（当前会话最近消息）  
    user_id = self._safe_text(user_id)  
    conv_id = self._safe_text(conv_id)  
    query = self._safe_text(query)  
  
    recent = await self._get_working_memory(user_id, conv_id)  
  
    # 2. 情景记忆（跨会话语义检索）  
    history = await self._search_episodic(user_id, query or (recent[-1].content if recent else ""))  
  
    # 3. 用户画像  
    profile = await self._get_profile(user_id)  
  
    # 4. 会话摘要（如果已压缩过）  
    summary = self._redis.get(self._summary_key(user_id, conv_id)) or ""  
  
    return MemoryContext(  
        recent_messages=recent,  
        relevant_history=history,  
        user_profile=profile,  
        summary=summary,  
    )
```
## add_messgae
```py
"""将一条消息写入工作记忆，超阈值时自动压缩。"""  
user_id = self._safe_text(user_id)  
conv_id = self._safe_text(conv_id)  
clean_metadata = {  
    self._safe_text(k): self._safe_metadata_value(v)  
    for k, v in (metadata or {}).items()  
}  
msg = Message(role=role, content=self._safe_text(content), metadata=clean_metadata)  
key = self._wm_key(user_id, conv_id)  
  
# 追加到 Redis 列表（左推，最新在前）  
self._redis.lpush(key, json.dumps({  
    "role":      msg.role.value,  
    "content":   msg.content,  
    "ts":        msg.timestamp.isoformat(),  
    "metadata":  msg.metadata,  
}))  
self._redis.expire(key, 86400)  # 24h TTL  
  
# 超过压缩阈值时触发压缩  
if self._redis.llen(key) >= self.COMPRESS_AT:  
    await self._compress(user_id, conv_id)
```
## compact
```py

async def _compress(self, user_id: str, conv_id: str) -> None:  
    """  
    工作记忆压缩：  
      1. 用 LLM 对旧消息生成摘要  
      2. 摘要存 Redis（覆盖旧摘要）  
      3. 旧消息存入情景记忆（ChromaDB）供跨会话检索  
      4. 工作记忆只保留最近 5 条  
    """    messages = await self._get_working_memory(user_id, conv_id)  
    if len(messages) < self.COMPRESS_AT:  
        return  
  
    to_compress = messages[:-5]   # 保留最近 5 条  
    keep        = messages[-5:]  
  
    # LLM 摘要  
    text = self._safe_text("\n".join(f"{m.role.value}: {m.content}" for m in to_compress))  
    prompt = self._safe_text(f"用 2-3 句话总结以下对话的关键信息：\n{text}")  
    try:  
        resp = await self._client.messages.create(  
            model=self._model, max_tokens=256, temperature=0.0,  
            messages=[{"role": "user", "content": prompt}],  
        )  
        summary = self._safe_text(extract_text_content(resp.content)).strip()  
    except Exception:  
        summary = f"对话包含 {len(to_compress)} 条消息（摘要生成失败）"  
  
    # 存摘要到 Redis    skey = self._summary_key(user_id, conv_id)  
    old_summary = self._redis.get(skey) or ""  
    new_summary = self._safe_text(f"{old_summary}\n{summary}").strip()  
    self._redis.setex(skey, 86400, new_summary)  
  
    # 旧消息存入情景记忆  
    await self._store_episodic(user_id, conv_id, text, summary)  
  
    # 重置工作记忆为最近 5 条  
    key = self._wm_key(user_id, conv_id)  
    self._redis.delete(key)  
    for m in reversed(keep):  
        self._redis.lpush(key, json.dumps({  
            "role": m.role.value, "content": m.content,  
            "ts": m.timestamp.isoformat(), "metadata": m.metadata,  
        }))  
    self._redis.expire(key, 86400)  
    logger.info(f"工作记忆压缩完成: {user_id}/{conv_id}，摘要 {len(summary)} 字")

```

# 工具
## call
1. 查缓存
2. 熔断检查
3. llm重排
```py
async def call(  
    self,  
    name: str,  
    params: Dict[str, Any],  
    context: Optional[Dict[str, Any]] = None,  
    *,  
    use_cache: bool = True,  
    rerank_top_k: int = 0,          # >0 时对结果重排，取 Top-K) -> ToolResult:  
    """  
    调用工具，完整执行链：  
      缓存检查 → 熔断检查 → 参数校验 → 执行（含超时）→ 可选重排 → 缓存写入  
    """    tool = self._tools.get(name)  
    if not tool:  
        return ToolResult(success=False, data=None, tool_name=name, error=f"工具不存在: {name}")  
  
    cache_rerank_top_k = rerank_top_k if rerank_top_k > 0 and tool.supports_rerank else 0  
  
    # 缓存命中  
    if use_cache and tool.cache_ttl > 0:  
        cached = self._get_cache(name, params, cache_rerank_top_k)  
        if cached is not None:  
            cached_data, cached_reranked = cached  
            tool.stats.total += 1  
            tool.stats.success += 1  
            return ToolResult(  
                success=True,  
                data=cached_data,  
                tool_name=name,  
                cached=True,  
                reranked=cached_reranked,  
            )  
  
    # 熔断检查  
    if not tool.breaker.allow():  
        error = f"工具熔断中: {name}，请稍后重试"  
        return await self._fallback_result(tool, params, context, error)  
  
    t0 = time.monotonic()  
    tool.stats.total += 1  
    try:  
        # 参数校验（根据 JSON Schema 的 required 和 properties.type）  
        self._validate_params(tool, params)  
  
        data = await asyncio.wait_for(tool.handler(params, context), timeout=tool.timeout_s)  
        latency = (time.monotonic() - t0) * 1000  
  
        tool.stats.success += 1  
        tool.stats.consecutive_fails = 0  
        tool.stats.total_latency_ms += latency  
        tool.breaker.record_success()  
  
        # 重排（针对返回列表的检索工具）  
        reranked = False  
        if rerank_top_k > 0 and tool.supports_rerank and isinstance(data, list):  
            query = params.get("query", "")  
            data, reranked = await self._rerank(query, data, rerank_top_k), True  
  
        # 写缓存：缓存最终返回结果，避免下次命中未重排的原始结果。  
        if tool.cache_ttl > 0:  
            self._set_cache(name, params, data, tool.cache_ttl, cache_rerank_top_k, reranked)  
  
        return ToolResult(success=True, data=data, tool_name=name,  
                          latency_ms=latency, reranked=reranked)  
  
    except asyncio.TimeoutError:  
        tool.stats.failed += 1  
        tool.stats.consecutive_fails += 1  
        tool.breaker.record_failure()  
        logger.error(f"工具超时: {name} ({tool.timeout_s}s)")  
        return await self._fallback_result(tool, params, context, "执行超时")  
  
    except Exception as ex:  
        tool.stats.failed += 1  
        tool.stats.consecutive_fails += 1  
        tool.breaker.record_failure()  
        logger.error(f"工具异常: {name} — {ex}")  
        return await self._fallback_result(tool, params, context, str(ex))
```
## 子查询
```py
async def rewrite_query(self, query: str, n: int = 3) -> List[str]:  
        """  
        用 LLM 将原始查询改写为 n 个不同角度的子查询。  
  
        目的：单一查询往往只能召回某一角度的文档，        多角度子查询并行检索后合并，显著提升召回率。  
        示例：          原始: "退款流程"  
          改写: ["如何申请退款", "退款需要多少天", "退款政策是什么"]  
        """        prompt = f"""将以下用户查询改写为 {n} 个不同角度的搜索子查询，用于检索知识库。  
要求：每个子查询角度不同，覆盖原始问题的不同方面。  
原始查询: "{query}"  
返回 JSON 数组，例如: ["子查询1", "子查询2", "子查询3"]"""  
        prompt = self._clean_text(prompt)  
        try:  
            resp = await self._client.messages.create(  
                model=self._model, max_tokens=256, temperature=0.3,  
                messages=[{"role": "user", "content": prompt}],  
            )  
            raw = extract_text_content(resp.content)  
            s, e = raw.find("["), raw.rfind("]") + 1  
            queries = json.loads(raw[s:e])  
            # 原始查询也保留，去重  
            return list(dict.fromkeys([query] + queries))  
        except Exception as ex:  
            logger.warning(f"查询改写失败，使用原始查询: {ex}")  
            return [query]
```

## llm重排
```py
async def _rerank(self, query: str, items: List[Any], top_k: int) -> List[Any]:  
        """  
        用 LLM 对召回结果重新打分排序。  
  
        解决问题：向量检索的相似度分数不等于"对用户有用"，  
        LLM 能理解语义相关性，重排后 Top-K 质量显著提升。  
        """        if len(items) <= top_k:  
            return items  
  
        # 将结果序列化为文本供 LLM 评分  
        items_text = "\n".join(f"{i}. {json.dumps(item, ensure_ascii=False)[:200]}"  
                               for i, item in enumerate(items))  
        prompt = f"""根据用户查询，对以下检索结果按相关性打分（0-10），返回 JSON 数组。  
用户查询: "{query}"  
检索结果:  
{items_text}  
  
返回格式（按相关性降序排列的索引列表）: [最相关的索引, ..., 最不相关的索引]  
只返回 JSON 数组，不要其他文字。"""  
        prompt = self._clean_text(prompt)  
  
        try:  
            resp = await self._client.messages.create(  
                model=self._model, max_tokens=256, temperature=0.0,  
                messages=[{"role": "user", "content": prompt}],  
            )  
            raw = extract_text_content(resp.content)  
            s, e = raw.find("["), raw.rfind("]") + 1  
            order: List[int] = json.loads(raw[s:e])  
            reranked = [items[i] for i in order if 0 <= i < len(items)]  
            return reranked[:top_k]  
        except Exception as ex:  
            logger.warning(f"重排失败，返回原始顺序: {ex}")  
            return items[:top_k]
```
## rag_context构建
```py
async def _build_knowledge_context(message: str, top_k: int = 3) -> tuple[str, bool]:  
    """  
    为 /chat 主链路构建 RAG 知识上下文。  
  
    这里复用 MCPToolManager 的查询改写、并行召回、重排、fallback 能力。  
    """    if _tool_manager is None:  
        return "", False  
    if not _should_use_knowledge(message):  
        return "", False  
    try:  
        result = await _tool_manager.search_with_rewrite("knowledge_search", message, top_k=top_k)  
        if not result.success or not isinstance(result.data, list) or not result.data:  
            return "", False  
  
        parts = ["[知识库检索结果]"]  
        used = False  
        for i, item in enumerate(result.data[:top_k], start=1):  
            if not isinstance(item, dict):  
                continue  
            title = str(item.get("title", "未命名文档"))  
            content = str(item.get("content", "")).strip()  
            score = item.get("score", "")  
            if not content:  
                continue  
            used = True  
            parts.append(f"{i}. 标题: {title}\n   相关度: {score}\n   内容: {content[:600]}")  
  
        if not used:  
            return "", False  
        parts.append("请优先依据以上知识库内容回答；如果知识库内容不足，再结合通用客服能力说明。")  
        return "\n".join(parts), True  
    except Exception as ex:  
        logger.warning(f"构建知识库上下文失败: {ex}")  
        return "", False
```

# /chat接口
1. 构建上下文
2. 构建编排请求
3. 处理编排请求(包括意图识别)
4. 更新记忆
5. 异步更新画像
6. 返回响应

```python
@app.post("/chat", response_model=ChatResponse)

async def chat(req: ChatRequest):

    """

    主对话接口。完整流程：

      记忆读取 → 意图识别 → Agent 路由 → 执行 → 记忆写入

    """

    if _orchestrator is None or _memory is None:

        raise HTTPException(503, "服务未就绪")

  

    from agents.agent_orchestrator import Request as OrcReq

    from memory.conversation_memory import MsgRole

  

    conv_id = req.conv_id or str(uuid.uuid4())

  

    # 1. 读取记忆上下文

    mem_ctx = await _memory.get_context(req.user_id, conv_id, query=req.message)

  

    # 2. 构建编排请求（含对话历史，用于意图识别上下文）

    history = [

        {"role": m.role.value, "content": m.content}

        for m in mem_ctx.recent_messages[-5:]

    ] if mem_ctx.recent_messages else None

  

    knowledge_text, knowledge_used = await _build_knowledge_context(req.message)

    context_parts = [mem_ctx.to_prompt_text()]

    if knowledge_text:

        context_parts.append(knowledge_text)

    full_context = "\n\n".join(part for part in context_parts if part)

  

    orch_req = OrcReq(

        message=req.message,

        user_id=req.user_id,

        conv_id=conv_id,

        context=full_context,

        history=history,

    )

  

    # 3. 执行

    result = await _orchestrator.run(orch_req)

  

    # 4. 写入记忆

    await _memory.add_message(req.user_id, conv_id, MsgRole.USER, req.message)

    await _memory.add_message(req.user_id, conv_id, MsgRole.ASSISTANT, result.response)

  

    # 5. 异步更新用户画像（不阻塞响应）

    asyncio.create_task(_memory.update_profile(req.user_id, conv_id))

  

    return ChatResponse(

        conv_id=conv_id,

        response=result.response,

        intent=result.intent.value if result.intent else "other",

        agent_type=result.agent_type.value,

        escalated=result.escalated,

        latency_ms=round(result.latency_ms, 1),

        knowledge_used=knowledge_used,

    )
```