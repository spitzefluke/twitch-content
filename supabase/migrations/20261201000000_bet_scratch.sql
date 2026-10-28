-- ============================================================
-- StreamHelp: Zuschauer-Wette, Rubbellos und die Kachel „Emote-Regen“ (nach …_profile_schedule.sql einspielen)
--   · Zuschauer-Wette: Der Streamer fragt „Schaffe ich den Boss im 1. Versuch?“ (2–4 Antworten). Zuschauer
--     tippen mit „!tipp 1“ / „!tipp ja“ im Chat oder auf der Webseite – kostenlos, ohne Twitch-Affiliate.
--     Bis „Tipps schließen“ zählt jeder Tipp (änderbar). Bei der Auflösung bekommen alle mit dem richtigen
--     Tipp Tipp-Punkte – je weniger richtig lagen, desto mehr (Quote = Tipps gesamt ÷ richtige Tipps,
--     aufgerundet, 1–20). Die Punkte sammeln sich in einer Rangliste („!tipp punkte“, „!tipp top“).
--   · Rubbellos: „!rubbeln“ im Chat (oder der Knopf im Dashboard zum Testen) zieht ein Los. Gewinne und ihre
--     Häufigkeit stellt der Streamer ein (z. B. Shoutout, Sound, Spiel aussuchen – „Niete“ gehört dazu).
--     Pause je Zuschauer, auf Wunsch nur für Abos/VIPs/Mods. Das Overlay (Ebene „Rubbellos“) rubbelt das
--     Los frei, der Bot schreibt das Ergebnis. Gewinne löst der Streamer selbst ein – es gibt kein Geld.
--   · Emote-Regen: nur die Kachel (das Overlay liest den Chat selbst, js/overlay-emoterain.js).
-- Mehrfach ausführbar.
-- ============================================================

do $$
begin
  if to_regclass('core.cup') is null then
    raise exception 'Erst die Migration 20261115000000_cup.sql ausführen.';
  end if;
end;
$$;

-- ---------- Kacheln ----------
alter table core.tiles drop constraint if exists tiles_kind_check;
alter table core.tiles add constraint tiles_kind_check
  check (kind in ('wheel', 'countdown', 'prank', 'bingo', 'questions', 'pet', 'shop', 'challenge',
                  'forbidden', 'subathon', 'pause', 'quiz', 'queue', 'tts', 'cards', 'giveaway', 'hotwords', 'poll',
                  'counter', 'gamewheel', 'heart', 'chatcontrol', 'cup', 'bet', 'scratch', 'emoterain'));

do $$
declare
  c record;
  k record;
begin
  for k in select * from (values
      ('bet', 'Zuschauer-Wette', 'Schafft der Streamer es? Der Chat tippt mit !tipp – richtige Tipps bringen Tipp-Punkte und einen Platz in der Rangliste.'),
      ('scratch', 'Rubbellos', 'Mit !rubbeln ein Los ziehen: Shoutout, Sound, Spiel aussuchen – oder eine Niete. Das Overlay rubbelt live frei.'),
      ('emoterain', 'Emote-Regen', 'Mit !regen lassen Zuschauer ihre Emotes übers ganze Bild regnen – bei Emote-Combos regnet es von selbst.')
    ) as v(kind, title, descr)
  loop
    for c in
      select ch.id from public.channels ch
      where exists (select 1 from core.tiles t where t.channel_id = ch.id)
        and not exists (select 1 from core.tiles t where t.channel_id = ch.id and t.kind = k.kind)
    loop
      update core.tiles set position = position + 1 where channel_id = c.id and kind = 'countdown';
      insert into core.tiles (channel_id, id, position, kind, title, description, theme)
      values (c.id, k.kind,
              (select coalesce(max(t.position), 1) + 1 from core.tiles t where t.channel_id = c.id and t.kind <> 'countdown'),
              k.kind, k.title, k.descr, k.kind)
      on conflict (channel_id, id) do nothing;
    end loop;
  end loop;
end;
$$;

