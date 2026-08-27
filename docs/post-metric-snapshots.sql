-- Run this script in the Supabase SQL Editor before deploying the application
-- code that calls persist_post_metric_observation(). It is intentionally kept
-- as deployment SQL rather than a repository migration.

create table public.post_metric_snapshots (
  id uuid primary key default gen_random_uuid(),
  influencer_id uuid not null references public.influencers(id) on delete cascade,
  platform text not null check (platform in ('instagram', 'facebook')),
  target_type text not null check (target_type in ('legacy_instagram', 'destination')),
  target_id uuid not null,
  post_id uuid not null references public.posts(id) on delete cascade,
  destination_id uuid references public.post_destinations(id) on delete cascade,
  external_post_id text,
  published_at timestamptz not null,
  captured_at timestamptz not null,
  views bigint,
  likes bigint,
  comments bigint,
  saves bigint,
  shares bigint,
  reach bigint,
  clicks bigint,
  sync_run_id uuid not null,
  is_bootstrap boolean not null default false,
  constraint post_metric_snapshots_target_shape check (
    (target_type = 'legacy_instagram' and platform = 'instagram' and destination_id is null and target_id = post_id)
    or
    (target_type = 'destination' and destination_id is not null and target_id = destination_id)
  ),
  constraint post_metric_snapshots_metric_values check (
    (views is null or views >= 0)
    and (likes is null or likes >= 0)
    and (comments is null or comments >= 0)
    and (saves is null or saves >= 0)
    and (shares is null or shares >= 0)
    and (reach is null or reach >= 0)
    and (clicks is null or clicks >= 0)
  ),
  unique (target_type, target_id, sync_run_id)
);

create index post_metric_snapshots_target_captured_idx
  on public.post_metric_snapshots (target_type, target_id, captured_at desc);

create index post_metric_snapshots_influencer_platform_captured_idx
  on public.post_metric_snapshots (influencer_id, platform, captured_at desc);

create index post_metric_snapshots_captured_brin_idx
  on public.post_metric_snapshots using brin (captured_at);

alter table public.post_metric_snapshots enable row level security;
revoke all on table public.post_metric_snapshots from anon, authenticated;
grant select, insert on table public.post_metric_snapshots to service_role;

