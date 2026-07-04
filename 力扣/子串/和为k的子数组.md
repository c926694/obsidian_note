subSum<=>pre[j]-pre[i]=k
=>pre[i]=pre[j]-k
两数之和用哈希
维护pre[i]
查找pre[j]-k
if ok 则ans+=cnt,因为表明有cnt个前缀和和当前前缀和匹配了
![[Pasted image 20260704001108.png]]
```go
package main

  

func subarraySum(nums []int, k int) int {

  var pre int

  m := make(map[int]int)

  m[0] = 1

  var res int

  for _, value := range nums {

    pre += value

    if cnt, ok := m[pre-k]; ok {

      res += cnt

    }

    m[pre]++

  }

  return res

}
```