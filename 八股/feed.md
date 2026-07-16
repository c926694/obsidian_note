# 点赞流程
lua+redis点赞,kafka异步更新db,然后发送kafka更新热度,是增量更新
kafka发送失败会
# 点赞查询
点赞查询先查db,然后根据userId去redis isMember判断点赞状态
# 热榜过程
创建视频时redis维护一个1m:xxxxxxxx某分钟内的所有视频热度
点赞or评论时kafka更新热度
查询热榜对当前时间-internal的视频热度zset合并
形成merge zset,规则是相同video_id,score相加
查询s.redisClient.ZRevRange(ctx, mergeKey, start, stop)
然后根据video_ids去db补详情
# JWT 鉴权与 Token 失效控制
采用access_token+refresh_token双token认证机制
access_token用于用户认证,refresh_token用于刷新token
refresh_token存redis,用于多端登录和下线功能
前端带access_token，当这个token过期了请求/refresh接口获取新的
access_token
# 推荐流
传统分页一般这样做：
```
select * from video order by created_at desc limit 20 offset 100000;
```

问题是 `offset` 很大时，数据库要先跳过前面很多行，再取后面 20 条。对推荐流这种数据量大、更新频繁的场景，代价很高。

主要有两个问题：
性能差  
offset 越大，扫描和丢弃的数据越多。哪怕最后只返回 10 条，也可能先扫几万、几十万条。
游标分页:
- Redis ZSet 里按 score 排序
- 第一次查最新一批
- 下一次把上一页最后一条的 `score` 传回来
- 后端只查小于这个 score 的下一段数据