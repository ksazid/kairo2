import type { InstagramRecentMedia, InstagramSourceIntelligence } from "./instagram-connection";

const STOP_WORDS = new Set(["about","after","again","also","and","are","been","before","but","can","for","from","have","how","into","its","just","more","new","not","our","out","that","the","their","this","was","what","when","where","which","who","will","with","you","your"]);

export function analyzeInstagramSource(media: InstagramRecentMedia[]): InstagramSourceIntelligence {
  const sample = media.slice(0, 25);
  const patterns: InstagramSourceIntelligence["patterns"] = [];
  if (sample.length) {
    const types = group(sample, (item) => normalizedType(item));
    patterns.push({kind:"media-mix",label:"Recent format mix",observation:formatGroups(types),evidenceMediaIds:sample.map((item) => item.id)});

    const topics = topicGroups(sample);
    for (const [topic, items] of topics.slice(0, 3)) patterns.push({kind:"topic",label:`Recurring topic: ${topic}`,observation:`Appears in ${items.length} of ${sample.length} recent captions.`,evidenceMediaIds:items.map((item) => item.id)});

    const timed = sample.filter((item) => item.timestamp && Number.isFinite(Date.parse(item.timestamp)));
    if (timed.length >= 3) {
      const weekdays = group(timed, (item) => new Intl.DateTimeFormat("en", {weekday:"long",timeZone:"UTC"}).format(new Date(item.timestamp!)));
      const [day, items] = [...weekdays.entries()].sort(groupOrder)[0]!;
      patterns.push({kind:"timing",label:"Most-used publishing day",observation:`${day} appears most often in this ${timed.length}-post UTC sample. This is descriptive, not a performance recommendation.`,evidenceMediaIds:items.map((item) => item.id)});
    }

    const measured = sample.filter((item) => item.likeCount !== undefined || item.commentsCount !== undefined);
    if (measured.length >= 2) {
      const leaders = [...measured].sort((a,b) => engagement(b)-engagement(a)).slice(0, Math.min(3, measured.length));
      patterns.push({kind:"engagement",label:"Highest observed engagement",observation:`Ranks ${measured.length} posts by available likes plus comments; missing metrics are excluded, not treated as zero.`,evidenceMediaIds:leaders.map((item) => item.id)});
    }
  }
  const metricsSampleSize = sample.filter((item) => item.likeCount !== undefined || item.commentsCount !== undefined).length;
  const limitations = ["Patterns describe only the imported recent-media sample and do not establish causation."];
  if (!metricsSampleSize) limitations.push("Engagement counts were unavailable, so no engagement pattern was inferred.");
  if (!sample.some((item) => item.mediaUrl || item.thumbnailUrl)) limitations.push("Media previews were unavailable, so visual style was not inferred.");
  return {sampleSize:sample.length,metricsSampleSize,patterns,limitations};
}

function normalizedType(item: InstagramRecentMedia) { return (item.mediaProductType ?? item.mediaType ?? "unknown").toLowerCase(); }
function engagement(item: InstagramRecentMedia) { return (item.likeCount ?? 0)+(item.commentsCount ?? 0); }
function group<T>(items:T[], key:(item:T)=>string) { const result=new Map<string,T[]>(); for(const item of items){const value=key(item);result.set(value,[...(result.get(value)??[]),item]);} return result; }
function groupOrder<T>(a:[string,T[]],b:[string,T[]]) { return b[1].length-a[1].length || a[0].localeCompare(b[0]); }
function formatGroups(groups:Map<string,InstagramRecentMedia[]>) { return [...groups.entries()].sort(groupOrder).map(([name,items])=>`${name}: ${items.length}`).join(", "); }
function topicGroups(media:InstagramRecentMedia[]) {
  const topics=new Map<string,InstagramRecentMedia[]>();
  for(const item of media){
    const words=new Set((item.caption?.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}-]{2,}/gu)??[]).filter((word)=>!STOP_WORDS.has(word)&&!/^\d+$/.test(word)));
    for(const word of words){const items=topics.get(word)??[];items.push(item);topics.set(word,items);}
  }
  return [...topics.entries()].filter(([,items])=>items.length>=2).sort(groupOrder);
}
