-- Run this script in the Supabase SQL Editor before deploying the Comment
-- Inbox application code. It creates the read-only Meta comment foundation;
-- it does not contact Meta, configure cron, or send any replies.

create table public.comment_sync_targets (
  id uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in ('legacy_instagram', 'destination')),
  target_id uuid not null,
  influencer_id uuid not null references public.influencers(id) on delete cascade,
  social_account_id uuid not null references public.social_accounts(id) on delete cascade,
  platform text not null check (platform in ('instagram', 'facebook')),
  post_id uuid not null references public.posts(id) on delete cascade,
  destination_id uuid references public.post_destinations(id) on delete cascade,
  external_object_type text not null check (
    external_object_type in (
      'instagram_media',
      'facebook_page_post',
      'facebook_photo',
      'facebook_video'
    )
  ),
  external_object_id text not null,
  published_at timestamptz not null,
  next_sync_at timestamptz not null default now(),
  last_synced_at timestamptz,
  last_comment_activity_at timestamptz,
  sync_count integer not null default 0 check (sync_count >= 0),
  sync_claim_token uuid,
  sync_claimed_at timestamptz,
  sync_error_count integer not null default 0 check (sync_error_count >= 0),
  last_sync_error text,
  last_sync_error_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint comment_sync_targets_target_shape check (
    (
      target_type = 'legacy_instagram'
      and platform = 'instagram'
      and destination_id is null
      and target_id = post_id
    )
    or
    (
      target_type = 'destination'
      and destination_id is not null
      and target_id = destination_id
    )
  ),
  constraint comment_sync_targets_object_shape check (
    (platform = 'instagram' and external_object_type = 'instagram_media')
    or
    (
      platform = 'facebook'
      and external_object_type in (
        'facebook_page_post',
        'facebook_photo',
        'facebook_video'
      )
    )
  ),
  unique (target_type, target_id),
  unique (platform, social_account_id, external_object_id)
);

create index comment_sync_targets_due_idx
  on public.comment_sync_targets (next_sync_at, published_at desc)
  where sync_claim_token is null;

create index comment_sync_targets_claim_idx
  on public.comment_sync_targets (sync_claimed_at)
  where sync_claim_token is not null;

create index comment_sync_targets_owner_idx
  on public.comment_sync_targets (influencer_id, platform, published_at desc);

create index comment_sync_targets_social_account_idx
  on public.comment_sync_targets (social_account_id);

create index comment_sync_targets_post_idx
  on public.comment_sync_targets (post_id);

create index comment_sync_targets_destination_idx
  on public.comment_sync_targets (destination_id)
  where destination_id is not null;

