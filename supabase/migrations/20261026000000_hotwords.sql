-- ============================================================
-- StreamHelp: Hot Words (Content-Idee)
--   · Der Chat-Bot liest jede Chat-Nachricht mit (EventSub channel.chat.message); die
--     Edge Function twitch-eventsub zerlegt sie in Wörter (ohne Füllwörter wie „und“, „ich“,
--     ohne Befehle, Links und @Namen) und zählt sie über hotwords_note.
--   · Die (höchstens) 5 Wörter, die am häufigsten geschrieben wurden, stehen mit Zähler im
--     Stream (Overlay-Ebene „Hot Words“) und auf der Webseite.
--   · Gegen Spam: Dasselbe Wort zählt pro Zuschauer höchstens einmal pro Minute.
--   · Streamer und Mods können Wörter sperren (verschwinden sofort, zählen nie wieder),
--     neu anfangen (Zähler auf 0) und einstellen: an/aus, wie viele Wörter (1–5), Mindestlänge.
--   · hotwords (eine Zeile mit den Top-Wörtern) ist für alle lesbar (Overlay ohne Anmeldung);
--     die ganze Zählliste sehen Angemeldete, gesperrte Wörter nur Streamer und Mods.
-- Braucht 20261014000000_stream_extras.sql (tile_started, realtime_add). Mehrfach ausführbar.
-- ============================================================

-- ---------- Kachel ----------
alter table public.tiles drop constraint if exists tiles_kind_check;
alter table public.tiles add constraint tiles_kind_check
  check (kind in ('wheel', 'countdown', 'prank', 'bingo', 'questions', 'pet', 'shop', 'challenge',
                  'forbidden', 'subathon', 'pause', 'quiz', 'queue', 'tts', 'cards', 'giveaway', 'hotwords'));

do $$
begin
  if not exists (select 1 from public.tiles where id = 'hotwords') then
    update public.tiles set position = position + 1 where kind = 'countdown';
    insert into public.tiles (id, position, kind, title, description, theme) values
      ('hotwords', (select coalesce(max(position), 1) + 1 from public.tiles where kind <> 'countdown'), 'hotwords',
       'Hot Words', 'Was schreibt der Chat am meisten? Die fünf heißesten Wörter stehen live im Stream – mit Zähler.', 'hotwords');
  end if;
end;
$$;

-- ---------- Stand (eine Zeile, fürs Overlay) ----------
create table if not exists public.hotwords (
  id int primary key default 1 check (id = 1),
  enabled boolean not null default true,
  max_words int not null default 5 check (max_words between 1 and 5),
  min_length int not null default 3 check (min_length between 2 and 10),
  round int not null default 1,
  top jsonb not null default '[]'::jsonb,   -- [{"w": "Wort", "n": 12}, …] – höchstens max_words
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into public.hotwords (id) values (1) on conflict (id) do nothing;
alter table public.hotwords enable row level security;
drop policy if exists "hotwords: lesen für alle" on public.hotwords;
create policy "hotwords: lesen für alle" on public.hotwords for select to anon, authenticated using (true);
grant select on public.hotwords to anon, authenticated;
-- Schreiben nur über die Funktionen unten

-- Alle gezählten Wörter dieser Runde (Webseite: die Liste hinter den Top 5)
create table if not exists public.hotword_counts (
  word text primary key check (char_length(word) between 1 and 30),  -- klein geschrieben, zum Zählen
  label text not null check (char_length(label) between 1 and 30),   -- wie zuerst geschrieben (für die Anzeige)
  n int not null default 0,
  last_at timestamptz not null default now()
);
create index if not exists hotword_counts_n_idx on public.hotword_counts (n desc, last_at desc);
alter table public.hotword_counts enable row level security;
drop policy if exists "hotword_counts: lesen für angemeldete" on public.hotword_counts;
create policy "hotword_counts: lesen für angemeldete" on public.hotword_counts for select to authenticated using (true);
grant select on public.hotword_counts to authenticated;

-- Gesperrte Wörter (bleiben über alle Runden)
create table if not exists public.hotword_blocks (
  word text primary key check (char_length(word) between 1 and 30),
  created_at timestamptz not null default now()
);
alter table public.hotword_blocks enable row level security;
drop policy if exists "hotword_blocks: lesen nur admin" on public.hotword_blocks;
create policy "hotword_blocks: lesen nur admin" on public.hotword_blocks for select to authenticated using ((select public.is_admin()));
grant select on public.hotword_blocks to authenticated;

-- Wer hat welches Wort zuletzt gezählt bekommen? Nur für den Spam-Schutz, nicht lesbar.
create table if not exists public.hotword_hits (
  player text not null,
  word text not null,
  at timestamptz not null default now(),
  primary key (player, word)
);
alter table public.hotword_hits enable row level security;

-- ---------- Top-Wörter neu berechnen ----------
-- Schreibt hotwords.top nur, wenn sich etwas geändert hat (sonst kein Realtime-Event fürs Overlay)
create or replace function public.hotwords_refresh()
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_max int := coalesce((select max_words from public.hotwords where id = 1), 5);
  v_top jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('w', label, 'n', n) order by n desc, last_at desc), '[]'::jsonb) into v_top
    from (select label, n, last_at from public.hotword_counts where n > 0 order by n desc, last_at desc limit v_max) t;
  update public.hotwords set top = v_top, updated_at = now() where id = 1 and top is distinct from v_top;
