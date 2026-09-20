begin;

create or replace view hunter_eei_useful_opportunity_metrics as
select
  workspace_id,
  brand_id,
  count(distinct opportunity_id) as instrumented_opportunities,
  count(distinct opportunity_id) filter (
    where action in ('saved','developed','generated','approved','published')
  ) as useful_opportunities,
  count(distinct opportunity_id) filter (where action='opened') as opened_opportunities,
  count(distinct opportunity_id) filter (
    where action in ('dismissed','not_relevant','seen_before','wrong_audience','wrong_brand','wrong_timing','not_credible')
  ) as explicitly_negative_opportunities,
  case
    when count(distinct opportunity_id)=0 then null
    else count(distinct opportunity_id) filter (
      where action in ('saved','developed','generated','approved','published')
    )::double precision / count(distinct opportunity_id)::double precision
  end as useful_opportunity_rate,
  max(created_at) as last_feedback_at
from opportunity_feedback_events
group by workspace_id,brand_id;

comment on view hunter_eei_useful_opportunity_metrics is
  'EEI outcome metric over instrumented opportunities. Time-in-app, scroll depth and notification opens are intentionally excluded.';

commit;