-- ---------- Mod-Rechte: Wette und Rubbellos gehören zu „Spiele & Mitmachen“ (games) ----------
create or replace function public.request_area()
returns text language sql stable set search_path = '' as $$
  select coalesce(nullif(current_setting('app.area', true), ''), case
    when p ~ '^giveaway' then 'giveaway'
    when p ~ '^(spins?($|_)|wheel|overlay_spins)' then 'wheel'
    when p ~ '^bingo' then 'bingo'
    when p ~ '^(tiles?($|_)|ideas?($|_)|idea_votes|feature_open|games_|questions?($|_)|question_)' then 'ideas'
    when p ~ '^(quiz|shop|challenge|win_challenge|queue|cards?_|forbidden|hotword|pause|poll|bet|scratch)' then 'games'
    when p ~ '^(send_prank|prank|sounds($|_)|tts)' then 'pranks'
    when p ~ '^pet' then 'pet'
    when p ~ '^(overlay|alert|ticker|stream_alerts|subathon|anniversary)' then 'overlay'
    when p ~ '^(bot_|chat_)' then 'chat'
    when p ~ '^stream_reward' then 'points'
    when p ~ '^site_guard' then 'guard'
  end)
  from (select lower(regexp_replace(coalesce(current_setting('request.path', true), ''), '^/(rpc/)?', '')) as p) x;
$$;

-- ============================================================
-- Zuschauer-Wette
-- ============================================================
create table if not exists core.bets (
  channel_id uuid not null default public.current_channel() references public.channels on delete cascade,
  id int not null default 1 check (id = 1),
  status text not null default 'idle' check (status in ('idle', 'open', 'locked', 'resolved', 'cancelled')),
  round int not null default 0,
  question text not null default '' check (char_length(question) <= 120),
  options text[] not null default '{}' check (cardinality(options) <= 4),
  counts int[] not null default '{}',
  total int not null default 0 check (total >= 0),
  winner smallint,                              -- 1–4 nach der Auflösung
  points int not null default 0,                -- Tipp-Punkte je richtigem Tipp in dieser Runde
  opened_at timestamptz,
  lock_at timestamptz,                          -- null: bis der Streamer die Tipps schließt
  resolved_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (channel_id, id)
);
alter table core.bets enable row level security;
drop policy if exists "bets: lesen für alle" on core.bets;
create policy "bets: lesen für alle" on core.bets for select to anon, authenticated using (true);
revoke all on core.bets from anon, authenticated;
grant select on core.bets to anon, authenticated;
select public.channel_view('bets');
select public.realtime_add('bets');

create table if not exists core.bet_votes (
  channel_id uuid not null default public.current_channel() references public.channels on delete cascade,
  round int not null,
  voter text not null check (char_length(voter) between 1 and 60),   -- tw:<twitch-id> oder u:<konto>
  name text not null default '' check (char_length(name) <= 40),
  choice smallint not null check (choice between 1 and 4),
  source text not null default 'web' check (source in ('chat', 'web')),
  created_at timestamptz not null default now(),
  primary key (channel_id, round, voter)
);
alter table core.bet_votes enable row level security;
revoke all on core.bet_votes from anon, authenticated;

create table if not exists core.bet_scores (
  channel_id uuid not null default public.current_channel() references public.channels on delete cascade,
  player_key text not null check (char_length(player_key) between 1 and 60),
  name text not null default '' check (char_length(name) <= 40),
  points int not null default 0,
  wins int not null default 0,
  tips int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (channel_id, player_key)
);
create index if not exists bet_scores_rank on core.bet_scores (channel_id, points desc, wins desc);
alter table core.bet_scores enable row level security;
revoke all on core.bet_scores from anon, authenticated;

-- Rangliste ohne Twitch-IDs (für Overlay, Webseite und Chat)
create or replace function public.bet_top(p_limit int default 10)
returns json language sql stable security definer set search_path = '' as $$
  select coalesce(json_agg(json_build_object('name', s.name, 'points', s.points, 'wins', s.wins, 'tips', s.tips) order by s.points desc, s.wins desc, s.name), '[]'::json)
  from (select * from core.bet_scores where channel_id = public.current_channel() and points > 0
        order by points desc, wins desc, name limit greatest(1, least(coalesce(p_limit, 10), 50))) s;
$$;
grant execute on function public.bet_top(int) to anon, authenticated;