create table public.social_comments (
  id uuid primary key default gen_random_uuid(),
  sync_target_id uuid not null references public.comment_sync_targets(id) on delete cascade,
  influencer_id uuid not null references public.influencers(id) on delete cascade,
  platform text not null check (platform in ('instagram', 'facebook')),
  social_account_id uuid not null references public.social_accounts(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  destination_id uuid references public.post_destinations(id) on delete set null,
  external_object_type text not null check (
    external_object_type in (
      'instagram_media',
      'facebook_page_post',
      'facebook_photo',
      'facebook_video'
    )
  ),
  external_post_id text not null,
  external_comment_id text not null,
  parent_comment_id uuid references public.social_comments(id) on delete set null,
  parent_external_comment_id text,
  thread_root_comment_id uuid references public.social_comments(id) on delete set null,
  thread_root_external_comment_id text not null,
  author_external_id text,
  author_username text,
  author_name text,
  message text,
  comment_created_at timestamptz not null,
  like_count bigint check (like_count is null or like_count >= 0),
  is_from_our_account boolean not null default false,
  is_hidden boolean,
  is_deleted boolean not null default false,
  source_data jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  last_synced_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint social_comments_parent_shape check (
    (parent_external_comment_id is null and thread_root_external_comment_id = external_comment_id)
    or parent_external_comment_id is not null
  ),
  unique (platform, social_account_id, external_comment_id)
);

create index social_comments_inbox_idx
  on public.social_comments (influencer_id, comment_created_at desc, id desc)
  where not is_from_our_account and not is_deleted;

create index social_comments_thread_idx
  on public.social_comments (
    platform,
    social_account_id,
    thread_root_external_comment_id,
    comment_created_at,
    id
  );

create index social_comments_parent_external_idx
  on public.social_comments (platform, social_account_id, parent_external_comment_id)
  where parent_external_comment_id is not null;

create index social_comments_post_idx
  on public.social_comments (post_id, comment_created_at desc);

create index social_comments_sync_target_idx
  on public.social_comments (sync_target_id);

create index social_comments_social_account_idx
  on public.social_comments (social_account_id);

create index social_comments_destination_idx
  on public.social_comments (destination_id)
  where destination_id is not null;

create index social_comments_parent_idx
  on public.social_comments (parent_comment_id)
  where parent_comment_id is not null;

create index social_comments_thread_root_idx
  on public.social_comments (thread_root_comment_id, comment_created_at, id)
  where thread_root_comment_id is not null;

create table public.social_comment_threads (
  root_comment_id uuid primary key references public.social_comments(id) on delete cascade,
  influencer_id uuid not null references public.influencers(id) on delete cascade,
  platform text not null check (platform in ('instagram', 'facebook')),
  social_account_id uuid not null references public.social_accounts(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  destination_id uuid references public.post_destinations(id) on delete set null,
  workflow_status text not null default 'active' check (workflow_status in ('active', 'ignored')),
  needs_reply boolean not null default true,
  latest_inbound_comment_id uuid references public.social_comments(id) on delete set null,
  latest_inbound_at timestamptz,
  latest_own_reply_comment_id uuid references public.social_comments(id) on delete set null,
  latest_own_reply_at timestamptz,
  last_activity_at timestamptz not null,
  ignored_at timestamptz,
  ignored_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index social_comment_threads_inbox_idx
  on public.social_comment_threads (
    influencer_id,
    workflow_status,
    needs_reply,
    last_activity_at desc,
    root_comment_id desc
  );

create index social_comment_threads_platform_idx
  on public.social_comment_threads (platform, last_activity_at desc);

create index social_comment_threads_social_account_idx
  on public.social_comment_threads (social_account_id);

create index social_comment_threads_post_idx
  on public.social_comment_threads (post_id);

create index social_comment_threads_destination_idx
  on public.social_comment_threads (destination_id)
  where destination_id is not null;

create index social_comment_threads_latest_inbound_idx
  on public.social_comment_threads (latest_inbound_comment_id)
  where latest_inbound_comment_id is not null;

create index social_comment_threads_latest_own_reply_idx
  on public.social_comment_threads (latest_own_reply_comment_id)
  where latest_own_reply_comment_id is not null;

create index social_comment_threads_ignored_by_idx
  on public.social_comment_threads (ignored_by)
  where ignored_by is not null;

alter table public.comment_sync_targets enable row level security;
alter table public.social_comments enable row level security;
alter table public.social_comment_threads enable row level security;

revoke all on table public.comment_sync_targets from anon, authenticated;
revoke all on table public.social_comments from anon, authenticated;
revoke all on table public.social_comment_threads from anon, authenticated;

grant select, insert, update, delete on table public.comment_sync_targets to service_role;
grant select, insert, update, delete on table public.social_comments to service_role;
grant select, insert, update, delete on table public.social_comment_threads to service_role;

grant select on table public.comment_sync_targets to authenticated;
grant select on table public.social_comments to authenticated;
grant select on table public.social_comment_threads to authenticated;

create policy "Users can read own comment sync targets"
on public.comment_sync_targets
for select
to authenticated
using (
  exists (
    select 1
    from public.influencers i
    where i.id = comment_sync_targets.influencer_id
      and i.user_id = (select auth.uid())
  )
);

create policy "Users can read own social comments"
on public.social_comments
for select
to authenticated
using (
  exists (
    select 1
    from public.influencers i
    where i.id = social_comments.influencer_id
      and i.user_id = (select auth.uid())
  )
);

create policy "Users can read own social comment threads"
on public.social_comment_threads
for select
to authenticated
using (
  exists (
    select 1
    from public.influencers i
    where i.id = social_comment_threads.influencer_id
      and i.user_id = (select auth.uid())
  )
);

create or replace function public.preview_comment_sync_target_bootstrap(
  p_limit integer default 50,
  p_platform text default 'all',
  p_now timestamptz default now()
)
returns table (
  target_type text,
  target_id uuid,
  influencer_id uuid,
  social_account_id uuid,
  platform text,
  post_id uuid,
  destination_id uuid,
  external_object_type text,
  external_object_id text,
  published_at timestamptz,
  priority integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  with candidates as (
    select
      'destination'::text as target_type,
      d.id as target_id,
      p.influencer_id,
      d.social_account_id,
      d.platform,
      p.id as post_id,
      d.id as destination_id,
      case
        when d.platform = 'instagram' then 'instagram_media'
        when d.external_post_id like '%\_%' escape '\' then 'facebook_page_post'
        when p.media_type = 'video' then 'facebook_video'
        else 'facebook_photo'
      end::text as external_object_type,
      d.external_post_id as external_object_id,
      coalesce(d.published_at, p.published_at) as published_at
    from public.post_destinations d
    join public.posts p on p.id = d.post_id
    join public.social_accounts a
      on a.id = d.social_account_id
      and a.influencer_id = p.influencer_id
      and a.platform = d.platform
    where d.status = 'published'
      and d.platform in ('instagram', 'facebook')
      and (p_platform = 'all' or d.platform = p_platform)
      and d.external_post_id is not null
      and coalesce(d.published_at, p.published_at) is not null
      and not exists (
        select 1
        from public.comment_sync_targets t
        where (t.target_type = 'destination' and t.target_id = d.id)
          or (
            t.platform = d.platform
            and t.social_account_id = d.social_account_id
            and t.external_object_id = d.external_post_id
          )
      )

    union all

    select
      'legacy_instagram'::text,
      p.id,
      p.influencer_id,
      p.social_account_id,
      'instagram'::text,
      p.id,
      null::uuid,
      'instagram_media'::text,
      p.external_post_id,
      p.published_at
    from public.posts p
    join public.social_accounts a
      on a.id = p.social_account_id
      and a.influencer_id = p.influencer_id
      and a.platform = 'instagram'
    where p.platform = 'instagram'
      and p_platform in ('all', 'instagram')
      and p.status = 'published'
      and p.external_post_id is not null
      and p.published_at is not null
      and not exists (
        select 1
        from public.post_destinations d
        where d.platform = 'instagram'
          and d.status = 'published'
          and d.external_post_id is not null
          and (d.post_id = p.id or d.external_post_id = p.external_post_id)
      )
      and not exists (
        select 1
        from public.comment_sync_targets t
        where (t.target_type = 'legacy_instagram' and t.target_id = p.id)
          or (
            t.platform = 'instagram'
            and t.social_account_id = p.social_account_id
            and t.external_object_id = p.external_post_id
          )
      )
  ),
  ranked as (
    select
      c.*,
      row_number() over (
        partition by c.platform, c.social_account_id, c.external_object_id
        order by (c.target_type = 'destination') desc, c.published_at desc, c.target_id
      ) as object_rank,
      case
        when c.published_at >= p_now - interval '24 hours' then 1
        when c.published_at >= p_now - interval '7 days' then 2
        when c.published_at >= p_now - interval '30 days' then 3
        else 4
      end as priority
    from candidates c
  )
  select
    r.target_type,
    r.target_id,
    r.influencer_id,
    r.social_account_id,
    r.platform,
    r.post_id,
    r.destination_id,
    r.external_object_type,
    r.external_object_id,
    r.published_at,
    r.priority
  from ranked r
  where r.object_rank = 1
    and p_platform in ('all', 'instagram', 'facebook')
  order by r.priority, r.published_at desc, r.target_id
  limit greatest(0, least(coalesce(p_limit, 50), 500));
$$;

create or replace function public.bootstrap_comment_sync_targets(
  p_limit integer default 50,
  p_platform text default 'all',
  p_now timestamptz default now()
)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_inserted bigint;
begin
  insert into public.comment_sync_targets (
    target_type,
    target_id,
    influencer_id,
    social_account_id,
    platform,
    post_id,
    destination_id,
    external_object_type,
    external_object_id,
    published_at,
    next_sync_at,
    created_at,
    updated_at
  )
  select
    c.target_type,
    c.target_id,
    c.influencer_id,
    c.social_account_id,
    c.platform,
    c.post_id,
    c.destination_id,
    c.external_object_type,
    c.external_object_id,
    c.published_at,
    p_now,
    p_now,
    p_now
  from public.preview_comment_sync_target_bootstrap(p_limit, p_platform, p_now) c
  on conflict do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

create or replace function public.claim_due_comment_sync_targets(
  p_limit integer,
  p_platform text,
  p_now timestamptz,
  p_stale_before timestamptz,
  p_claim_token uuid
)
returns setof public.comment_sync_targets
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_platform not in ('all', 'instagram', 'facebook') then
    raise exception 'Unsupported platform filter: %', p_platform;
  end if;

  if p_limit < 1 or p_limit > 100 then
    raise exception 'Claim limit must be between 1 and 100.';
  end if;

  return query
  with due as (
    select t.id
    from public.comment_sync_targets t
    where (p_platform = 'all' or t.platform = p_platform)
      and t.next_sync_at <= p_now
      and (
        t.sync_claim_token is null
        or t.sync_claimed_at is null
        or t.sync_claimed_at < p_stale_before
      )
    order by
      case
        when t.published_at >= p_now - interval '24 hours' then 1
        when t.published_at >= p_now - interval '7 days' then 2
        when t.published_at >= p_now - interval '30 days' then 3
        else 4
      end,
      t.next_sync_at,
      t.published_at desc,
      t.id
    for update skip locked
    limit p_limit
  )
  update public.comment_sync_targets t
  set
    sync_claim_token = p_claim_token,
    sync_claimed_at = p_now,
    updated_at = p_now
  from due
  where t.id = due.id
  returning t.*;
end;
$$;

create or replace function public.complete_comment_sync(
  p_target_id uuid,
  p_claim_token uuid,
  p_observed_at timestamptz,
  p_next_sync_at timestamptz,
  p_comments jsonb
)
returns table (
  comments_observed integer,
  comments_inserted integer,
  new_inbound_comments integer,
  threads_updated integer,
  effective_next_sync_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_target public.comment_sync_targets%rowtype;
  v_item jsonb;
  v_comment_id uuid;
  v_root_id uuid;
  v_existing boolean;
  v_author_external_id text;
  v_own_external_id text;
  v_is_own boolean;
  v_observed integer := 0;
  v_inserted integer := 0;
  v_new_inbound integer := 0;
  v_threads integer := 0;
  v_effective_next timestamptz;
begin
  select t.*
  into v_target
  from public.comment_sync_targets t
  where t.id = p_target_id
    and t.sync_claim_token = p_claim_token
  for update;

  if not found then
    raise exception 'Comment sync target claim was lost for %', p_target_id;
  end if;

  select a.external_account_id
  into v_own_external_id
  from public.social_accounts a
  where a.id = v_target.social_account_id;

  if v_own_external_id is null then
    raise exception 'Comment sync target account is missing for %', p_target_id;
  end if;

  if p_comments is null or jsonb_typeof(p_comments) <> 'array' then
    raise exception 'p_comments must be a JSON array.';
  end if;

  for v_item in select value from jsonb_array_elements(p_comments)
  loop
    if nullif(v_item ->> 'externalCommentId', '') is null then
      raise exception 'Normalized comment is missing externalCommentId.';
    end if;

    if nullif(v_item ->> 'threadRootExternalCommentId', '') is null then
      raise exception 'Normalized comment is missing threadRootExternalCommentId.';
    end if;

    if nullif(v_item ->> 'createdAt', '') is null then
      raise exception 'Normalized comment is missing createdAt.';
    end if;

    v_observed := v_observed + 1;
    v_author_external_id := nullif(v_item ->> 'authorExternalId', '');
    v_is_own := v_author_external_id is not null
      and v_author_external_id = v_own_external_id;

    select exists (
      select 1
      from public.social_comments c
      where c.platform = v_target.platform
        and c.social_account_id = v_target.social_account_id
        and c.external_comment_id = v_item ->> 'externalCommentId'
    ) into v_existing;

    insert into public.social_comments (
      sync_target_id,
      influencer_id,
      platform,
      social_account_id,
      post_id,
      destination_id,
      external_object_type,
      external_post_id,
      external_comment_id,
      parent_external_comment_id,
      thread_root_external_comment_id,
      author_external_id,
      author_username,
      author_name,
      message,
      comment_created_at,
      like_count,
      is_from_our_account,
      is_hidden,
      is_deleted,
      source_data,
      first_seen_at,
      last_seen_at,
      last_synced_at,
      created_at,
      updated_at
    ) values (
      v_target.id,
      v_target.influencer_id,
      v_target.platform,
      v_target.social_account_id,
      v_target.post_id,
      v_target.destination_id,
      v_target.external_object_type,
      v_target.external_object_id,
      v_item ->> 'externalCommentId',
      nullif(v_item ->> 'parentExternalCommentId', ''),
      v_item ->> 'threadRootExternalCommentId',
      v_author_external_id,
      nullif(v_item ->> 'authorUsername', ''),
      nullif(v_item ->> 'authorName', ''),
      v_item ->> 'message',
      (v_item ->> 'createdAt')::timestamptz,
      case
        when jsonb_typeof(v_item -> 'likeCount') = 'number'
          then (v_item ->> 'likeCount')::bigint
        else null
      end,
      v_is_own,
      case
        when jsonb_typeof(v_item -> 'isHidden') = 'boolean'
          then (v_item ->> 'isHidden')::boolean
        else null
      end,
      case
        when jsonb_typeof(v_item -> 'isDeleted') = 'boolean'
          then (v_item ->> 'isDeleted')::boolean
        else false
      end,
      coalesce(v_item -> 'source', '{}'::jsonb),
      p_observed_at,
      p_observed_at,
      p_observed_at,
      p_observed_at,
      p_observed_at
    )
    on conflict (platform, social_account_id, external_comment_id)
    do update set
      sync_target_id = excluded.sync_target_id,
      influencer_id = excluded.influencer_id,
      post_id = excluded.post_id,
      destination_id = excluded.destination_id,
      external_object_type = excluded.external_object_type,
      external_post_id = excluded.external_post_id,
      parent_external_comment_id = excluded.parent_external_comment_id,
      thread_root_external_comment_id = excluded.thread_root_external_comment_id,
      author_external_id = excluded.author_external_id,
      author_username = excluded.author_username,
      author_name = excluded.author_name,
      message = excluded.message,
      comment_created_at = excluded.comment_created_at,
      like_count = excluded.like_count,
      is_from_our_account = excluded.is_from_our_account,
      is_hidden = excluded.is_hidden,
      is_deleted = excluded.is_deleted,
      source_data = excluded.source_data,
      last_seen_at = excluded.last_seen_at,
      last_synced_at = excluded.last_synced_at,
      updated_at = excluded.updated_at
    returning id into v_comment_id;

    if not v_existing then
      v_inserted := v_inserted + 1;
      if not v_is_own then
        v_new_inbound := v_new_inbound + 1;
      end if;
    end if;
  end loop;

  update public.social_comments c
  set
    parent_comment_id = (
      select parent.id
      from public.social_comments parent
      where parent.platform = c.platform
        and parent.social_account_id = c.social_account_id
        and parent.external_comment_id = c.parent_external_comment_id
      limit 1
    ),
    thread_root_comment_id = (
      select root.id
      from public.social_comments root
      where root.platform = c.platform
        and root.social_account_id = c.social_account_id
        and root.external_comment_id = c.thread_root_external_comment_id
      limit 1
    ),
    updated_at = p_observed_at
  where c.sync_target_id = v_target.id;

  for v_root_id in
    select distinct c.thread_root_comment_id
    from public.social_comments c
    join public.social_comments root on root.id = c.thread_root_comment_id
    where c.sync_target_id = v_target.id
      and c.thread_root_comment_id is not null
      and not root.is_from_our_account
  loop
    insert into public.social_comment_threads (
      root_comment_id,
      influencer_id,
      platform,
      social_account_id,
      post_id,
      destination_id,
      needs_reply,
      latest_inbound_comment_id,
      latest_inbound_at,
      latest_own_reply_comment_id,
      latest_own_reply_at,
      last_activity_at,
      created_at,
      updated_at
    )
    select
      v_root_id,
      v_target.influencer_id,
      v_target.platform,
      v_target.social_account_id,
      v_target.post_id,
      v_target.destination_id,
      inbound.id is not null
        and (
          own_reply.id is null
          or inbound.comment_created_at >= own_reply.comment_created_at
        ),
      inbound.id,
      inbound.comment_created_at,
      own_reply.id,
      own_reply.comment_created_at,
      coalesce(latest.comment_created_at, root_record.comment_created_at),
      p_observed_at,
      p_observed_at
    from public.social_comments root_record
    left join lateral (
      select c.id, c.comment_created_at, c.is_from_our_account
      from public.social_comments c
      where c.thread_root_comment_id = v_root_id
        and not c.is_deleted
        and coalesce(c.is_hidden, false) = false
      order by c.comment_created_at desc, c.id desc
      limit 1
    ) latest on true
    left join lateral (
      select c.id, c.comment_created_at
      from public.social_comments c
      where c.thread_root_comment_id = v_root_id
        and not c.is_from_our_account
        and not c.is_deleted
        and coalesce(c.is_hidden, false) = false
      order by c.comment_created_at desc, c.id desc
      limit 1
    ) inbound on true
    left join lateral (
      select c.id, c.comment_created_at
      from public.social_comments c
      where c.thread_root_comment_id = v_root_id
        and c.is_from_our_account
        and not c.is_deleted
        and coalesce(c.is_hidden, false) = false
      order by c.comment_created_at desc, c.id desc
      limit 1
    ) own_reply on true
    where root_record.id = v_root_id
    on conflict (root_comment_id)
    do update set
      influencer_id = excluded.influencer_id,
      platform = excluded.platform,
      social_account_id = excluded.social_account_id,
      post_id = excluded.post_id,
      destination_id = excluded.destination_id,
      needs_reply = excluded.needs_reply,
      latest_inbound_comment_id = excluded.latest_inbound_comment_id,
      latest_inbound_at = excluded.latest_inbound_at,
      latest_own_reply_comment_id = excluded.latest_own_reply_comment_id,
      latest_own_reply_at = excluded.latest_own_reply_at,
      last_activity_at = excluded.last_activity_at,
      updated_at = excluded.updated_at;

    v_threads := v_threads + 1;
  end loop;

  v_effective_next := case
    when v_new_inbound > 0 then
      p_observed_at
      + interval '3 minutes'
      + make_interval(
          secs => (
            ((hashtextextended(v_target.id::text, 0) % 61) + 61) % 61
          )::integer - 30
        )
    else p_next_sync_at
  end;

  update public.comment_sync_targets t
  set
    next_sync_at = v_effective_next,
    last_synced_at = p_observed_at,
    last_comment_activity_at = case
      when v_new_inbound > 0 then p_observed_at
      else t.last_comment_activity_at
    end,
    sync_count = t.sync_count + 1,
    sync_claim_token = null,
    sync_claimed_at = null,
    sync_error_count = 0,
    last_sync_error = null,
    last_sync_error_at = null,
    updated_at = p_observed_at
  where t.id = v_target.id
    and t.sync_claim_token = p_claim_token;

  comments_observed := v_observed;
  comments_inserted := v_inserted;
  new_inbound_comments := v_new_inbound;
  threads_updated := v_threads;
  effective_next_sync_at := v_effective_next;
  return next;
end;
$$;

create or replace function public.fail_comment_sync(
  p_target_id uuid,
  p_claim_token uuid,
  p_failed_at timestamptz,
  p_next_sync_at timestamptz,
  p_error_message text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_updated integer;
begin
  update public.comment_sync_targets t
  set
    next_sync_at = p_next_sync_at,
    sync_claim_token = null,
    sync_claimed_at = null,
    sync_error_count = t.sync_error_count + 1,
    last_sync_error = left(coalesce(p_error_message, 'Unknown comment sync error.'), 1000),
    last_sync_error_at = p_failed_at,
    updated_at = p_failed_at
  where t.id = p_target_id
    and t.sync_claim_token = p_claim_token;

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

revoke execute on function public.preview_comment_sync_target_bootstrap(integer, text, timestamptz)
  from public, anon, authenticated;
revoke execute on function public.bootstrap_comment_sync_targets(integer, text, timestamptz)
  from public, anon, authenticated;
revoke execute on function public.claim_due_comment_sync_targets(integer, text, timestamptz, timestamptz, uuid)
  from public, anon, authenticated;
revoke execute on function public.complete_comment_sync(uuid, uuid, timestamptz, timestamptz, jsonb)
  from public, anon, authenticated;
revoke execute on function public.fail_comment_sync(uuid, uuid, timestamptz, timestamptz, text)
  from public, anon, authenticated;

grant execute on function public.preview_comment_sync_target_bootstrap(integer, text, timestamptz)
  to service_role;
grant execute on function public.bootstrap_comment_sync_targets(integer, text, timestamptz)
  to service_role;
grant execute on function public.claim_due_comment_sync_targets(integer, text, timestamptz, timestamptz, uuid)
  to service_role;
grant execute on function public.complete_comment_sync(uuid, uuid, timestamptz, timestamptz, jsonb)
  to service_role;
grant execute on function public.fail_comment_sync(uuid, uuid, timestamptz, timestamptz, text)
  to service_role;
