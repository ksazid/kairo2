"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ArrowRight,
  BookOpenCheck,
  Brain,
  BriefcaseBusiness,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock3,
  FileText,
  Globe2,
  Instagram,
  Linkedin,
  Lightbulb,
  ListChecks,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  SearchCheck,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  UserRound,
  UsersRound,
  X,
  Youtube,
} from "lucide-react";
import {
  reviewCount,
  updateBrandField,
  type BrandBrainField,
  type DiscoveryTopic,
} from "../../lib/brand-brain";
import {
  projectRuntimeFields,
  projectRuntimeLearnings,
  projectRuntimeSources,
  projectRuntimeTopics,
  type BrandBrainRuntimeData,
  type BrandLearningUi,
  type BrandSourceUi,
} from "../../lib/brand-brain-runtime";
import { discoveryRefreshNotice, refreshDiscovery } from "../../lib/discovery-refresh";

type TabId = "overview" | "dna" | "discovery" | "sources" | "learning";

const tabs: Array<{ id: TabId; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "dna", label: "Brand DNA" },
  { id: "discovery", label: "Discovery Intelligence" },
  { id: "sources", label: "Sources" },
  { id: "learning", label: "Learning" },
];

export function BrandBrainClient({ brandId, activation }: { brandId?: string; activation?: BrandBrainRuntimeData }) {
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [runtime, setRuntime] = useState<BrandBrainRuntimeData | undefined>(activation);
  const [fields, setFields] = useState<BrandBrainField[]>(() => projectRuntimeFields(activation));
  const [topics, setTopics] = useState<DiscoveryTopic[]>(() => projectRuntimeTopics(activation));
  const [sources, setSources] = useState<BrandSourceUi[]>(() => projectRuntimeSources(activation));
  const [learnings, setLearnings] = useState<BrandLearningUi[]>(() => projectRuntimeLearnings(activation));
  const [editingField, setEditingField] = useState<string | null>(null);
  const [fieldDraft, setFieldDraft] = useState("");
  const [notice, setNotice] = useState(activation ? "Brand Brain loaded from live Brand intelligence." : "Complete onboarding to build Brand Brain.");
  const [saving, setSaving] = useState(false);
  const pending = reviewCount(fields);

  function applyRuntime(next: BrandBrainRuntimeData) {
    setRuntime(next);
    setFields(projectRuntimeFields(next));
    setTopics(projectRuntimeTopics(next));
    setSources(projectRuntimeSources(next));
    setLearnings(projectRuntimeLearnings(next));
  }

  function chooseTab(tab: TabId) {
    setActiveTab(tab);
    setNotice(`${tabs.find((item) => item.id === tab)?.label ?? "Brand Brain"} opened.`);
  }

  function startFieldEdit(field: BrandBrainField) {
    setEditingField(field.key);
    setFieldDraft(field.value === "Not known yet" ? "" : field.value);
  }

  async function saveField(field: BrandBrainField) {
    if (!brandId || !fieldDraft.trim()) {
      setNotice(!brandId ? "Choose a Brand before editing Brand DNA." : `${field.label} cannot be empty.`);
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/brain", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "edit-field", brandId, fieldKey: field.fieldKey, section: field.section, value: fieldDraft, ...(field.version ? { expectedVersion: field.version } : {}) }),
      });
      const body = await response.json() as BrandBrainRuntimeData & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Kairo could not save this field.");
      applyRuntime(body);
      setEditingField(null);
      setFieldDraft("");
      setNotice(`${field.label} confirmed. Brand Intelligence and the Discovery Plan were recalculated.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Kairo could not save this field.");
    } finally {
      setSaving(false);
    }
  }

  async function addSource() {
    if (!brandId) {
      setNotice("Choose a Brand before adding a source.");
      return;
    }
    const url = window.prompt("Public website or profile URL");
    if (!url?.trim()) return;
    setSaving(true);
    try {
      const response = await fetch("/api/brain", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "add-source", brandId, url }),
      });
      const body = await response.json() as BrandBrainRuntimeData & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Kairo could not add this source.");
      applyRuntime(body);
      setNotice("Source added. Brand DNA, readiness, evidence coverage and the Discovery Plan were recalculated.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Kairo could not add this source.");
    } finally {
      setSaving(false);
    }
  }

  async function editTopic(topic: DiscoveryTopic) {
    if (!brandId || !runtime?.discoveryPlan) {
      setNotice(!brandId ? "Choose a Brand before editing Discovery Intelligence." : "Discovery Plan is not available yet.");
      return;
    }
    const name = window.prompt("Discovery topic", topic.name)?.trim();
    if (!name) return;
    const audience = window.prompt("Target audience", topic.audience)?.trim();
    if (!audience) return;
    const entitiesText = window.prompt("Search entities — separate with commas", topic.entities.join(", "))?.trim();
    if (!entitiesText) return;
    const entities = [...new Set(entitiesText.split(/[,\n;]+/).map((value) => value.trim()).filter(Boolean))].slice(0, 12);
    if (!entities.length) return;

    setSaving(true);
    try {
      const response = await fetch("/api/brain", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "edit-topic", brandId, topicId: topic.id, expectedRevision: runtime.discoveryPlan.revision, name, audience, entities }),
      });
      const body = await response.json() as BrandBrainRuntimeData & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Kairo could not save this Discovery topic.");
      applyRuntime(body);
      setNotice(`Discovery topic saved in Plan revision ${body.discoveryPlan?.revision ?? runtime.discoveryPlan.revision + 1}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Kairo could not save this Discovery topic.");
    } finally {
      setSaving(false);
    }
  }

  function reviewSuggestions() {
    setActiveTab("dna");
    const next = fields.find((field) => field.state !== "confirmed");
    if (next) startFieldEdit(next);
  }

  async function discoveryAction() {
    if (!runtime?.hunterReady) {
      setNotice("Discovery cannot start until the required Brand context is ready.");
      return;
    }
    if (!brandId) {
      setNotice("Choose a Brand before refreshing Discovery.");
      return;
    }
    setSaving(true);
    setNotice("Discovery is running across the configured public sources…");
    try {
      const result = await refreshDiscovery(brandId);
      applyRuntime(result.activation);
      setNotice(discoveryRefreshNotice(result.run));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Kairo could not refresh discovery.");
    } finally {
      setSaving(false);
    }
  }

  return <section id="brand-brain" className="brand-brain" aria-labelledby="brand-brain-title">
    <header className="brand-brain-header">
      <div>
        <span><Brain aria-hidden="true"/>Brand intelligence</span>
        <h1 id="brand-brain-title">Brand Brain</h1>
        <p>What Kairo knows, what Discovery Intelligence uses, and what needs your confirmation.</p>
      </div>
      <div className="brand-brain-header-actions">
        <button className="brand-secondary-button" type="button" onClick={reviewSuggestions} disabled={!pending || saving}>
          <ListChecks aria-hidden="true"/>Review {pending} suggestion{pending === 1 ? "" : "s"}
        </button>
        <button className="brand-primary-button" type="button" onClick={() => void discoveryAction()} disabled={saving || !runtime?.hunterReady || !brandId}>
          {saving ? <RefreshCw aria-hidden="true"/> : <Play aria-hidden="true" fill="currentColor"/>}{saving ? "Refreshing…" : runtime?.discoveryRun ? "Refresh Discovery" : "Run Discovery"}
        </button>
      </div>
    </header>

    <div className="brand-tab-list" role="tablist" aria-label="Brand Brain sections">
      {tabs.map((tab) => <button key={tab.id} id={`brand-tab-${tab.id}`} type="button" role="tab" aria-selected={activeTab === tab.id} aria-controls={`brand-panel-${tab.id}`} onClick={() => chooseTab(tab.id)}>
        {tab.label}{tab.id === "dna" && pending ? <span>{pending}</span> : null}
      </button>)}
    </div>

    <p className="brand-sr-status" role="status" aria-live="polite">{notice}</p>

    {activeTab === "overview" ? <OverviewPanel runtime={runtime} fields={fields} editingField={editingField} fieldDraft={fieldDraft} setFieldDraft={setFieldDraft} startFieldEdit={startFieldEdit} saveField={saveField} cancelEdit={() => setEditingField(null)} reviewSuggestions={reviewSuggestions} brandId={brandId} saving={saving}/> : null}
    {activeTab === "dna" ? <DnaPanel fields={fields} editingField={editingField} fieldDraft={fieldDraft} setFieldDraft={setFieldDraft} startFieldEdit={startFieldEdit} saveField={saveField} cancelEdit={() => setEditingField(null)} saving={saving}/> : null}
    {activeTab === "discovery" ? <DiscoveryPanel runtime={runtime} topics={topics} brandId={brandId} onEditTopic={editTopic} saving={saving}/> : null}
    {activeTab === "sources" ? <SourcesPanel runtime={runtime} sources={sources} onAddSource={addSource} saving={saving}/> : null}
    {activeTab === "learning" ? <LearningPanel learnings={learnings} brandId={brandId}/> : null}
  </section>;
}

