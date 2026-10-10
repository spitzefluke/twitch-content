-- ============================================================
-- StreamHelp: Umfragen (Content-Idee „Umfrage“) – fürs Twitch-Panel, den Chat und die Webseite
--   · Streamer und Mods stellen eine Frage mit 2–5 Antworten, optional mit Zeitlimit.
--   · Abstimmen: im Twitch-Panel unter dem Stream (Edge Function twitch-ext), im Chat mit
--     „!vote 2“ (wenn erlaubt) oder auf der Webseite. Jeder hat eine Stimme und kann sie ändern.
--   · core.polls (eine Zeile je Kanal) hält Frage, Antworten und Zwischenstand – für alle lesbar
--     (Overlay-Ebene „Umfrage“ ohne Anmeldung). Wer wofür gestimmt hat, steht in core.poll_votes
--     und ist nur über die Funktionen erreichbar.
--   · Beendete Umfragen landen mit Ergebnis in core.poll_history (die letzten 20 je Kanal).
-- Braucht 20261028000000_platform.sql und 20261031000000_security.sql. Mehrfach ausführbar.
-- ============================================================

do $$
begin
  if to_regclass('public.channels') is null then
    raise exception 'Erst die Plattform-Migration 20261028000000_platform.sql ausführen.';
  end if;
end;
$$;

-- ---------- Kachel ----------
alter table core.tiles drop constraint if exists tiles_kind_check;
alter table core.tiles add constraint tiles_kind_check
  check (kind in ('wheel', 'countdown', 'prank', 'bingo', 'questions', 'pet', 'shop', 'challenge',
                  'forbidden', 'subathon', 'pause', 'quiz', 'queue', 'tts', 'cards', 'giveaway', 'hotwords', 'poll'));

-- In jeden Kanal, der schon Kacheln hat (neue Kanäle bekommen sie mit der Vorlage des Standard-Kanals).
-- Wie bei den anderen Ideen: vor die Countdowns.
do $$
declare
  c record;
begin
  for c in
    select ch.id from public.channels ch
    where exists (select 1 from core.tiles t where t.channel_id = ch.id)
      and not exists (select 1 from core.tiles t where t.channel_id = ch.id and t.kind = 'poll')
  loop
    update core.tiles set position = position + 1 where channel_id = c.id and kind = 'countdown';
    insert into core.tiles (channel_id, id, position, kind, title, description, theme)
    values (c.id, 'poll',
            (select coalesce(max(t.position), 1) + 1 from core.tiles t where t.channel_id = c.id and t.kind <> 'countdown'),
            'poll', 'Umfrage', 'Der Chat entscheidet: Frage stellen, abstimmen im Panel unter dem Stream oder mit !vote im Chat.', 'poll')
    on conflict (channel_id, id) do nothing;
  end loop;
end;
$$;

-- ---------- Stand (eine Zeile je Kanal, für alle lesbar) ----------
create table if not exists core.polls (
  channel_id uuid not null default public.current_channel() references public.channels on delete cascade,
  id int not null default 1 check (id = 1),
  status text not null default 'idle' check (status in ('idle', 'open', 'closed')),
  round int not null default 0,
  question text not null default '' check (char_length(question) <= 120),
  options text[] not null default '{}' check (cardinality(options) <= 5),
  counts int[] not null default '{}',
  total int not null default 0 check (total >= 0),
  chat_vote boolean not null default true,      -- „!vote 2“ im Chat zählt
  opened_at timestamptz,
  ends_at timestamptz,                           -- null: bis der Streamer beendet
  closed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (channel_id, id)
);
alter table core.polls enable row level security;
drop policy if exists "polls: lesen für alle" on core.polls;
create policy "polls: lesen für alle" on core.polls for select to anon, authenticated using (true);
revoke all on core.polls from anon, authenticated;
grant select on core.polls to anon, authenticated;
select public.channel_view('polls');
select public.realtime_add('polls');
-- Schreiben nur über die Funktionen unten