-- Tipps schließen, wenn die Zeit um ist (intern)
create or replace function public.bet_autolock(p_ch uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update core.bets set status = 'locked', updated_at = now()
   where channel_id = p_ch and id = 1 and status = 'open' and lock_at is not null and lock_at <= now();
  if found then
    insert into core.bot_outbox (channel_id, text)
      select p_ch, left(format('🔒 Tipps geschlossen: „%s“ – %s %s. Gleich kommt die Auflösung!', question, total,
                               case when total = 1 then 'Tipp' else 'Tipps' end), 500)
        from core.bets where channel_id = p_ch and id = 1;
  end if;
end;
$$;
revoke execute on function public.bet_autolock(uuid) from public, anon, authenticated;

-- Darf jeder aufrufen (Overlay, wenn der Countdown 0 erreicht) – passiert nur, wenn die Zeit wirklich um ist
create or replace function public.bet_tick()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.current_channel() is not null then perform public.bet_autolock(public.current_channel()); end if;
end;
$$;
revoke execute on function public.bet_tick() from public;
grant execute on function public.bet_tick() to anon, authenticated;

-- ---------- Streamer und Mods ----------
create or replace function public.bet_start(p_question text, p_options text[], p_minutes int default 0)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
  v_q text := btrim(regexp_replace(coalesce(p_question, ''), '\s+', ' ', 'g'));
  v_opts text[];
  v_min int := least(greatest(coalesce(p_minutes, 0), 0), 60);
  b core.bets;
begin
  if v_ch is null or not public.is_admin() then
    raise exception 'Wetten starten dürfen nur der Streamer und die Mods.' using errcode = '42501';
  end if;
  if char_length(v_q) < 3 or char_length(v_q) > 120 then raise exception 'Die Frage braucht 3 bis 120 Zeichen.'; end if;
  select coalesce(array_agg(o order by i), '{}') into v_opts
    from (select left(btrim(regexp_replace(x, '\s+', ' ', 'g')), 40) as o, i
            from unnest(coalesce(p_options, '{}')) with ordinality as u(x, i)) s
   where o <> '';
  if cardinality(v_opts) < 2 or cardinality(v_opts) > 4 then raise exception 'Eine Wette braucht 2 bis 4 Antworten.'; end if;
  if (select count(distinct lower(o)) from unnest(v_opts) o) <> cardinality(v_opts) then raise exception 'Zwei Antworten sind gleich.'; end if;
  if exists (select 1 from core.bets where channel_id = v_ch and id = 1 and status in ('open', 'locked')) then
    raise exception 'Es läuft noch eine Wette – erst auflösen oder abbrechen.';
  end if;
  insert into core.bets (channel_id, id) values (v_ch, 1) on conflict (channel_id, id) do nothing;
  update core.bets set
    status = 'open', round = round + 1, question = v_q, options = v_opts, counts = array_fill(0, array[cardinality(v_opts)]),
    total = 0, winner = null, points = 0, opened_at = now(), resolved_at = null,
    lock_at = case when v_min > 0 then now() + make_interval(mins => v_min) end, updated_at = now()
  where channel_id = v_ch and id = 1
  returning * into b;
  delete from core.bet_votes where channel_id = v_ch and round < b.round;
  insert into core.bot_outbox (channel_id, text) values (v_ch, left(format('🎯 Wette: %s – tippen mit !tipp %s%s',
    v_q, (select string_agg(format('%s (%s)', i, o), ' · ' order by i) from unnest(v_opts) with ordinality as u(o, i)),
    case when v_min > 0 then format(' – %s Min. Zeit', v_min) else '' end), 500));
  return row_to_json(b);
end;
$$;
revoke execute on function public.bet_start(text, text[], int) from public, anon;
grant execute on function public.bet_start(text, text[], int) to authenticated;

create or replace function public.bet_lock()
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
  b core.bets;
begin
  if v_ch is null or not public.is_admin() then raise exception 'Nur für den Streamer und die Mods.' using errcode = '42501'; end if;
  update core.bets set lock_at = now() where channel_id = v_ch and id = 1 and status = 'open';
  perform public.bet_autolock(v_ch);
  select * into b from core.bets where channel_id = v_ch and id = 1;
  return row_to_json(b);
end;
$$;
revoke execute on function public.bet_lock() from public, anon;
grant execute on function public.bet_lock() to authenticated;

-- Auflösen: richtige Tipps bekommen Tipp-Punkte (Quote), alle anderen zählen als Tipp
create or replace function public.bet_resolve(p_winner int)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
  b core.bets;
  v_right int;
  v_points int;
  v_names text;
begin
  if v_ch is null or not public.is_admin() then raise exception 'Nur für den Streamer und die Mods.' using errcode = '42501'; end if;
  select * into b from core.bets where channel_id = v_ch and id = 1 for update;
  if not found or b.status not in ('open', 'locked') then raise exception 'Gerade läuft keine Wette.'; end if;
  if p_winner is null or p_winner < 1 or p_winner > cardinality(b.options) then raise exception 'Diese Antwort gibt es nicht.'; end if;
  v_right := coalesce(b.counts[p_winner], 0);
  v_points := case when v_right > 0 then least(20, greatest(1, ceil(b.total::numeric / v_right)::int)) else 0 end;
  insert into core.bet_scores as s (channel_id, player_key, name, points, wins, tips, updated_at)
    select v_ch, v.voter, v.name, case when v.choice = p_winner then v_points else 0 end,
           case when v.choice = p_winner then 1 else 0 end, 1, now()
      from core.bet_votes v where v.channel_id = v_ch and v.round = b.round
  on conflict (channel_id, player_key) do update set
    name = case when excluded.name <> '' then excluded.name else s.name end,
    points = s.points + excluded.points, wins = s.wins + excluded.wins, tips = s.tips + 1, updated_at = now();
  update core.bets set status = 'resolved', winner = p_winner, points = v_points, resolved_at = now(), updated_at = now()
   where channel_id = v_ch and id = 1 returning * into b;
  select string_agg(name, ', ') into v_names from (
    select v.name from core.bet_votes v where v.channel_id = v_ch and v.round = b.round and v.choice = p_winner and v.name <> ''
    order by v.created_at limit 5) x;
  insert into core.bot_outbox (channel_id, text) values (v_ch, left(case
    when v_right = 0 then format('🎯 Auflösung: %s! Niemand lag richtig – nächstes Mal.', b.options[p_winner])
    else format('🎯 Auflösung: %s! %s %s richtig – je %s Tipp-Punkte%s. Rangliste: !tipp top',
                b.options[p_winner], v_right, case when v_right = 1 then 'Tipp' else 'Tipps' end, v_points,
                case when v_names is not null then format(' (%s%s)', v_names, case when v_right > 5 then ' …' else '' end) else '' end)
    end, 500));
  return row_to_json(b);
end;
$$;
revoke execute on function public.bet_resolve(int) from public, anon;
grant execute on function public.bet_resolve(int) to authenticated;

create or replace function public.bet_cancel()
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
  b core.bets;
begin
  if v_ch is null or not public.is_admin() then raise exception 'Nur für den Streamer und die Mods.' using errcode = '42501'; end if;
  update core.bets set status = 'cancelled', updated_at = now() where channel_id = v_ch and id = 1 and status in ('open', 'locked')
  returning * into b;
  if found then
    insert into core.bot_outbox (channel_id, text) values (v_ch, left(format('🎯 Wette abgebrochen: „%s“ – keine Punkte.', b.question), 500));
  end if;
  update core.bets set status = 'idle', updated_at = now() where channel_id = v_ch and id = 1 and status in ('resolved', 'cancelled')
  returning * into b;
  return row_to_json(b);
end;
$$;
revoke execute on function public.bet_cancel() from public, anon;
grant execute on function public.bet_cancel() to authenticated;

create or replace function public.bet_reset_scores()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.current_channel() is null or not public.is_owner_of(public.current_channel()) then
    raise exception 'Die Rangliste zurücksetzen darf nur der Streamer.' using errcode = '42501';
  end if;
  delete from core.bet_scores where channel_id = public.current_channel();
end;
$$;
revoke execute on function public.bet_reset_scores() from public, anon;
grant execute on function public.bet_reset_scores() to authenticated;

-- ---------- Tippen ----------
-- Intern (Chat über die Edge Function, Webseite über bet_tip_web). {ok, choice, counts, total} oder {ok:false, reason}
create or replace function public.bet_tip(p_key text, p_name text, p_choice int, p_source text default 'web')
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
  b core.bets;
  v_old smallint;
  v_src text := case when p_source = 'chat' then 'chat' else 'web' end;
  v_key text := left(coalesce(p_key, ''), 60);
begin
  if v_ch is null or v_key = '' then return json_build_object('ok', false, 'reason', 'closed'); end if;
  perform public.bet_autolock(v_ch);
  select * into b from core.bets where channel_id = v_ch and id = 1 for update;
  if public.viewer_paused() then return json_build_object('ok', false, 'reason', 'paused'); end if;
  if not found or b.status <> 'open' or not public.tile_started('bet') then return json_build_object('ok', false, 'reason', 'closed'); end if;
  if p_choice is null or p_choice < 1 or p_choice > cardinality(b.options) then return json_build_object('ok', false, 'reason', 'choice'); end if;
  select choice into v_old from core.bet_votes where channel_id = v_ch and round = b.round and voter = v_key;
  if v_old is null then
    insert into core.bet_votes (channel_id, round, voter, name, choice, source)
      values (v_ch, b.round, v_key, left(btrim(coalesce(p_name, '')), 40), p_choice, v_src);
    b.counts[p_choice] := coalesce(b.counts[p_choice], 0) + 1;
    b.total := b.total + 1;
  elsif v_old <> p_choice then
    update core.bet_votes set choice = p_choice, source = v_src, created_at = now()
     where channel_id = v_ch and round = b.round and voter = v_key;
    b.counts[v_old] := greatest(coalesce(b.counts[v_old], 0) - 1, 0);
    b.counts[p_choice] := coalesce(b.counts[p_choice], 0) + 1;
  end if;
  if v_old is distinct from p_choice then
    update core.bets set counts = b.counts, total = b.total, updated_at = now() where channel_id = v_ch and id = 1;
  end if;
  return json_build_object('ok', true, 'choice', p_choice, 'counts', b.counts, 'total', b.total);
end;
$$;
revoke execute on function public.bet_tip(text, text, int, text) from public, anon, authenticated;

create or replace function public.bet_tip_web(p_choice int)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_key text := public.my_player_key();
begin
  if v_key is null then raise exception 'Bitte anmelden.'; end if;
  return public.bet_tip(v_key, (select username from public.profiles where id = auth.uid()), p_choice, 'web');
end;
$$;
revoke execute on function public.bet_tip_web(int) from public, anon;
grant execute on function public.bet_tip_web(int) to authenticated;

-- Mein Tipp und meine Punkte (Webseite)
create or replace function public.bet_me()
returns json language sql stable security definer set search_path = '' as $$
  select json_build_object(
    'choice', (select v.choice from core.bet_votes v join core.bets b on b.channel_id = v.channel_id and b.id = 1 and b.round = v.round
                where v.channel_id = public.current_channel() and v.voter = public.my_player_key()),
    'points', coalesce((select points from core.bet_scores where channel_id = public.current_channel() and player_key = public.my_player_key()), 0));
$$;
revoke execute on function public.bet_me() from public, anon;
grant execute on function public.bet_me() to authenticated;

-- ============================================================
-- Rubbellos
-- ============================================================
create table if not exists core.scratch (
  channel_id uuid not null default public.current_channel() references public.channels on delete cascade,
  id int not null default 1 check (id = 1),
  enabled boolean not null default true,
  who text not null default 'all' check (who in ('all', 'subs', 'mods')),
  cooldown_min int not null default 30 check (cooldown_min between 0 and 1440),   -- je Zuschauer
  prizes jsonb not null default '[
    {"label": "Niete – nächstes Mal!", "emoji": "🍀", "weight": 50, "win": false},
    {"label": "Shoutout vom Streamer", "emoji": "📣", "weight": 15, "win": true},
    {"label": "Ein Sound deiner Wahl", "emoji": "🔊", "weight": 12, "win": true},
    {"label": "Emote-Regen für dich", "emoji": "🌧️", "weight": 12, "win": true},
    {"label": "Du suchst das nächste Game mit aus", "emoji": "🎮", "weight": 8, "win": true},
    {"label": "Hauptgewinn: Ehrenplatz im Chat", "emoji": "👑", "weight": 3, "win": true}
  ]'::jsonb check (jsonb_typeof(prizes) = 'array' and jsonb_array_length(prizes) between 1 and 12),
  updated_at timestamptz not null default now(),
  primary key (channel_id, id)
);
alter table core.scratch enable row level security;
revoke all on core.scratch from anon, authenticated;