function OverviewPanel({ runtime, fields, editingField, fieldDraft, setFieldDraft, startFieldEdit, saveField, cancelEdit, reviewSuggestions, brandId, saving }: {
  runtime?: BrandBrainRuntimeData; fields: BrandBrainField[]; editingField: string | null; fieldDraft: string; setFieldDraft: (value: string) => void; startFieldEdit: (field: BrandBrainField) => void; saveField: (field: BrandBrainField) => void; cancelEdit: () => void; reviewSuggestions: () => void; brandId?: string; saving: boolean;
}) {
  const audience = fields.find((field) => field.key === "audience")!;
  const content = fields.find((field) => field.key === "content")!;
  const gaps = new Set(runtime?.readiness.gaps ?? []);
  const readiness = [
    ["Business", !gaps.has("business"), BriefcaseBusiness],
    ["Offerings", !gaps.has("offerings"), Sparkles],
    ["Audience", !gaps.has("audience") && audience.state !== "review", UsersRound],
    ["Positioning", !gaps.has("positioning"), Target],
    ["Topics", !gaps.has("topics"), Lightbulb],
    ["Boundaries", !gaps.has("boundaries"), ShieldCheck],
  ] as const;
  const confirmed = confirmationScore(runtime);
  const statusLabel = runtime?.status === "ready-for-hunter" ? "Ready" : runtime?.status === "needs-review" ? "Needs review" : "Needs enrichment";
  const readinessTitle = runtime?.status === "ready-for-hunter" ? "Ready for the first discovery run" : runtime?.status === "needs-review" ? "Confirm key Brand context before Discovery" : "Add or confirm Brand context before Discovery";

  return <div id="brand-panel-overview" role="tabpanel" aria-labelledby="brand-tab-overview" className="brand-overview-panel">
    <div className="brand-readiness-card">
      <header><div><span><SearchCheck aria-hidden="true"/>Discovery readiness</span><h2>{runtime ? readinessTitle : "Complete onboarding to build Brand Intelligence"}</h2></div><span className="brand-ready-pill">{runtime?.hunterReady ? <CheckCircle2 aria-hidden="true"/> : <CircleAlert aria-hidden="true"/>}{runtime ? statusLabel : "Not ready"}</span></header>
      <div className="brand-score-row">
        <div className="brand-score"><strong>{runtime?.readiness.brandIntelligenceScore ?? 0}%</strong><span>Brand Intelligence</span></div>
        <div className="brand-score-bars">
          <ScoreBar label="Evidence coverage" value={runtime?.readiness.evidenceCoverage ?? 0}/>
          <ScoreBar label="Confirmed" value={confirmed}/>
          <div className="brand-run-times"><span><Clock3 aria-hidden="true"/><small>Last run</small><strong>{runtime?.discoveryRun ? formatTimestamp(runtime.discoveryRun.completedAt) : "Not run yet"}</strong></span><span><CalendarClock aria-hidden="true"/><small>Next run</small><strong>{runtime?.schedule ? formatTimestamp(runtime.schedule.nextRunAt) : "Not scheduled"}</strong></span></div>
        </div>
      </div>
      <div className="brand-readiness-list" aria-label="Discovery readiness checklist">{readiness.map(([label, ready, Icon]) => <div key={label}><span><Icon aria-hidden="true"/>{label}</span><strong className={ready ? "is-ready" : "needs-review"}>{ready ? <Check aria-hidden="true"/> : <CircleAlert aria-hidden="true"/>}{ready ? "Ready" : "Needs confirmation"}</strong></div>)}</div>
    </div>

    <div className="brand-review-card">
      <header><div><span><ListChecks aria-hidden="true"/>Human review</span><h2>Needs your confirmation</h2><p>Confirm only the details that materially improve discovery.</p></div><b>{reviewCount(fields)}</b></header>
      {audience.state !== "confirmed" ? <FieldReviewRow field={audience} expanded={editingField === audience.key} draft={editingField === audience.key ? fieldDraft : audience.value} setDraft={setFieldDraft} onEdit={() => startFieldEdit(audience)} onSave={() => saveField(audience)} onCancel={cancelEdit} saving={saving}/> : null}
      {content.state !== "confirmed" ? <FieldReviewRow field={content} expanded={editingField === content.key} draft={editingField === content.key ? fieldDraft : content.value} setDraft={setFieldDraft} onEdit={() => startFieldEdit(content)} onSave={() => saveField(content)} onCancel={cancelEdit} saving={saving}/> : null}
      {reviewCount(fields) === 0 ? <div className="brand-review-complete"><CheckCircle2 aria-hidden="true"/><span><strong>Everything important is confirmed.</strong><small>Discovery Intelligence can use this Brand context.</small></span></div> : null}
      <button className="brand-text-button" type="button" onClick={reviewSuggestions}>Review all Brand DNA <ArrowRight aria-hidden="true"/></button>
    </div>

    <div className="brand-daily-strip">
      <div><span><TrendingUp aria-hidden="true"/></span><p><strong>{runtime?.discoveryRun ? "Latest discovery result" : "Discovery has not run yet"}</strong><small>{runtime?.discoveryRun ? formatTimestamp(runtime.discoveryRun.completedAt) : "The first Hunter run will populate this section."}</small></p></div>
      <dl><div><dt>Valuable discoveries</dt><dd>{runtime?.discoveryRun?.valuableDiscoveries ?? "—"}</dd></div><div><dt>New topic clusters</dt><dd>{runtime?.discoveryRun?.newTopicClusters ?? "—"}</dd></div><div><dt>Weak signals filtered</dt><dd>{runtime?.discoveryRun?.weakSignalsFiltered ?? "—"}</dd></div></dl>
      <Link href={`/discover${brandId ? `?brand=${encodeURIComponent(brandId)}` : ""}`}>View Discover <ChevronRight aria-hidden="true"/></Link>
    </div>
  </div>;
}