-- Stimmen der laufenden Umfrage (nur über Funktionen)
create table if not exists core.poll_votes (
  channel_id uuid not null default public.current_channel() references public.channels on delete cascade,
  round int not null,
  voter text not null check (char_length(voter) between 1 and 60),  -- tw:<twitch-id> oder u:<konto>
  choice smallint not null check (choice between 1 and 5),
  source text not null default 'web' check (source in ('panel', 'chat', 'web')),
  created_at timestamptz not null default now(),
  primary key (channel_id, round, voter)
);
alter table core.poll_votes enable row level security;
revoke all on core.poll_votes from anon, authenticated;

-- Beendete Umfragen mit Ergebnis
create table if not exists core.poll_history (
  id bigint generated always as identity primary key,
  channel_id uuid not null default public.current_channel() references public.channels on delete cascade,
  question text not null,
  options text[] not null,
  counts int[] not null,
  total int not null,
  opened_at timestamptz,
  closed_at timestamptz not null default now()
);
create index if not exists poll_history_channel_idx on core.poll_history (channel_id, closed_at desc);
alter table core.poll_history enable row level security;
drop policy if exists "poll_history: lesen für angemeldete" on core.poll_history;
create policy "poll_history: lesen für angemeldete" on core.poll_history for select to authenticated using (true);
revoke all on core.poll_history from anon, authenticated;
grant select on core.poll_history to authenticated;
select public.channel_view('poll_history');

-- ---------- Mod-Rechte: Umfragen gehören zum Bereich „Spiele & Mitmachen“ (games) ----------
create or replace function public.request_area()
returns text language sql stable set search_path = '' as $$
  select coalesce(nullif(current_setting('app.area', true), ''), case
    when p ~ '^giveaway' then 'giveaway'
    when p ~ '^(spins?($|_)|wheel|overlay_spins)' then 'wheel'
    when p ~ '^bingo' then 'bingo'
    when p ~ '^(tiles?($|_)|ideas?($|_)|idea_votes|feature_open|games_|questions?($|_)|question_)' then 'ideas'
    when p ~ '^(quiz|shop|challenge|win_challenge|queue|cards?_|forbidden|hotword|pause|poll)' then 'games'
    when p ~ '^(send_prank|prank|sounds($|_)|tts)' then 'pranks'
    when p ~ '^pet' then 'pet'
    when p ~ '^(overlay|alert|ticker|stream_alerts|subathon|anniversary)' then 'overlay'
    when p ~ '^(bot_|chat_)' then 'chat'
    when p ~ '^stream_reward' then 'points'
    when p ~ '^site_guard' then 'guard'
  end)
  from (select lower(regexp_replace(coalesce(current_setting('request.path', true), ''), '^/(rpc/)?', '')) as p) x;
$$;

-- ---------- Hilfen ----------
-- Ergebnis als Text für den Chat: „Pizza 60 % · Döner 40 % (10 Stimmen)“
create or replace function public.poll_result_text(p core.polls)
returns text language sql immutable set search_path = '' as $$
  select coalesce(string_agg(format('%s %s %%', o.opt,
           case when p.total > 0 then round(100.0 * coalesce(p.counts[o.i], 0) / p.total) else 0 end), ' · ' order by o.i), '')
         || format(' (%s %s)', p.total, case when p.total = 1 then 'Stimme' else 'Stimmen' end)
  from unnest(p.options) with ordinality as o(opt, i);
$$;
revoke execute on function public.poll_result_text(core.polls) from public, anon, authenticated;

-- Laufende Umfrage beenden (Ergebnis merken, Bot verkündet es). Intern.
create or replace function public.poll_finish(p_ch uuid)
returns core.polls language plpgsql security definer set search_path = '' as $$
declare
  p core.polls;
begin
  update core.polls set status = 'closed', closed_at = now(), updated_at = now()
   where channel_id = p_ch and id = 1 and status = 'open'
  returning * into p;
  if not found then
    select * into p from core.polls where channel_id = p_ch and id = 1;
    return p;
  end if;
  if p.total = 0 then return p; end if;  -- ohne Stimmen gibt es kein Ergebnis
  insert into core.poll_history (channel_id, question, options, counts, total, opened_at, closed_at)
    values (p_ch, p.question, p.options, p.counts, p.total, p.opened_at, p.closed_at);
  delete from core.poll_history where channel_id = p_ch and id not in
    (select id from core.poll_history where channel_id = p_ch order by closed_at desc limit 20);
  if p.chat_vote then
    insert into core.bot_outbox (channel_id, text)
      values (p_ch, left(format('📊 Ergebnis „%s“: %s', p.question, public.poll_result_text(p)), 500));
  end if;
  return p;