-- Gezogene Lose: für alle lesbar (Overlay rubbelt sie frei) – nur Name, Gewinn, Zeit, keine Twitch-ID
create table if not exists core.scratch_draws (
  id bigint generated always as identity primary key,
  channel_id uuid not null default public.current_channel() references public.channels on delete cascade,
  name text not null default '' check (char_length(name) <= 40),
  label text not null check (char_length(label) <= 60),
  emoji text not null default '' check (char_length(emoji) <= 8),
  win boolean not null default false,
  source text not null default 'chat' check (source in ('chat', 'test')),
  created_at timestamptz not null default now()
);
create index if not exists scratch_draws_channel on core.scratch_draws (channel_id, id desc);
alter table core.scratch_draws enable row level security;
drop policy if exists "scratch_draws: lesen für alle" on core.scratch_draws;
create policy "scratch_draws: lesen für alle" on core.scratch_draws for select to anon, authenticated using (true);
revoke all on core.scratch_draws from anon, authenticated;
grant select on core.scratch_draws to anon, authenticated;
select public.channel_view('scratch_draws');
select public.realtime_add('scratch_draws');

-- Wann hat wer zuletzt gerubbelt (Pause je Zuschauer) – nur über die Funktionen
create table if not exists core.scratch_last (
  channel_id uuid not null references public.channels on delete cascade,
  player_key text not null check (char_length(player_key) between 1 and 60),
  last_at timestamptz not null default now(),
  primary key (channel_id, player_key)
);
alter table core.scratch_last enable row level security;
revoke all on core.scratch_last from anon, authenticated;