function DnaPanel({ fields, editingField, fieldDraft, setFieldDraft, startFieldEdit, saveField, cancelEdit, saving }: { fields: BrandBrainField[]; editingField: string | null; fieldDraft: string; setFieldDraft: (value: string) => void; startFieldEdit: (field: BrandBrainField) => void; saveField: (field: BrandBrainField) => void; cancelEdit: () => void; saving: boolean }) {
  return <div id="brand-panel-dna" role="tabpanel" aria-labelledby="brand-tab-dna" className="brand-section-panel">
    <header className="brand-section-header"><div><span><Brain aria-hidden="true"/>Editable Brand model</span><h2>Brand DNA</h2><p>Click any value to correct or confirm what Kairo uses for recommendations and creation.</p></div><div className="brand-legend"><span><i className="confirmed"/>Confirmed</span><span><i className="suggested"/>AI suggested</span><span><i className="review"/>Needs review</span></div></header>
    <div className="brand-field-table" role="list"><div className="brand-field-head" aria-hidden="true"><span>Brand context</span><span>Source / evidence</span><span>Status</span><span>Edit</span></div>{fields.map((field) => <BrandFieldRow key={field.key} field={field} editing={editingField === field.key} draft={editingField === field.key ? fieldDraft : field.value} setDraft={setFieldDraft} onEdit={() => startFieldEdit(field)} onSave={() => saveField(field)} onCancel={cancelEdit} saving={saving}/>)}</div>
  </div>;
}