create or replace function public.persist_post_metric_observation(
  p_target_type text,
  p_target_id uuid,
  p_claim_token uuid,
  p_outcome text,
  p_attempted_at timestamptz,
  p_observed_at timestamptz,
  p_next_sync_at timestamptz,
  p_sync_run_id uuid,
  p_error_count integer default 0,
  p_error_message text default null,
  p_has_views boolean default false,
  p_views bigint default null,
  p_has_likes boolean default false,
  p_likes bigint default null,
  p_has_reactions boolean default false,
  p_reactions bigint default null,
  p_has_comments boolean default false,
  p_comments bigint default null,
  p_has_saves boolean default false,
  p_saves bigint default null,
  p_has_shares boolean default false,
  p_shares bigint default null,
  p_has_reach boolean default false,
  p_reach bigint default null,
  p_has_clicks boolean default false,
  p_clicks bigint default null
)
returns table (
  snapshot_id uuid,
  snapshot_inserted boolean,
  complete_views bigint,
  complete_likes bigint,
  complete_comments bigint,
  complete_saves bigint,
  complete_shares bigint,
  complete_reach bigint,
  complete_clicks bigint
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_target record;
  v_previous public.post_metric_snapshots%rowtype;
  v_influencer_id uuid;
  v_platform text;
  v_post_id uuid;
  v_destination_id uuid;
  v_external_post_id text;
  v_published_at timestamptz;
  v_views bigint;
  v_likes bigint;
  v_comments bigint;
  v_saves bigint;
  v_shares bigint;
  v_reach bigint;
  v_clicks bigint;
  v_has_observation boolean;
  v_daily_checkpoint boolean;
  v_changed boolean;
begin
  if p_target_type not in ('legacy_instagram', 'destination') then
    raise exception 'Unsupported metric target type: %', p_target_type;
  end if;

  if p_outcome not in ('success', 'failure') then
    raise exception 'Unsupported metric observation outcome: %', p_outcome;
  end if;

  if p_target_type = 'legacy_instagram' then
    update public.posts as p
    set
      views = case when p_has_views then p_views else p.views end,
      likes = case when p_has_likes then p_likes else p.likes end,
      comments = case when p_has_comments then p_comments else p.comments end,
      saves = case when p_has_saves then p_saves else p.saves end,
      shares = case when p_has_shares then p_shares else p.shares end,
      reach = case when p_has_reach then p_reach else p.reach end,
      last_synced_at = case when p_outcome = 'success' then p_observed_at else p.last_synced_at end,
      last_sync_attempt_at = p_attempted_at,
      sync_count = case when p_outcome = 'success' then coalesce(p.sync_count, 0) + 1 else p.sync_count end,
      sync_error_count = case when p_outcome = 'success' then 0 else p_error_count end,
      last_sync_error = case when p_outcome = 'success' then null else p_error_message end,
      last_sync_error_at = case when p_outcome = 'success' then null else p_observed_at end,
      next_sync_at = p_next_sync_at,
      sync_claimed_at = null,
      sync_claim_token = null
    where p.id = p_target_id
      and p.platform = 'instagram'
      and p.status = 'published'
      and p.sync_claim_token = p_claim_token
    returning p.* into v_target;

    if not found then
      raise exception 'Metric target claim was lost for legacy Instagram post %', p_target_id;
    end if;

    v_influencer_id := v_target.influencer_id;
    v_platform := 'instagram';
    v_post_id := v_target.id;
    v_destination_id := null;
    v_external_post_id := v_target.external_post_id;
    v_published_at := v_target.published_at;
    v_views := v_target.views;
    v_likes := v_target.likes;
    v_comments := v_target.comments;
    v_saves := v_target.saves;
    v_shares := v_target.shares;
    v_reach := v_target.reach;
    v_clicks := null;
  else
    update public.post_destinations as d
    set
      views = case when p_has_views then p_views else d.views end,
      likes = case when p_has_likes then p_likes else d.likes end,
      reactions = case when p_has_reactions then p_reactions else d.reactions end,
      comments = case when p_has_comments then p_comments else d.comments end,
      saves = case when p_has_saves then p_saves else d.saves end,
      shares = case when p_has_shares then p_shares else d.shares end,
      reach = case when p_has_reach then p_reach else d.reach end,
      clicks = case when p_has_clicks then p_clicks else d.clicks end,
      last_synced_at = case when p_outcome = 'success' then p_observed_at else d.last_synced_at end,
      last_sync_attempt_at = p_attempted_at,
      sync_count = case when p_outcome = 'success' then coalesce(d.sync_count, 0) + 1 else d.sync_count end,
      sync_error_count = case when p_outcome = 'success' then 0 else p_error_count end,
      last_sync_error = case when p_outcome = 'success' then null else p_error_message end,
      last_sync_error_at = case when p_outcome = 'success' then null else p_observed_at end,
      next_sync_at = p_next_sync_at,
      sync_claimed_at = null,
      sync_claim_token = null
    where d.id = p_target_id
      and d.status = 'published'
      and d.sync_claim_token = p_claim_token
    returning d.* into v_target;

    if not found then
      raise exception 'Metric target claim was lost for destination %', p_target_id;
    end if;

    select p.influencer_id
    into v_influencer_id
    from public.posts as p
    where p.id = v_target.post_id;

    if v_influencer_id is null then
      raise exception 'Parent post is missing for destination %', p_target_id;
    end if;

    v_platform := v_target.platform;
    v_post_id := v_target.post_id;
    v_destination_id := v_target.id;
    v_external_post_id := v_target.external_post_id;
    v_published_at := v_target.published_at;
    v_views := v_target.views;
    v_likes := case when v_target.platform = 'facebook' then v_target.reactions else v_target.likes end;
    v_comments := v_target.comments;
    v_saves := case when v_target.platform = 'instagram' then v_target.saves else null end;
    v_shares := v_target.shares;
    v_reach := v_target.reach;
    v_clicks := case when v_target.platform = 'facebook' then v_target.clicks else null end;
  end if;

  if v_influencer_id is null or v_published_at is null or v_platform not in ('instagram', 'facebook') then
    raise exception 'Metric target identity is incomplete for %:%', p_target_type, p_target_id;
  end if;

  select s.*
  into v_previous
  from public.post_metric_snapshots as s
  where s.target_type = p_target_type
    and s.target_id = p_target_id
  order by s.captured_at desc, s.id desc
  limit 1;

  v_has_observation := p_outcome = 'success'
    or p_has_views or p_has_likes or p_has_reactions or p_has_comments
    or p_has_saves or p_has_shares or p_has_reach or p_has_clicks;
  v_daily_checkpoint := v_previous.id is not null
    and (v_previous.captured_at at time zone 'Europe/Stockholm')::date
      < (p_observed_at at time zone 'Europe/Stockholm')::date;
  v_changed := v_has_observation and (
    v_previous.id is null
    or v_daily_checkpoint
    or (v_previous.views, v_previous.likes, v_previous.comments, v_previous.saves,
        v_previous.shares, v_previous.reach, v_previous.clicks)
       is distinct from
       (v_views, v_likes, v_comments, v_saves, v_shares, v_reach, v_clicks)
  );

  snapshot_id := null;
  snapshot_inserted := false;

  if v_changed then
    insert into public.post_metric_snapshots (
      influencer_id, platform, target_type, target_id, post_id, destination_id,
      external_post_id, published_at, captured_at, views, likes, comments,
      saves, shares, reach, clicks, sync_run_id, is_bootstrap
    ) values (
      v_influencer_id, v_platform, p_target_type, p_target_id, v_post_id,
      v_destination_id, v_external_post_id, v_published_at, p_observed_at,
      v_views, v_likes, v_comments, v_saves, v_shares, v_reach, v_clicks,
      p_sync_run_id,
      v_previous.id is null
        and (v_published_at at time zone 'Europe/Stockholm')::date
          < (p_observed_at at time zone 'Europe/Stockholm')::date
    )
    returning id into snapshot_id;

    snapshot_inserted := true;
  end if;

  complete_views := v_views;
  complete_likes := v_likes;
  complete_comments := v_comments;
  complete_saves := v_saves;
  complete_shares := v_shares;
  complete_reach := v_reach;
  complete_clicks := v_clicks;
  return next;
end;
$$;

revoke execute on function public.persist_post_metric_observation from public, anon, authenticated;
grant execute on function public.persist_post_metric_observation to service_role;

create or replace function public.get_post_metric_today(
  p_influencer_id uuid,
  p_platform text,
  p_day date,
  p_end_at timestamptz default now()
)
returns table (
  period_start timestamptz,
  observed_targets bigint,
  first_captured_at timestamptz,
  views bigint,
  likes bigint,
  comments bigint,
  saves bigint,
  shares bigint,
  reach bigint,
  clicks bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with params as (
    select p_day::timestamp at time zone 'Europe/Stockholm' as start_at
  ),
  targets as (
    select distinct on (s.target_type, s.target_id)
      s.target_type,
      s.target_id,
      s.published_at,
      min(s.captured_at) over () as first_captured_at
    from public.post_metric_snapshots as s
    where s.influencer_id = p_influencer_id
      and (p_platform = 'all' or s.platform = p_platform)
      and s.captured_at <= p_end_at
      and (
        (
          s.target_type = 'destination'
          and exists (
            select 1
            from public.post_destinations d
            join public.posts p on p.id = d.post_id
            where d.id = s.target_id
              and d.status = 'published'
              and d.external_post_id is not null
              and p.influencer_id = p_influencer_id
          )
        )
        or
        (
          s.target_type = 'legacy_instagram'
          and exists (
            select 1
            from public.posts p
            where p.id = s.target_id
              and p.influencer_id = p_influencer_id
              and p.platform = 'instagram'
              and p.status = 'published'
              and p.external_post_id is not null
              and not exists (
                select 1
                from public.post_destinations d
                where d.platform = 'instagram'
                  and d.status = 'published'
                  and d.external_post_id is not null
                  and (d.post_id = p.id or d.external_post_id = p.external_post_id)
              )
          )
        )
      )
    order by s.target_type, s.target_id, s.captured_at desc, s.id desc
  ),
  states as (
    select
      t.target_type,
      t.target_id,
      t.published_at,
      t.first_captured_at,
      c.views, c.likes, c.comments, c.saves, c.shares, c.reach, c.clicks,
      case when t.published_at >= p.start_at then 0 else coalesce(
        (select s.views from public.post_metric_snapshots s where s.target_type=t.target_type and s.target_id=t.target_id and s.captured_at <= p.start_at and s.views is not null order by s.captured_at desc, s.id desc limit 1),
        (select s.views from public.post_metric_snapshots s where s.target_type=t.target_type and s.target_id=t.target_id and s.captured_at > p.start_at and s.captured_at <= p_end_at and s.views is not null order by s.captured_at, s.id limit 1)
      ) end as baseline_views,
      case when t.published_at >= p.start_at then 0 else coalesce(
        (select s.likes from public.post_metric_snapshots s where s.target_type=t.target_type and s.target_id=t.target_id and s.captured_at <= p.start_at and s.likes is not null order by s.captured_at desc, s.id desc limit 1),
        (select s.likes from public.post_metric_snapshots s where s.target_type=t.target_type and s.target_id=t.target_id and s.captured_at > p.start_at and s.captured_at <= p_end_at and s.likes is not null order by s.captured_at, s.id limit 1)
      ) end as baseline_likes,
      case when t.published_at >= p.start_at then 0 else coalesce(
        (select s.comments from public.post_metric_snapshots s where s.target_type=t.target_type and s.target_id=t.target_id and s.captured_at <= p.start_at and s.comments is not null order by s.captured_at desc, s.id desc limit 1),
        (select s.comments from public.post_metric_snapshots s where s.target_type=t.target_type and s.target_id=t.target_id and s.captured_at > p.start_at and s.captured_at <= p_end_at and s.comments is not null order by s.captured_at, s.id limit 1)
      ) end as baseline_comments,
      case when t.published_at >= p.start_at then 0 else coalesce(
        (select s.saves from public.post_metric_snapshots s where s.target_type=t.target_type and s.target_id=t.target_id and s.captured_at <= p.start_at and s.saves is not null order by s.captured_at desc, s.id desc limit 1),
        (select s.saves from public.post_metric_snapshots s where s.target_type=t.target_type and s.target_id=t.target_id and s.captured_at > p.start_at and s.captured_at <= p_end_at and s.saves is not null order by s.captured_at, s.id limit 1)
      ) end as baseline_saves,
      case when t.published_at >= p.start_at then 0 else coalesce(
        (select s.shares from public.post_metric_snapshots s where s.target_type=t.target_type and s.target_id=t.target_id and s.captured_at <= p.start_at and s.shares is not null order by s.captured_at desc, s.id desc limit 1),
        (select s.shares from public.post_metric_snapshots s where s.target_type=t.target_type and s.target_id=t.target_id and s.captured_at > p.start_at and s.captured_at <= p_end_at and s.shares is not null order by s.captured_at, s.id limit 1)
      ) end as baseline_shares,
      case when t.published_at >= p.start_at then 0 else coalesce(
        (select s.reach from public.post_metric_snapshots s where s.target_type=t.target_type and s.target_id=t.target_id and s.captured_at <= p.start_at and s.reach is not null order by s.captured_at desc, s.id desc limit 1),
        (select s.reach from public.post_metric_snapshots s where s.target_type=t.target_type and s.target_id=t.target_id and s.captured_at > p.start_at and s.captured_at <= p_end_at and s.reach is not null order by s.captured_at, s.id limit 1)
      ) end as baseline_reach,
      case when t.published_at >= p.start_at then 0 else coalesce(
        (select s.clicks from public.post_metric_snapshots s where s.target_type=t.target_type and s.target_id=t.target_id and s.captured_at <= p.start_at and s.clicks is not null order by s.captured_at desc, s.id desc limit 1),
        (select s.clicks from public.post_metric_snapshots s where s.target_type=t.target_type and s.target_id=t.target_id and s.captured_at > p.start_at and s.captured_at <= p_end_at and s.clicks is not null order by s.captured_at, s.id limit 1)
      ) end as baseline_clicks
    from targets t
    cross join params p
    join lateral (
      select s.views, s.likes, s.comments, s.saves, s.shares, s.reach, s.clicks
      from public.post_metric_snapshots s
      where s.target_type=t.target_type and s.target_id=t.target_id and s.captured_at <= p_end_at
      order by s.captured_at desc, s.id desc
      limit 1
    ) c on true
  )
  select
    p.start_at,
    count(s.target_id),
    min(s.first_captured_at),
    coalesce(sum(case when s.views is null or s.baseline_views is null then 0 else s.views-s.baseline_views end),0)::bigint,
    coalesce(sum(case when s.likes is null or s.baseline_likes is null then 0 else s.likes-s.baseline_likes end),0)::bigint,
    coalesce(sum(case when s.comments is null or s.baseline_comments is null then 0 else s.comments-s.baseline_comments end),0)::bigint,
    coalesce(sum(case when s.saves is null or s.baseline_saves is null then 0 else s.saves-s.baseline_saves end),0)::bigint,
    coalesce(sum(case when s.shares is null or s.baseline_shares is null then 0 else s.shares-s.baseline_shares end),0)::bigint,
    coalesce(sum(case when s.reach is null or s.baseline_reach is null then 0 else s.reach-s.baseline_reach end),0)::bigint,
    coalesce(sum(case when s.clicks is null or s.baseline_clicks is null then 0 else s.clicks-s.baseline_clicks end),0)::bigint
  from params p
  left join states s on true
  group by p.start_at;
$$;

revoke execute on function public.get_post_metric_today from public, anon, authenticated;
grant execute on function public.get_post_metric_today to service_role;