-- Gewinne prüfen: Text 1–60 Zeichen, Gewicht 0–1000, Emoji kurz
create or replace function public.scratch_clean_prizes(p jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'label', left(btrim(x->>'label'), 60), 'emoji', left(coalesce(x->>'emoji', ''), 8),
      'weight', least(1000, greatest(0, coalesce(nullif(x->>'weight', '')::numeric, 0)::int)),
      'win', coalesce((x->>'win')::boolean, true)) order by o), '[]'::jsonb)
  from jsonb_array_elements(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) with ordinality as e(x, o)
  where o <= 12 and jsonb_typeof(x) = 'object' and char_length(btrim(coalesce(x->>'label', ''))) between 1 and 60
    and coalesce(x->>'weight', '') ~ '^\d{1,4}(\.\d+)?$';
$$;
revoke execute on function public.scratch_clean_prizes(jsonb) from public, anon, authenticated;

create or replace function public.scratch_get()
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
  s core.scratch;
begin
  if v_ch is null or not public.is_admin() then raise exception 'Nur für den Streamer und die Mods.' using errcode = '42501'; end if;
  insert into core.scratch (channel_id, id) values (v_ch, 1) on conflict (channel_id, id) do nothing;
  select * into s from core.scratch where channel_id = v_ch and id = 1;
  return json_build_object('enabled', s.enabled, 'who', s.who, 'cooldown_min', s.cooldown_min, 'prizes', s.prizes,
    'recent', coalesce((select json_agg(json_build_object('name', d.name, 'label', d.label, 'emoji', d.emoji, 'win', d.win,
                         'source', d.source, 'created_at', d.created_at) order by d.id desc)
                        from (select * from core.scratch_draws where channel_id = v_ch order by id desc limit 20) d), '[]'::json));
