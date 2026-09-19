import { getContentData } from "../../lib/api";
import { calendarFallback, toCalendarItems } from "../../lib/calendar";
import { contentFallback, toContentItems } from "../../lib/content";
import { requirePageAuthentication } from "../../lib/page-auth";
import { KairoShell } from "../kairo-shell";
import { CalendarClient } from "./calendar-client";

type SearchParams = Promise<{ brand?: string; authError?: string }>;

export default async function CalendarPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const data = requirePageAuthentication(await getContentData(params.brand), "/calendar");
  const projected = toContentItems(data.details, data.reviews, data.commands);
  const items = projected.length ? toCalendarItems(projected, data.commands) : calendarFallback();

  return <KairoShell
    active="Calendar"
    authenticated={data.authenticated}
    brandId={data.brandId}
    brandName={data.brandName}
    workspaceClassName="calendar-workspace"
    proTip="Drag content to a new time or open it to reschedule without losing your place."
    proTipAction="View scheduling guide"
    proTipHref="#calendar-board"
  >
    {params.authError ? <p className="auth-error" role="alert">{params.authError}</p> : null}
    <CalendarClient initialItems={items.length ? items : toCalendarItems(contentFallback(), [])} brandId={data.brandId}/>
  </KairoShell>;
}
