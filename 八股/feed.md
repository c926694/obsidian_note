# 点赞流程
lua+redis点赞,kafka异步更新db,然后发送kafka更新热度,是增量更新
kafka发送失败会
# 点赞查询
点赞查询先查db,然后根据userId去redis isMember判断点赞状态
# 热榜过程
redis维护一个1m:xxxxxxxx某分钟内的所有视频热度
点赞or评论时kafka更新热度
查询热榜对当前时间-internal的视频热度zset合并
形成merge zset,规则是相同video_id,score相加
查询s.redisClient.ZRevRange(ctx, mergeKey, start, stop)
然后根据video_ids去db补详情