function DiscoveryPanel({ runtime, topics, brandId, onEditTopic, saving }: { runtime?: BrandBrainRuntimeData; topics: DiscoveryTopic[]; brandId?: string; onEditTopic: (topic: DiscoveryTopic) => void; saving: boolean }) {
  const excluded = runtime?.discoveryPlan?.excludedTopics ?? [];
  return <div id="brand-panel-discovery" role="tabpanel" aria-labelledby="brand-tab-discovery" className="brand-discovery-panel">
    <section className="brand-search-plan">
      <header><div><span><SearchCheck aria-hidden="true"/>{runtime?.discoveryRun ? "Current discovery plan" : runtime?.discoveryPlan?.state === "customized" ? "Customized discovery plan" : "Initial discovery plan"}</span><h2>{runtime?.discoveryRun ? "What Kairo is searching" : "What Kairo will search when Discovery starts"}</h2><p>The plan is versioned against Brand Intelligence. User-customized topics stay authoritative until you edit them again.</p></div><div><span><CalendarClock aria-hidden="true"/><small>Plan revision</small><strong>{runtime?.discoveryPlan ? `v${runtime.discoveryPlan.revision}` : "Not created"}</strong></span></div></header>
      <div className="brand-topic-list">{topics.length ? topics.map((topic, index) => <TopicRow key={topic.id} topic={topic} index={index + 1} onEdit={() => onEditTopic(topic)} saving={saving}/>) : <div className="brand-review-complete"><CircleAlert aria-hidden="true"/><span><strong>No discovery topics yet.</strong><small>Confirm Content focus or add another source to improve the initial plan.</small></span></div>}</div>
      <footer><ShieldCheck aria-hidden="true"/><span><strong>Excluded topics</strong><small>{excluded.length ? excluded.join(", ") : "No explicit exclusions discovered yet."}</small></span></footer>
    </section>
    <aside className="brand-discovery-rail">
      <section className="brand-hunter-schedule">
        <header><span><CalendarClock aria-hidden="true"/>Hunter schedule</span><button type="button" disabled title="Automatic Hunter scheduling is reserved for the production scheduling slice."><Pencil aria-hidden="true"/>Unavailable</button></header>
        <dl><div><dt>Frequency</dt><dd>Not scheduled</dd></div><div><dt>Run time</dt><dd>—</dd></div><div><dt>Timezone</dt><dd>—</dd></div><div><dt>Depth</dt><dd>Per manual run</dd></div></dl>
        <p>Automatic background scheduling is not enabled in this release.</p>
        <button className="brand-schedule-toggle" type="button" disabled>Scheduling unavailable</button>
      </section>
      <section><span><Brain aria-hidden="true"/>Brand Intelligence</span><ScoreBar label="Overall intelligence" value={runtime?.readiness.brandIntelligenceScore ?? 0}/><ScoreBar label="Evidence coverage" value={runtime?.readiness.evidenceCoverage ?? 0}/><ScoreBar label="Confirmed" value={confirmationScore(runtime)}/></section>
      <section className="brand-discovery-status"><span><SearchCheck aria-hidden="true"/>Discovery status</span><strong>{runtime?.hunterReady ? "Ready" : "Not ready"}</strong><p>{runtime?.hunterReady ? "The persisted plan has enough Brand context for the first Hunter run." : "Confirm or enrich the required Brand context before Hunter relies on this plan."}</p></section>
      <section><span><TrendingUp aria-hidden="true"/>Previous run</span>{runtime?.discoveryRun ? <dl><div><dt>Valuable discoveries</dt><dd>{runtime.discoveryRun.valuableDiscoveries}</dd></div><div><dt>Weak signals filtered</dt><dd>{runtime.discoveryRun.weakSignalsFiltered}</dd></div></dl> : <p>No Hunter run has been recorded yet.</p>}<Link href={`/discover${brandId ? `?brand=${encodeURIComponent(brandId)}` : ""}`}>View Discover <ArrowRight aria-hidden="true"/></Link></section>
    </aside>
  </div>;
}

