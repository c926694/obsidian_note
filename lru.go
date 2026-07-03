package main

import "container/list"

type LRUCache struct {
	capacity  int
	cacheMap  map[int]*list.Element
	cacheList *list.List
}

type entry struct {
	key   int
	value int
}

func Constructor(capacity int) LRUCache {
	return LRUCache{capacity, make(map[int]*list.Element), list.New()}
}

func (this *LRUCache) Get(key int) int {
	if e, ok := this.cacheMap[key]; ok {
		//已经存在,更新位置
		this.cacheList.MoveToFront(e)
		return e.Value.(*entry).value
	}
	return -1
}

func (this *LRUCache) Put(key int, value int) {
	if e, ok := this.cacheMap[key]; ok {
		//已经存在,更新位置并覆盖原有k-v
		this.cacheList.MoveToFront(e)
		e.Value.(*entry).value = value
		return
	}
	if this.cacheList.Len() == this.capacity {
		//需要删除最后一个元素
		lastEntry := this.cacheList.Back()
		this.cacheList.Remove(lastEntry)
		delete(this.cacheMap, lastEntry.Value.(*entry).key)
	}
	//添加新元素
	newEntry := &entry{key, value}
	this.cacheList.PushFront(newEntry)
	this.cacheMap[key] = this.cacheList.Front()
}

/**
 * Your LRUCache object will be instantiated and called as such:
 * obj := Constructor(capacity);
 * param_1 := obj.Get(key);
 * obj.Put(key,value);
 */