end;
$$;
revoke execute on function public.poll_finish(uuid) from public, anon, authenticated;

-- ---------- Streamer und Mods ----------
create or replace function public.poll_start(p_question text, p_options text[], p_minutes int default 0, p_chat boolean default true)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
  v_q text := btrim(regexp_replace(coalesce(p_question, ''), '\s+', ' ', 'g'));
  v_opts text[];
  v_min int := least(greatest(coalesce(p_minutes, 0), 0), 60);
  p core.polls;
begin
  if v_ch is null or not public.is_admin() then
    raise exception 'Umfragen starten dürfen nur der Streamer und die Mods.' using errcode = '42501';
  end if;
  if char_length(v_q) < 3 or char_length(v_q) > 120 then
    raise exception 'Die Frage braucht 3 bis 120 Zeichen.';
  end if;
  select coalesce(array_agg(o order by i), '{}') into v_opts
    from (select left(btrim(regexp_replace(x, '\s+', ' ', 'g')), 60) as o, i
            from unnest(coalesce(p_options, '{}')) with ordinality as u(x, i)) s
   where o <> '';
  if cardinality(v_opts) < 2 or cardinality(v_opts) > 5 then
    raise exception 'Eine Umfrage braucht 2 bis 5 Antworten.';
  end if;
  if (select count(distinct lower(o)) from unnest(v_opts) o) <> cardinality(v_opts) then
    raise exception 'Zwei Antworten sind gleich.';
  end if;
  perform public.poll_finish(v_ch);  -- eine laufende Umfrage zählt als beendet
  insert into core.polls (channel_id, id) values (v_ch, 1) on conflict (channel_id, id) do nothing;
  update core.polls set
    status = 'open', round = round + 1, question = v_q, options = v_opts,
    counts = array_fill(0, array[cardinality(v_opts)]), total = 0, chat_vote = coalesce(p_chat, true),
    opened_at = now(), ends_at = case when v_min > 0 then now() + make_interval(mins => v_min) end,
    closed_at = null, updated_at = now()
  where channel_id = v_ch and id = 1
  returning * into p;
  delete from core.poll_votes where channel_id = v_ch and round < p.round;
  if p.chat_vote then
    insert into core.bot_outbox (channel_id, text) values (v_ch, left(format('📊 Umfrage: %s – abstimmen mit !vote 1–%s: %s',
      v_q, cardinality(v_opts),
      (select string_agg(format('%s) %s', i, o), ' · ' order by i) from unnest(v_opts) with ordinality as u(o, i))), 500));
  end if;
  return row_to_json(p);
end;
$$;
revoke execute on function public.poll_start(text, text[], int, boolean) from public, anon;
grant execute on function public.poll_start(text, text[], int, boolean) to authenticated;

create or replace function public.poll_close()
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
begin
  if v_ch is null or not public.is_admin() then
    raise exception 'Umfragen beenden dürfen nur der Streamer und die Mods.' using errcode = '42501';
  end if;
  return row_to_json(public.poll_finish(v_ch));
end;
$$;
revoke execute on function public.poll_close() from public, anon;
grant execute on function public.poll_close() to authenticated;

-- Ergebnis ausblenden (Overlay und Panel zeigen dann nichts mehr)
create or replace function public.poll_hide()
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
  p core.polls;
begin
  if v_ch is null or not public.is_admin() then
    raise exception 'Nur für den Streamer und die Mods.' using errcode = '42501';
  end if;
  perform public.poll_finish(v_ch);
  update core.polls set status = 'idle', updated_at = now() where channel_id = v_ch and id = 1 returning * into p;
  return row_to_json(p);
end;
$$;
revoke execute on function public.poll_hide() from public, anon;
grant execute on function public.poll_hide() to authenticated;

-- Zeit abgelaufen? Dann beenden. Darf jeder aufrufen (das Overlay, wenn der Countdown 0 erreicht) –
-- es passiert nur etwas, wenn die Zeit wirklich um ist.
create or replace function public.poll_tick()
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
begin
  if v_ch is null then return; end if;
  if exists (select 1 from core.polls where channel_id = v_ch and id = 1 and status = 'open' and ends_at <= now()) then
    perform public.poll_finish(v_ch);
  end if;