function SourcesPanel({ runtime, sources, onAddSource, saving }: { runtime?: BrandBrainRuntimeData; sources: BrandSourceUi[]; onAddSource: () => void; saving: boolean }) {
  return <div id="brand-panel-sources" role="tabpanel" aria-labelledby="brand-tab-sources" className="brand-section-panel">
    <header className="brand-section-header"><div><span><Globe2 aria-hidden="true"/>Evidence coverage</span><h2>Sources</h2><p>Manage where Kairo learns this Brand. Publishing destinations remain separate.</p></div><button className="brand-primary-button" type="button" onClick={onAddSource} disabled={saving}><Plus aria-hidden="true"/>{saving ? "Updating…" : "Add source"}</button></header>
    <div className="brand-source-summary"><div><strong>{sources.filter((source) => source.status === "active").length}</strong><span>Active sources</span></div><div><strong>{runtime?.readiness.evidenceCoverage ?? 0}%</strong><span>Evidence coverage</span></div><div><strong>{runtime?.updatedAt ? formatTimestamp(runtime.updatedAt) : "—"}</strong><span>Most recent sync</span></div></div>
    <div className="brand-source-list">{sources.length ? sources.map((source) => { const Icon = sourceIcon(source); return <article key={source.id}><span className="brand-source-icon"><Icon aria-hidden="true"/></span><div><small>{source.type}</small><strong>{source.title}</strong><p>{source.detail}</p></div><span className="brand-source-sync"><small>Last updated</small><strong>{source.synced}</strong></span><span className="brand-source-health"><CheckCircle2 aria-hidden="true"/>{source.status}</span><div className="brand-source-actions"><button type="button" disabled title="Source-specific refresh is activated with the source-management flow"><RefreshCw aria-hidden="true"/>Refresh</button><button type="button" disabled title="Source management is activated with the source-management flow">Manage</button></div></article>; }) : <div className="brand-review-complete"><CircleAlert aria-hidden="true"/><span><strong>No active sources yet.</strong><small>Add a public website or profile to build Brand Intelligence.</small></span></div>}</div>
    <p className="brand-source-note"><ShieldCheck aria-hidden="true"/>Private notes stay inside this Brand. Credentials and provider details are never exposed here.</p>
  </div>;
}