end;
$$;
revoke execute on function public.scratch_get() from public, anon;
grant execute on function public.scratch_get() to authenticated;

create or replace function public.scratch_save(p_enabled boolean, p_who text, p_cooldown_min int, p_prizes jsonb)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
  v_prizes jsonb := public.scratch_clean_prizes(p_prizes);
begin
  if v_ch is null or not public.is_admin() then raise exception 'Nur für den Streamer und die Mods.' using errcode = '42501'; end if;
  if jsonb_array_length(v_prizes) = 0 then raise exception 'Mindestens ein Gewinn mit Text und Häufigkeit.'; end if;
  if (select coalesce(sum((x->>'weight')::int), 0) from jsonb_array_elements(v_prizes) x) = 0 then
    raise exception 'Mindestens ein Gewinn braucht eine Häufigkeit über 0.';
  end if;
  insert into core.scratch (channel_id, id) values (v_ch, 1) on conflict (channel_id, id) do nothing;
  update core.scratch set enabled = coalesce(p_enabled, true),
    who = case when p_who in ('all', 'subs', 'mods') then p_who else 'all' end,
    cooldown_min = least(1440, greatest(0, coalesce(p_cooldown_min, 30))), prizes = v_prizes, updated_at = now()
  where channel_id = v_ch and id = 1;
  return public.scratch_get();
end;
$$;
revoke execute on function public.scratch_save(boolean, text, int, jsonb) from public, anon;
grant execute on function public.scratch_save(boolean, text, int, jsonb) to authenticated;

-- Ein Los ziehen (intern: Chat über die Edge Function; Test aus dem Dashboard über scratch_test).
-- {ok, label, emoji, win} oder {ok:false, reason: off|closed|paused|who|cooldown, wait (Minuten)}
create or replace function public.scratch_draw(p_key text, p_name text, p_badges text[], p_source text default 'chat')
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
  s core.scratch;
  v_key text := left(coalesce(p_key, ''), 60);
  v_last timestamptz;
  v_sum int;
  v_roll numeric;
  v_acc int := 0;
  x jsonb;
  v_pick jsonb;
  v_src text := case when p_source = 'test' then 'test' else 'chat' end;