end;
$$;
revoke execute on function public.poll_tick() from public;
grant execute on function public.poll_tick() to anon, authenticated;

-- ---------- Abstimmen ----------
-- Intern (Edge Functions mit Service-Rolle, poll_vote_web): eine Stimme abgeben oder ändern.
-- Antwort: {ok, choice, counts, total} oder {ok:false, reason: closed|paused|choice|chat_off}
create or replace function public.poll_vote(p_key text, p_choice int, p_source text default 'web')
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
  p core.polls;
  v_old smallint;
  v_src text := case when p_source in ('panel', 'chat', 'web') then p_source else 'web' end;
begin
  if v_ch is null or coalesce(p_key, '') = '' then return json_build_object('ok', false, 'reason', 'closed'); end if;
  -- Zeile sperren: Stimmen zählen nacheinander, der Zwischenstand stimmt immer
  select * into p from core.polls where channel_id = v_ch and id = 1 for update;
  if public.viewer_paused() then return json_build_object('ok', false, 'reason', 'paused'); end if;
  if not found or p.status <> 'open' or not public.tile_started('poll') then
    return json_build_object('ok', false, 'reason', 'closed');
  end if;
  if p.ends_at is not null and p.ends_at <= now() then
    perform public.poll_finish(v_ch);
    return json_build_object('ok', false, 'reason', 'closed');
  end if;
  if v_src = 'chat' and not p.chat_vote then return json_build_object('ok', false, 'reason', 'chat_off'); end if;
  if p_choice is null or p_choice < 1 or p_choice > cardinality(p.options) then
    return json_build_object('ok', false, 'reason', 'choice');
  end if;

  select choice into v_old from core.poll_votes where channel_id = v_ch and round = p.round and voter = left(p_key, 60);
  if v_old is null then
    insert into core.poll_votes (channel_id, round, voter, choice, source) values (v_ch, p.round, left(p_key, 60), p_choice, v_src);
    p.counts[p_choice] := coalesce(p.counts[p_choice], 0) + 1;
    p.total := p.total + 1;
  elsif v_old <> p_choice then
    update core.poll_votes set choice = p_choice, source = v_src, created_at = now()
     where channel_id = v_ch and round = p.round and voter = left(p_key, 60);
    p.counts[v_old] := greatest(coalesce(p.counts[v_old], 0) - 1, 0);
    p.counts[p_choice] := coalesce(p.counts[p_choice], 0) + 1;
  end if;
  if v_old is distinct from p_choice then
    update core.polls set counts = p.counts, total = p.total, updated_at = now() where channel_id = v_ch and id = 1;
  end if;
  return json_build_object('ok', true, 'choice', p_choice, 'changed', v_old is not null and v_old <> p_choice,
                           'counts', p.counts, 'total', p.total);
end;
$$;
revoke execute on function public.poll_vote(text, int, text) from public, anon, authenticated;

-- Meine Stimme (intern, für das Panel)
create or replace function public.poll_choice(p_key text)
returns int language sql stable security definer set search_path = '' as $$
  select v.choice::int from core.poll_votes v
    join core.polls p on p.channel_id = v.channel_id and p.id = 1 and p.round = v.round
   where v.channel_id = public.current_channel() and v.voter = left(p_key, 60);
$$;
revoke execute on function public.poll_choice(text) from public, anon, authenticated;

-- Webseite (angemeldet)
create or replace function public.poll_vote_web(p_choice int)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_key text := public.my_player_key();
begin
  if v_key is null then raise exception 'Bitte anmelden.'; end if;
  return public.poll_vote(v_key, p_choice, 'web');
end;
$$;
revoke execute on function public.poll_vote_web(int) from public, anon;
grant execute on function public.poll_vote_web(int) to authenticated;

create or replace function public.poll_me()
returns int language sql stable security definer set search_path = '' as $$
  select public.poll_choice(public.my_player_key());
$$;
revoke execute on function public.poll_me() from public, anon;
grant execute on function public.poll_me() to authenticated;

notify pgrst, 'reload schema';