function LearningPanel({ learnings, brandId }: { learnings: BrandLearningUi[]; brandId?: string }) {
  return <div id="brand-panel-learning" role="tabpanel" aria-labelledby="brand-tab-learning" className="brand-section-panel">
    <header className="brand-section-header"><div><span><BookOpenCheck aria-hidden="true"/>Operational memory</span><h2>Learning</h2><p>What Kairo has learned from repeated, evidence-backed content performance and will use next time.</p></div><Link className="brand-secondary-button" href={`/insights${brandId ? `?brand=${encodeURIComponent(brandId)}` : ""}`}>Open Insights <ArrowRight aria-hidden="true"/></Link></header>
    <div className="brand-learning-guardrail"><ShieldCheck aria-hidden="true"/><span><strong>Your confirmed Brand DNA stays authoritative.</strong><small>Performance learning may adjust ranking and recommendations, but it never silently overwrites confirmed Brand facts.</small></span></div>
    {learnings.length ? <div className="brand-learning-list">{learnings.map((learning) => <article key={learning.id}><span><Lightbulb aria-hidden="true"/></span><div><strong>{learning.title}</strong><p>{learning.detail}</p><small>{learning.evidence}</small></div><div><small>How Kairo uses this</small><strong>{learning.effect}</strong></div><span className="brand-learning-accepted"><Check aria-hidden="true"/>Accepted</span></article>)}</div> : <div className="brand-review-complete"><BookOpenCheck aria-hidden="true"/><span><strong>No performance learning yet.</strong><small>Learning appears after content is published, performance metrics are collected, and an evidence-backed pattern is accepted. Insights remains the place to inspect the underlying analytics.</small></span></div>}
  </div>;
}

function FieldReviewRow({ field, expanded, draft, setDraft, onEdit, onSave, onCancel, saving }: { field: BrandBrainField; expanded: boolean; draft: string; setDraft: (value: string) => void; onEdit: () => void; onSave: () => void; onCancel: () => void; saving: boolean }) {
  return <section className={`brand-review-row ${expanded ? "is-expanded" : ""}`}><header><span><UserRound aria-hidden="true"/><span><strong>{field.label}</strong><small>{field.description}</small></span></span><StateLabel state={field.state}/>{expanded ? <ChevronDown aria-hidden="true"/> : <button type="button" onClick={onEdit} aria-label={`Edit ${field.label}`}><ChevronRight aria-hidden="true"/></button>}</header>{expanded ? <div className="brand-inline-editor"><label htmlFor={`overview-${field.key}`}>{field.description}</label><textarea id={`overview-${field.key}`} value={draft} onChange={(event) => setFieldDraftOrNoop(setDraft, event.target.value)} rows={3}/><div className="brand-evidence"><small>Evidence</small><span>{field.evidence.map((item) => <i key={item}>{item}</i>)}</span><p>{field.origin ? `${originLabel(field.origin)} · ${confidenceLabel(field.confidence)}` : "Evidence unavailable"}</p></div><div className="brand-editor-actions"><button type="button" onClick={onSave} disabled={saving}>{saving ? "Saving…" : "Save & confirm"}</button><button type="button" onClick={onCancel} disabled={saving}>Cancel</button></div></div> : <p>{field.value}</p>}</section>;
}