begin
  if v_ch is null or v_key = '' then return json_build_object('ok', false, 'reason', 'closed'); end if;
  insert into core.scratch (channel_id, id) values (v_ch, 1) on conflict (channel_id, id) do nothing;
  select * into s from core.scratch where channel_id = v_ch and id = 1 for update;
  if v_src = 'chat' then
    if not s.enabled then return json_build_object('ok', false, 'reason', 'off'); end if;
    if not public.tile_started('scratch') then return json_build_object('ok', false, 'reason', 'closed'); end if;
    if public.viewer_paused() then return json_build_object('ok', false, 'reason', 'paused'); end if;
    if s.who = 'mods' and not (coalesce(p_badges, '{}') && array['broadcaster', 'moderator']) then
      return json_build_object('ok', false, 'reason', 'who');
    end if;
    if s.who = 'subs' and not (coalesce(p_badges, '{}') && array['broadcaster', 'moderator', 'vip', 'subscriber', 'founder']) then
      return json_build_object('ok', false, 'reason', 'who');
    end if;
    select last_at into v_last from core.scratch_last where channel_id = v_ch and player_key = v_key;
    if s.cooldown_min > 0 and v_last is not null and v_last > now() - make_interval(mins => s.cooldown_min) then
      return json_build_object('ok', false, 'reason', 'cooldown',
        'wait', greatest(1, ceil(extract(epoch from v_last + make_interval(mins => s.cooldown_min) - now()) / 60)::int));
    end if;
  end if;
  select coalesce(sum((p->>'weight')::int), 0) into v_sum from jsonb_array_elements(s.prizes) p;
  if v_sum <= 0 then return json_build_object('ok', false, 'reason', 'off'); end if;
  v_roll := floor(random() * v_sum);
  for x in select * from jsonb_array_elements(s.prizes) loop
    v_acc := v_acc + (x->>'weight')::int;
    if v_roll < v_acc then v_pick := x; exit; end if;
  end loop;
  insert into core.scratch_draws (channel_id, name, label, emoji, win, source)
    values (v_ch, left(btrim(coalesce(p_name, '')), 40), v_pick->>'label', coalesce(v_pick->>'emoji', ''),
            coalesce((v_pick->>'win')::boolean, true), v_src);
  if v_src = 'chat' then
    insert into core.scratch_last (channel_id, player_key, last_at) values (v_ch, v_key, now())
      on conflict (channel_id, player_key) do update set last_at = now();
  end if;
  -- Aufräumen: 200 Lose je Kanal reichen; Pausen-Einträge nach 2 Tagen (längste Pause: 1 Tag)
  if random() < 0.05 then
    delete from core.scratch_draws where channel_id = v_ch and id not in
      (select id from core.scratch_draws where channel_id = v_ch order by id desc limit 200);
    delete from core.scratch_last where channel_id = v_ch and last_at < now() - interval '2 days';
  end if;
  return json_build_object('ok', true, 'label', v_pick->>'label', 'emoji', coalesce(v_pick->>'emoji', ''),
                           'win', coalesce((v_pick->>'win')::boolean, true));
end;
$$;
revoke execute on function public.scratch_draw(text, text, text[], text) from public, anon, authenticated;

-- Dashboard: Probe-Los (zählt nicht für die Pause, steht im Overlay als Test)
create or replace function public.scratch_test()
returns json language plpgsql security definer set search_path = '' as $$
begin
  if public.current_channel() is null or not public.is_admin() then raise exception 'Nur für den Streamer und die Mods.' using errcode = '42501'; end if;
  return public.scratch_draw('test:' || auth.uid()::text, 'Test', '{}', 'test');
end;
$$;
revoke execute on function public.scratch_test() from public, anon;
grant execute on function public.scratch_test() to authenticated;

-- ============================================================
-- Chat: !tipp … und !rubbeln (Edge Function → fun_chat, wie cup_chat)
-- ============================================================
create or replace function public.fun_chat(p_user_id text, p_name text, p_badges text[], p_text text)
returns json language plpgsql security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
  v_cmd text;
  v_arg text;
  v_key text := 'tw:' || coalesce(p_user_id, '');
  v_name text := left(btrim(regexp_replace(coalesce(p_name, ''), '[^[:alnum:]_ äöüÄÖÜß.-]', '', 'g')), 40);
  b core.bets;
  r json;
  n int;
  v_slot text;
  v_top text;
  v_me core.bet_scores;
