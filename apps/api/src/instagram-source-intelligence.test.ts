import {describe,expect,it} from "vitest";
import {analyzeInstagramSource} from "./instagram-source-intelligence";

describe("Instagram source intelligence",()=>{
  it("derives inspectable patterns with bounded evidence and explicit limitations",()=>{
    const result=analyzeInstagramSource([
      {id:"m1",caption:"Duke performance for daily riders",mediaProductType:"REELS",timestamp:"2026-08-03T10:00:00Z",likeCount:20,commentsCount:3,thumbnailUrl:"https://cdn.example/m1.jpg"},
      {id:"m2",caption:"Daily performance setup",mediaType:"CAROUSEL_ALBUM",timestamp:"2026-08-10T12:00:00Z",likeCount:10,commentsCount:1},
      {id:"m3",caption:"Performance comparison",mediaType:"IMAGE",timestamp:"2026-08-17T13:00:00Z"},
    ]);
    expect(result).toMatchObject({sampleSize:3,metricsSampleSize:2});
    expect(result.patterns.find((pattern)=>pattern.kind==="topic")).toMatchObject({label:"Recurring topic: performance",evidenceMediaIds:["m1","m2","m3"]});
    expect(result.patterns.find((pattern)=>pattern.kind==="timing")?.observation).toContain("descriptive, not a performance recommendation");
    expect(result.patterns.find((pattern)=>pattern.kind==="engagement")?.evidenceMediaIds).toEqual(["m1","m2"]);
    expect(result.limitations[0]).toContain("do not establish causation");
  });

  it("does not invent engagement or visual evidence when fields are missing",()=>{
    const result=analyzeInstagramSource([{id:"m1",caption:"A single post"}]);
    expect(result.patterns.some((pattern)=>pattern.kind==="engagement")).toBe(false);
    expect(result.limitations.join(" ")).toContain("Engagement counts were unavailable");
    expect(result.limitations.join(" ")).toContain("visual style was not inferred");
  });
});
