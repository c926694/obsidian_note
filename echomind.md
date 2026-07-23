## 意图识别器
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
### llm意图
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
### embedding意图
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
### 关键词匹配
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
### 投票决策
根据三路的意图及可信度按照权重算每个意图的
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