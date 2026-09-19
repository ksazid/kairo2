import{describe,expect,it}from"vitest";
import{identifyPerformancePatterns}from"./performance-patterns";

describe("performance pattern identification",()=>{
 it("identifies evidence-bound winners by content dimension without causal claims",()=>{const patterns=identifyPerformancePatterns([
  {publishedPostId:"p1",metricObservationIds:["m1"],score:.08,topic:"performance",hook:"question",structure:"pas",template:"bold",format:"reel",publishedAt:"2026-08-03T10:00:00Z"},
  {publishedPostId:"p2",metricObservationIds:["m2"],score:.10,topic:"performance",hook:"question",structure:"pas",template:"bold",format:"reel",publishedAt:"2026-08-10T10:00:00Z"},
  {publishedPostId:"p3",metricObservationIds:["m3"],score:.03,topic:"technology",hook:"statement",structure:"aida",template:"minimal",format:"carousel",publishedAt:"2026-08-05T15:00:00Z"},
  {publishedPostId:"p4",metricObservationIds:["m4"],score:.04,topic:"technology",hook:"statement",structure:"aida",template:"minimal",format:"carousel",publishedAt:"2026-08-12T15:00:00Z"},
 ]);expect(patterns.map(item=>[item.dimension,item.value])).toEqual(expect.arrayContaining([["topic","performance"],["hook","question"],["structure","pas"],["template","bold"],["format","reel"],["timing","Monday 10:00 UTC"]]));expect(patterns.every(item=>/not proof|Test again/.test(item.observation))).toBe(true);expect(patterns.find(item=>item.dimension==="topic")?.evidence).toEqual([{publishedPostId:"p1",metricObservationIds:["m1"]},{publishedPostId:"p2",metricObservationIds:["m2"]}])});
 it("requires comparison groups and repeated evidence",()=>{expect(identifyPerformancePatterns([{publishedPostId:"p1",metricObservationIds:["m1"],score:1,format:"reel"}])).toEqual([])});
});
