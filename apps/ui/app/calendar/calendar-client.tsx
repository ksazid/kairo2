"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Facebook,
  FileImage,
  Grid2X2,
  Instagram,
  Linkedin,
  List,
  MoreHorizontal,
  Pencil,
  PlaySquare,
  Plus,
  Save,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import {
  dateKey,
  filterCalendarItems,
  itemsForDay,
  monthDays,
  normalizeCalendarView,
  rangeLabel,
  shiftAnchor,
  weekDays,
  type CalendarChannel,
  type CalendarItem,
  type CalendarView,
} from "../../lib/calendar";
import { contentPreviewHref } from "../../lib/content";

const preferenceKey = "kairo:calendar-view";
const hourRows = Array.from({ length: 11 }, (_, index) => index + 8);
const viewOptions: Array<{ value: CalendarView; label: string; Icon: typeof CalendarDays }> = [
  { value: "month", label: "Month", Icon: CalendarDays },
  { value: "week", label: "Week", Icon: Grid2X2 },
  { value: "list", label: "List", Icon: List },
];

type DrawerState = { itemId?: string; date: string; time: string; open: boolean };

export function CalendarClient({ initialItems, brandId }: { initialItems: CalendarItem[]; brandId?: string }) {
  const [items, setItems] = useState(initialItems);
  const [view, setView] = useState<CalendarView>("week");
  const [anchor, setAnchor] = useState(() => new Date("2026-08-31T00:00:00Z"));
  const [channel, setChannel] = useState<CalendarChannel>("all");
  const [campaign, setCampaign] = useState("all");
  const [drawer, setDrawer] = useState<DrawerState>({ date: "2026-08-31", time: "10:00", open: false });
  const [notice, setNotice] = useState("");
  const visible = useMemo(() => filterCalendarItems(items, channel, campaign), [campaign, channel, items]);
  const campaigns = useMemo(() => Array.from(new Map(items.map((item) => [item.campaignId, item.campaignName])).entries()), [items]);
  const selected = drawer.itemId ? items.find((item) => item.id === drawer.itemId) : undefined;
  const unscheduled = visible.filter((item) => !item.scheduledAt);

  useEffect(() => setView(normalizeCalendarView(window.localStorage.getItem(preferenceKey))), []);

  function chooseView(next: CalendarView) {
    setView(next);
    window.localStorage.setItem(preferenceKey, next);
  }

  function openItem(item: CalendarItem) {
    const date = item.scheduledAt ? new Date(item.scheduledAt) : anchor;
    setDrawer({ itemId: item.id, date: dateKey(date), time: item.scheduledAt?.slice(11, 16) ?? "10:00", open: true });
    setNotice("");
  }

  function openSlot(date: Date, time = "10:00") {
    setDrawer({ date: dateKey(date), time, open: true });
    setNotice("");
  }

  function saveSchedule() {
    if (!selected) {
      setNotice("Choose a draft from the Unscheduled rail to add it here.");
      return;
    }
    const scheduledAt = `${drawer.date}T${drawer.time}:00Z`;
    setItems((current) => current.map((item) => item.id === selected.id ? { ...item, scheduledAt, status: "scheduled", statusLabel: "Scheduled" } : item));
    setNotice("Schedule updated.");
    window.setTimeout(() => setDrawer((current) => ({ ...current, open: false })), 450);
  }

  function unscheduleItem() {
    if (!selected) return;
    setItems((current) => current.map((item) => item.id === selected.id ? { ...item, scheduledAt: null, status: "draft", statusLabel: "Draft" } : item));
    setDrawer((current) => ({ ...current, open: false }));
  }

  function dropOn(date: Date, time = "10:00", itemId?: string) {
    if (!itemId) return;
    const scheduledAt = `${dateKey(date)}T${time}:00Z`;
    setItems((current) => current.map((item) => item.id === itemId ? { ...item, scheduledAt, status: "scheduled", statusLabel: "Scheduled" } : item));
    setNotice("Content rescheduled.");
  }

  return <>
    <header className="calendar-page-header">
      <div><h1>Calendar</h1><p>Plan and publish content across every channel.</p></div>
      <button className="calendar-primary" type="button" onClick={() => openSlot(anchor)}><Plus aria-hidden="true"/>Schedule content</button>
    </header>

    <section className="calendar-toolbar" aria-label="Calendar controls">
      <div className="calendar-date-controls">
        <button type="button" aria-label="Previous period" onClick={() => setAnchor((current) => shiftAnchor(current, view, -1))}><ChevronLeft aria-hidden="true"/></button>
        <button type="button" aria-label="Next period" onClick={() => setAnchor((current) => shiftAnchor(current, view, 1))}><ChevronRight aria-hidden="true"/></button>
        <button className="calendar-today" type="button" onClick={() => setAnchor(new Date())}>Today</button>
        <strong>{rangeLabel(anchor, view)}</strong>
      </div>
      <div className="calendar-view-tabs" role="group" aria-label="Calendar view">{viewOptions.map(({ value, label, Icon }) => <button key={value} type="button" aria-pressed={view === value} onClick={() => chooseView(value)}><Icon aria-hidden="true"/>{label}</button>)}</div>
      <div className="calendar-filters">
        <div className="calendar-channel-filter" role="group" aria-label="Channel filter">
          <button type="button" aria-pressed={channel === "Instagram"} onClick={() => setChannel(channel === "Instagram" ? "all" : "Instagram")} title="Instagram"><Instagram aria-hidden="true"/></button>
          <button type="button" aria-pressed={channel === "LinkedIn"} onClick={() => setChannel(channel === "LinkedIn" ? "all" : "LinkedIn")} title="LinkedIn"><Linkedin aria-hidden="true"/></button>
          <button type="button" aria-pressed={channel === "Facebook"} onClick={() => setChannel(channel === "Facebook" ? "all" : "Facebook")} title="Facebook"><Facebook aria-hidden="true"/></button>
          <button type="button" aria-pressed={channel === "all"} onClick={() => setChannel("all")}>All</button>
        </div>
        <label className="calendar-select"><span className="sr-only">Campaign</span><select value={campaign} onChange={(event) => setCampaign(event.target.value)}><option value="all">All campaigns</option>{campaigns.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select><ChevronDown aria-hidden="true"/></label>
      </div>
    </section>

    {notice ? <div className="calendar-notice" role="status">{notice}</div> : null}

    <section id="calendar-board" className="calendar-layout">
      <div className="calendar-surface">
        {view === "week" ? <WeekView anchor={anchor} items={visible} onOpen={openItem} onOpenSlot={openSlot} onDrop={dropOn}/> : null}
        {view === "month" ? <MonthView anchor={anchor} items={visible} onOpen={openItem} onOpenSlot={openSlot} onDrop={dropOn}/> : null}
        {view === "list" ? <ListView items={visible} onOpen={openItem}/> : null}
      </div>
      <aside className="calendar-unscheduled">
        <header><div><h2>Unscheduled</h2><p>Drafts ready to place</p></div><span>{unscheduled.length}</span></header>
        <div>{unscheduled.length ? unscheduled.map((item) => <button key={item.id} type="button" draggable onDragStart={(event) => event.dataTransfer.setData("text/calendar-item", item.id)} onClick={() => openItem(item)}><img src={item.image} alt=""/><span><small><ChannelIcon item={item}/>{item.channel}</small><strong>{item.title}</strong><em>{item.formatLabel} · Draft</em></span><MoreHorizontal aria-hidden="true"/></button>) : <p className="calendar-empty-rail">Everything is scheduled. Drag an item off the calendar to return it here.</p>}</div>
        <Link href={brandId ? `/content?brand=${encodeURIComponent(brandId)}` : "/content"}>View all drafts <ChevronRight aria-hidden="true"/></Link>
      </aside>
    </section>

    {drawer.open ? <CalendarDrawer item={selected} drawer={drawer} brandId={brandId} notice={notice} onChange={setDrawer} onClose={() => setDrawer((current) => ({ ...current, open: false }))} onSave={saveSchedule} onUnschedule={unscheduleItem} onChooseDraft={(id) => setDrawer((current) => ({ ...current, itemId: id }))} drafts={items.filter((item) => !item.scheduledAt)}/> : null}
  </>;
}

function WeekView({ anchor, items, onOpen, onOpenSlot, onDrop }: { anchor: Date; items: CalendarItem[]; onOpen: (item: CalendarItem) => void; onOpenSlot: (date: Date, time?: string) => void; onDrop: (date: Date, time: string, itemId?: string) => void }) {
  const days = weekDays(anchor);
  return <div className="calendar-week" data-testid="calendar-week-view">
    <div className="calendar-week-header"><span/><>{days.map((day) => <strong key={dateKey(day)} className={dateKey(day) === dateKey(new Date()) ? "today" : ""}><small>{new Intl.DateTimeFormat("en", { weekday: "short", timeZone: "UTC" }).format(day)}</small>{day.getUTCDate()}</strong>)}</></div>
    <div className="calendar-week-body">
      <div className="calendar-time-axis">{hourRows.map((hour) => <time key={hour}>{formatHour(hour)}</time>)}</div>
      {days.map((day) => <div className="calendar-day-column" key={dateKey(day)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => onDrop(day, "10:00", event.dataTransfer.getData("text/calendar-item"))}>
        {hourRows.slice(0, -1).map((hour) => <button key={hour} type="button" aria-label={`Schedule at ${formatHour(hour)} on ${dateKey(day)}`} onClick={() => onOpenSlot(day, `${String(hour).padStart(2, "0")}:00`)}/>) }
        {itemsForDay(items, day).map((item) => <CalendarBlock key={item.id} item={item} onOpen={onOpen}/>) }
      </div>)}
    </div>
  </div>;
}

function MonthView({ anchor, items, onOpen, onOpenSlot, onDrop }: { anchor: Date; items: CalendarItem[]; onOpen: (item: CalendarItem) => void; onOpenSlot: (date: Date) => void; onDrop: (date: Date, time: string, itemId?: string) => void }) {
  const days = monthDays(anchor);
  return <div className="calendar-month" data-testid="calendar-month-view">
    <div className="calendar-month-labels">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label) => <span key={label}>{label}</span>)}</div>
    <div className="calendar-month-grid">{days.map((day) => {
      const dayItems = itemsForDay(items, day);
      return <article key={dateKey(day)} className={`${day.getUTCMonth() === anchor.getUTCMonth() ? "" : "outside"} ${dateKey(day) === dateKey(new Date()) ? "today" : ""}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => onDrop(day, "10:00", event.dataTransfer.getData("text/calendar-item"))}>
        <button className="calendar-month-day" type="button" onClick={() => onOpenSlot(day)}>{day.getUTCDate()}</button>
        <div>{dayItems.slice(0, 3).map((item) => <button key={item.id} type="button" draggable onDragStart={(event) => event.dataTransfer.setData("text/calendar-item", item.id)} onClick={() => onOpen(item)}><i className={`channel-dot ${item.channel.toLowerCase()}`}/><span>{item.scheduledAt?.slice(11, 16)}</span>{item.title}</button>)}</div>
        {dayItems.length > 3 ? <small>+{dayItems.length - 3} more</small> : null}
      </article>;
    })}</div>
  </div>;
}

function ListView({ items, onOpen }: { items: CalendarItem[]; onOpen: (item: CalendarItem) => void }) {
  const scheduled = items.filter((item) => item.scheduledAt).sort((a, b) => (a.scheduledAt ?? "").localeCompare(b.scheduledAt ?? ""));
  return <div className="calendar-list" data-testid="calendar-list-view"><div className="calendar-list-head"><span>Content</span><span>Channel</span><span>Campaign</span><span>Scheduled</span><span>Action</span></div>{scheduled.map((item) => <article key={item.id}><div><img src={item.image} alt=""/><span><strong>{item.title}</strong><small><FormatIcon item={item}/>{item.formatLabel}</small></span></div><span><ChannelIcon item={item}/>{item.channel}</span><span>{item.campaignName}</span><time dateTime={item.scheduledAt ?? undefined}><strong>{formatLongDate(item.scheduledAt!)}</strong><small>{formatTime(item.scheduledAt!)}</small></time><button type="button" onClick={() => onOpen(item)}>Open</button></article>)}</div>;
}

function CalendarBlock({ item, onOpen }: { item: CalendarItem; onOpen: (item: CalendarItem) => void }) {
  const date = new Date(item.scheduledAt!);
  const top = ((date.getUTCHours() - 8) * 64) + Math.round(date.getUTCMinutes() / 60 * 64) + 7;
  return <button className={`calendar-block channel-${item.channel.toLowerCase()}`} style={{ top }} type="button" draggable onDragStart={(event) => event.dataTransfer.setData("text/calendar-item", item.id)} onClick={() => onOpen(item)}><img src={item.image} alt=""/><span><small><ChannelIcon item={item}/>{formatTime(item.scheduledAt!)}</small><strong>{item.title}</strong><em>{item.formatLabel}</em></span></button>;
}

function CalendarDrawer({ item, drawer, brandId, notice, onChange, onClose, onSave, onUnschedule, onChooseDraft, drafts }: { item?: CalendarItem; drawer: DrawerState; brandId?: string; notice: string; onChange: (value: DrawerState) => void; onClose: () => void; onSave: () => void; onUnschedule: () => void; onChooseDraft: (id: string) => void; drafts: CalendarItem[] }) {
  return <div className="calendar-drawer-layer" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <aside className="calendar-drawer" role="dialog" aria-modal="true" aria-labelledby="calendar-drawer-title">
      <header><div><small>{item ? "CONTENT QUICK PREVIEW" : "SCHEDULE CONTENT"}</small><h2 id="calendar-drawer-title">{item?.title ?? "Choose content to schedule"}</h2></div><button type="button" onClick={onClose} aria-label="Close"><X aria-hidden="true"/></button></header>
      {item ? <>
        <div className="calendar-drawer-media"><img src={item.image} alt={item.title}/><span><FormatIcon item={item}/>{item.formatLabel}</span></div>
        <div className="calendar-drawer-meta"><span><ChannelIcon item={item}/><strong>{item.channel}</strong></span><span><Sparkles aria-hidden="true"/><strong>{item.campaignName}</strong></span></div>
        <section><h3>Caption</h3><p>{item.caption}</p></section>
      </> : <section className="calendar-draft-picker"><h3>Unscheduled drafts</h3>{drafts.map((draft) => <button type="button" key={draft.id} onClick={() => onChooseDraft(draft.id)}><img src={draft.image} alt=""/><span><strong>{draft.title}</strong><small>{draft.channel} · {draft.formatLabel}</small></span><ChevronRight aria-hidden="true"/></button>)}</section>}
      <section className="calendar-schedule-fields"><h3>{item?.scheduledAt ? "Reschedule" : "Schedule"}</h3><div><label>Date<input type="date" value={drawer.date} onChange={(event) => onChange({ ...drawer, date: event.target.value })}/></label><label>Time<input type="time" value={drawer.time} onChange={(event) => onChange({ ...drawer, time: event.target.value })}/></label></div></section>
      {notice ? <p className="calendar-drawer-notice" role="status">{notice}</p> : null}
      <footer>{item?.scheduledAt ? <button className="calendar-danger" type="button" onClick={onUnschedule}><Trash2 aria-hidden="true"/>Unschedule</button> : <span/>}<div>{item ? <><Link href={`${contentPreviewHref(item, brandId)}#caption`}><Pencil aria-hidden="true"/>Edit</Link><Link href={contentPreviewHref(item, brandId)}>Open full preview</Link></> : null}<button className="calendar-save" type="button" onClick={onSave} disabled={!item}><Save aria-hidden="true"/>Save schedule</button></div></footer>
    </aside>
  </div>;
}

function ChannelIcon({ item }: { item: CalendarItem }) {
  const Icon = item.channel === "LinkedIn" ? Linkedin : item.channel === "Facebook" ? Facebook : Instagram;
  return <Icon aria-hidden="true"/>;
}

function FormatIcon({ item }: { item: CalendarItem }) {
  const Icon = item.format === "carousel" ? Grid2X2 : item.format === "reel" ? PlaySquare : FileImage;
  return <Icon aria-hidden="true"/>;
}

function formatHour(hour: number) { return new Intl.DateTimeFormat("en", { hour: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 0, 1, hour))); }
function formatTime(value: string) { return new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(new Date(value)); }
function formatLongDate(value: string) { return new Intl.DateTimeFormat("en", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(value)); }
