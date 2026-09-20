begin;

alter table opportunity_feedback_events
  drop constraint if exists opportunity_feedback_events_action_check;

alter table opportunity_feedback_events
  add constraint opportunity_feedback_events_action_check
  check (action in (
    'seen','impression','opened','saved','dismissed','not_relevant','seen_before',
    'wrong_audience','wrong_brand','wrong_timing','not_credible','developed','generated',
    'heavily_edited','approved','published','performance_observed'
  ));

alter table opportunity_feedback_events
  add column if not exists surface text not null default 'discover',
  add column if not exists ranking_version text not null default 'hunter-quality-v1',
  add column if not exists position integer,
  add column if not exists reason text,
  add column if not exists content_id text,
  add column if not exists idempotency_key text;

alter table opportunity_feedback_events
  drop constraint if exists opportunity_feedback_events_position_check;

alter table opportunity_feedback_events
  add constraint opportunity_feedback_events_position_check
  check (position is null or position >= 0);

create unique index if not exists uq_opportunity_feedback_idempotency
  on opportunity_feedback_events(workspace_id,brand_id,account_id,idempotency_key)
  where idempotency_key is not null;

create index if not exists ix_opportunity_feedback_action_recent
  on opportunity_feedback_events(workspace_id,brand_id,action,created_at desc);

commit;