end;
$$;
revoke execute on function public.hotwords_refresh() from public, anon, authenticated;

-- ---------- Zählen (nur die Edge Function, aus dem Twitch-Chat) ----------
-- p_player: Twitch-ID des Schreibers, p_words: die Wörter einer Nachricht (wie geschrieben)
create or replace function public.hotwords_note(p_player text, p_words text[])
returns void language plpgsql security definer set search_path = '' as $$
declare
  h public.hotwords;
  raw text;
  w text;
  v_label text;
  n int;
  changed boolean := false;
begin
  if coalesce(p_player, '') = '' or p_words is null then return; end if;
  select * into h from public.hotwords where id = 1;
  if not found or not h.enabled or not public.tile_started('hotwords') then return; end if;
  foreach raw in array p_words[1:12] loop
    v_label := left(btrim(coalesce(raw, '')), 30);
    w := lower(v_label);
    if char_length(w) < h.min_length or w !~ '[[:alpha:]]' then continue; end if;
    if exists (select 1 from public.hotword_blocks where word = w) then continue; end if;
    -- Spam-Schutz: pro Zuschauer und Wort höchstens einmal pro Minute
    insert into public.hotword_hits (player, word, at) values (left(p_player, 40), w, now())
      on conflict (player, word) do update set at = now() where public.hotword_hits.at < now() - interval '60 seconds';
    get diagnostics n = row_count;
    if n = 0 then continue; end if;
    insert into public.hotword_counts (word, label, n, last_at) values (w, v_label, 1, now())
      on conflict (word) do update set n = public.hotword_counts.n + 1, last_at = now();
    changed := true;
  end loop;
  if changed then perform public.hotwords_refresh(); end if;
  -- ab und zu aufräumen
  if random() < 0.02 then delete from public.hotword_hits where at < now() - interval '10 minutes'; end if;
end;
$$;
revoke execute on function public.hotwords_note(text, text[]) from public, anon, authenticated;

-- ---------- Steuern (Streamer, Admins, freigegebene Mods) ----------
create or replace function public.hotwords_settings(p_enabled boolean, p_max_words int, p_min_length int)
returns public.hotwords language plpgsql security definer set search_path = '' as $$
declare
  h public.hotwords;
begin
  if not public.is_admin() then raise exception 'Nur der Streamer und die Mods.'; end if;
  if p_max_words is not null and (p_max_words < 1 or p_max_words > 5) then raise exception 'Es können 1 bis 5 Wörter angezeigt werden.'; end if;
  if p_min_length is not null and (p_min_length < 2 or p_min_length > 10) then raise exception 'Die Mindestlänge kann 2 bis 10 Buchstaben sein.'; end if;
  update public.hotwords set
    enabled = coalesce(p_enabled, enabled),
    max_words = coalesce(p_max_words, max_words),
    min_length = coalesce(p_min_length, min_length),
    updated_at = now()
  where id = 1;
  perform public.hotwords_refresh();
  select * into h from public.hotwords where id = 1;
  return h;
end;
$$;
revoke execute on function public.hotwords_settings(boolean, int, int) from public, anon;
grant execute on function public.hotwords_settings(boolean, int, int) to authenticated;

-- Neu anfangen: alle Zähler auf 0
create or replace function public.hotwords_reset()
returns public.hotwords language plpgsql security definer set search_path = '' as $$
declare
  h public.hotwords;
begin
  if not public.is_admin() then raise exception 'Nur der Streamer und die Mods.'; end if;
  delete from public.hotword_counts where true;
  delete from public.hotword_hits where true;
  update public.hotwords set round = round + 1, top = '[]'::jsonb, started_at = now(), updated_at = now()
    where id = 1 returning * into h;
  return h;
end;
$$;
revoke execute on function public.hotwords_reset() from public, anon;
grant execute on function public.hotwords_reset() to authenticated;

-- Wort sperren (p_block = true: verschwindet und zählt nie wieder) oder wieder freigeben
create or replace function public.hotwords_block(p_word text, p_block boolean default true)
returns public.hotwords language plpgsql security definer set search_path = '' as $$
declare
  w text := lower(left(btrim(coalesce(p_word, '')), 30));
  h public.hotwords;
begin
  if not public.is_admin() then raise exception 'Sperren dürfen nur der Streamer und die Mods.'; end if;
  if w = '' then raise exception 'Kein Wort angegeben.'; end if;
  if coalesce(p_block, true) then
    insert into public.hotword_blocks (word) values (w) on conflict (word) do nothing;
    delete from public.hotword_counts where word = w;
  else
    delete from public.hotword_blocks where word = w;
  end if;
  perform public.hotwords_refresh();
  select * into h from public.hotwords where id = 1;
  return h;
end;
$$;
revoke execute on function public.hotwords_block(text, boolean) from public, anon;
grant execute on function public.hotwords_block(text, boolean) to authenticated;

-- Realtime nur für den Stand (enthält die Top-Wörter); die Webseite lädt die Liste dann neu
do $$ begin perform public.realtime_add('hotwords'); end $$;