function BrandFieldRow({ field, editing, draft, setDraft, onEdit, onSave, onCancel, saving }: { field: BrandBrainField; editing: boolean; draft: string; setDraft: (value: string) => void; onEdit: () => void; onSave: () => void; onCancel: () => void; saving: boolean }) {
  return <div className={`brand-field-row ${editing ? "is-editing" : ""}`} role="listitem"><div className="brand-field-value"><span><strong>{field.label}</strong><small>{field.description}</small></span>{editing ? <textarea aria-label={`Edit ${field.label}`} value={draft} onChange={(event) => setDraft(event.target.value)} rows={2}/> : <p>{field.value}</p>}</div><div className="brand-field-evidence">{field.evidence.map((item) => <span key={item}>{item}</span>)}</div><StateLabel state={field.state}/><div className="brand-field-actions">{editing ? <><button className="save" type="button" onClick={onSave} disabled={saving}><Check aria-hidden="true"/>{saving ? "Saving…" : "Save"}</button><button type="button" onClick={onCancel} disabled={saving}><X aria-hidden="true"/>Cancel</button></> : <button type="button" onClick={onEdit} aria-label={`Edit ${field.label}`}><Pencil aria-hidden="true"/></button>}</div></div>;
}

function TopicRow({ topic, index, onEdit, saving }: { topic: DiscoveryTopic; index: number; onEdit: () => void; saving: boolean }) {
  return <article><span className="brand-topic-number">{index}</span><div className="brand-topic-main"><small>Topic</small><strong>{topic.name}</strong></div><div><small>Priority</small><strong className={`brand-priority ${topic.priority.toLowerCase()}`}><i/>{topic.priority}</strong></div><div><small>Target audience</small><strong>{topic.audience}</strong></div><button className="brand-topic-edit" type="button" onClick={onEdit} disabled={saving} title="Edit persisted Discovery Plan topic" aria-label={`Edit ${topic.name}`}><Pencil aria-hidden="true"/></button><div className="brand-topic-details"><small>Key search entities</small><span>{topic.entities.map((entity) => <i key={entity}>{entity}</i>)}</span><small>Likely sources</small><span>{topic.sources.map((source) => <i key={source}>{source}</i>)}</span></div></article>;
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  const normalized = Math.max(0, Math.min(100, Math.round(value)));
  return <div className="brand-score-bar"><span><small>{label}</small><strong>{normalized}%</strong></span><progress value={normalized} max={100} aria-label={`${label} ${normalized}%`}/></div>;
}

function StateLabel({ state }: { state: BrandBrainField["state"] }) {
  const label = state === "confirmed" ? "Confirmed" : state === "suggested" ? "AI suggested" : "Needs review";
  return <span className={`brand-field-state ${state}`}><i/>{label}</span>;
}

function confirmationScore(runtime?: BrandBrainRuntimeData): number {
  const active = runtime?.brain.filter((field) => field.state !== "stale") ?? [];
  if (!active.length) return 0;
  return Math.round(active.filter((field) => field.state === "confirmed").length / active.length * 100);
}

function sourceIcon(source: BrandSourceUi) {
  const value = `${source.type} ${source.sourceUrl ?? ""}`.toLowerCase();
  if (value.includes("instagram")) return Instagram;
  if (value.includes("linkedin")) return Linkedin;
  if (value.includes("youtube")) return Youtube;
  if (value.includes("note") || value.includes("document") || value.includes("pasted")) return FileText;
  return Globe2;
}

function originLabel(origin: BrandBrainField["origin"]): string {
  return origin === "user-confirmed" ? "User confirmed" : origin === "source-backed" ? "Source backed" : origin === "ai-inferred" ? "AI inferred" : "Unknown origin";
}

function confidenceLabel(confidence: BrandBrainField["confidence"]): string {
  return confidence === "high" ? "High confidence" : confidence === "medium" ? "Medium confidence" : confidence === "low" ? "Low confidence" : "Confidence not established";
}

function setFieldDraftOrNoop(setDraft: (value: string) => void, value: string): void {
  setDraft(value);
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(date);
}