begin
  if v_ch is null or coalesce(p_user_id, '') !~ '^\d{1,20}$' then return json_build_object('handled', false); end if;
  v_cmd := lower(substring(btrim(coalesce(p_text, '')) from '^!([^\s]{1,25})'));
  v_arg := lower(btrim(coalesce(substring(btrim(p_text) from '^![^\s]+\s+(.+)$'), '')));
  if v_name = '' then v_name := 'Zuschauer'; end if;

  -- ---------- Rubbellos ----------
  if v_cmd in ('rubbeln', 'rubbellos', 'los') then
    if not public.tile_started('scratch') then return json_build_object('handled', false); end if;
    r := public.scratch_draw(v_key, v_name, p_badges, 'chat');
    if (r->>'ok')::boolean then
      return json_build_object('handled', true, 'reply', format('🎟️ %s rubbelt … %s %s%s', v_name, r->>'emoji', r->>'label',
        case when (r->>'win')::boolean then ' – der Streamer löst ein!' else '' end));
    end if;
    -- Pause: nur einmal je Zuschauer und Minute antworten, sonst flutet der Bot den Chat
    if r->>'reason' = 'cooldown' then
      v_slot := 'scratch:wait:' || p_user_id;
      if exists (select 1 from core.chat_cooldowns where channel_id = v_ch and slot = v_slot and at > now() - interval '60 seconds') then
        return json_build_object('handled', true);
      end if;
      insert into core.chat_cooldowns (channel_id, slot, at) values (v_ch, v_slot, now()) on conflict (channel_id, slot) do update set at = now();
      return json_build_object('handled', true, 'reply', format('@%s Dein nächstes Los gibt es in %s Min.', v_name, r->>'wait'));
    end if;
    return json_build_object('handled', true);
  end if;

  -- ---------- Zuschauer-Wette ----------
  if v_cmd not in ('tipp', 'tip', 'wette', 'bet') then return json_build_object('handled', false); end if;
  if not public.tile_started('bet') then return json_build_object('handled', false); end if;
  perform public.bet_autolock(v_ch);
  select * into b from core.bets where channel_id = v_ch and id = 1;

  -- Infos mit Pause (je Befehl für alle, „punkte“ je Zuschauer)
  if v_arg = '' or v_arg in ('top', 'rangliste', 'ranking', 'punkte', 'points', 'ich', 'me') then
    v_slot := case when v_arg in ('punkte', 'points', 'ich', 'me') then 'bet:me:' || p_user_id
                   when v_arg = '' then 'bet:info' else 'bet:top' end;
    if exists (select 1 from core.chat_cooldowns where channel_id = v_ch and slot = v_slot
               and at > now() - case when v_slot like 'bet:me:%' then interval '30 seconds' else interval '15 seconds' end) then
      return json_build_object('handled', true);
    end if;
    insert into core.chat_cooldowns (channel_id, slot, at) values (v_ch, v_slot, now()) on conflict (channel_id, slot) do update set at = now();
    if v_slot = 'bet:top' then
      select string_agg(format('%s. %s (%s)', rn, name, points), ' · ' order by rn) into v_top
        from (select name, points, row_number() over (order by points desc, wins desc, name) rn
                from core.bet_scores where channel_id = v_ch and points > 0 limit 5) x;
      return json_build_object('handled', true, 'reply', coalesce('🏆 Tipp-Rangliste: ' || v_top, '🏆 Noch keine Tipp-Punkte – bei der nächsten Wette mittippen!'));
    elsif v_slot like 'bet:me:%' then
      select * into v_me from core.bet_scores where channel_id = v_ch and player_key = v_key;
      return json_build_object('handled', true, 'reply', format('@%s %s Tipp-Punkte (%s von %s Tipps richtig).', v_name,
        coalesce(v_me.points, 0), coalesce(v_me.wins, 0), coalesce(v_me.tips, 0)));
    end if;
    return json_build_object('handled', true, 'reply', case
      when b.status = 'open' then left(format('🎯 %s – tippen mit !tipp %s', b.question,
        (select string_agg(format('%s (%s)', i, o), ' · ' order by i) from unnest(b.options) with ordinality as u(o, i))), 450)
      when b.status = 'locked' then format('🔒 Tipps geschlossen für „%s“ – gleich kommt die Auflösung.', b.question)
      else '🎯 Gerade läuft keine Wette. Punkte: !tipp punkte · Rangliste: !tipp top' end);
  end if;

  if b.status is distinct from 'open' then return json_build_object('handled', true); end if;
  -- „!tipp 2“ oder „!tipp nein“ (Text einer Antwort)
  n := case when v_arg ~ '^\d+$' then v_arg::int
            else (select i::int from unnest(b.options) with ordinality as u(o, i) where lower(o) = v_arg limit 1) end;
  r := public.bet_tip(v_key, v_name, n, 'chat');
  return json_build_object('handled', true);
end;
$$;
revoke execute on function public.fun_chat(text, text, text[], text) from public, anon, authenticated;

notify pgrst, 'reload schema';
