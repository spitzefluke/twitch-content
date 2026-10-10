-- ============================================================
-- StreamHelp: Kontaktformular und Streamer-Showcase
--   · public.contact_messages: Nachrichten aus dem Kontaktformular der Startseite. Absenden geht ohne
--     Anmeldung (contact_send), lesen und bearbeiten nur der Admin-Bereich (Edge Function admin).
--     Schutz: Fangfeld für Bots, höchstens 3 Nachrichten pro Stunde je Konto/IP, 300 pro Tag gesamt.
--   · channels.showcase: Der Streamer entscheidet, ob sein Kanal auf der Startseite unter
--     „Diese Streamer nutzen StreamHelp“ steht (mit Live-Anzeige). Standard: aus.
-- Braucht 20261028000000_platform.sql und 20261031000000_security.sql (rate_hit). Mehrfach ausführbar.
-- ============================================================

do $$
begin
  if to_regclass('public.channels') is null then
    raise exception 'Erst die Plattform-Migration 20261028000000_platform.sql ausführen.';
  end if;
  if to_regprocedure('public.rate_hit(text, integer, integer)') is null then
    raise exception 'Erst die Sicherheits-Migration 20261031000000_security.sql ausführen.';
  end if;
end;
$$;

-- ---------- Kontaktformular ----------
create table if not exists public.contact_messages (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  name text not null default '' check (char_length(name) <= 60),
  email text not null default '' check (char_length(email) <= 120),
  topic text not null default 'question' check (topic in ('question', 'bug', 'idea', 'channel', 'privacy', 'other')),
  message text not null check (char_length(message) between 10 and 2000),
  lang text not null default 'de' check (lang ~ '^[a-z]{2}$'),
  channel text not null default '' check (char_length(channel) <= 40),   -- Kanal, von dem aus geschrieben wurde
  user_id uuid references auth.users on delete set null,
  status text not null default 'new' check (status in ('new', 'done')),
  done_at timestamptz
);
create index if not exists contact_messages_created_idx on public.contact_messages (created_at desc);
alter table public.contact_messages enable row level security;
revoke all on public.contact_messages from anon, authenticated;

-- Nachricht senden. p_website ist das Fangfeld: Füllen es Bots aus, tut die Funktion so, als hätte es
-- geklappt, speichert aber nichts.
create or replace function public.contact_send(p_name text, p_email text, p_topic text, p_message text,
                                               p_lang text default 'de', p_website text default '')
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  h json;
  who text := auth.uid()::text;
  v_msg text := btrim(coalesce(p_message, ''));
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if coalesce(p_website, '') <> '' then return true; end if;
  if char_length(v_msg) < 10 then raise exception 'Bitte schreib etwas mehr (mindestens 10 Zeichen).'; end if;
  if char_length(v_msg) > 2000 then raise exception 'Die Nachricht ist zu lang (höchstens 2000 Zeichen).'; end if;
  if v_email <> '' and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Diese E-Mail-Adresse ist ungültig.'; end if;
  if who is null then
    begin
      h := nullif(current_setting('request.headers', true), '')::json;
    exception when others then
      h := null;
    end;
    who := 'ip:' || coalesce(nullif(btrim(coalesce(h ->> 'cf-connecting-ip', h ->> 'x-real-ip',
                                                    split_part(coalesce(h ->> 'x-forwarded-for', ''), ',', 1))), ''), 'unbekannt');
  end if;
  if not public.rate_hit('contact:' || who, 3, 3600) or not public.rate_hit('contact:all', 300, 86400) then
    raise exception 'Du hast gerade schon geschrieben – bitte später noch einmal.';
  end if;
  insert into public.contact_messages (name, email, topic, message, lang, channel, user_id)
  values (left(btrim(coalesce(p_name, '')), 60), left(v_email, 120),
          case when p_topic in ('question', 'bug', 'idea', 'channel', 'privacy', 'other') then p_topic else 'other' end,
          v_msg, case when coalesce(p_lang, '') ~ '^[a-z]{2}$' then p_lang else 'de' end,
          coalesce((select coalesce(login, '') from public.channels where id = public.current_channel()), ''),
          auth.uid());
  return true;
end;
$$;
revoke execute on function public.contact_send(text, text, text, text, text, text) from public;
grant execute on function public.contact_send(text, text, text, text, text, text) to anon, authenticated;

-- ---------- Streamer-Showcase ----------
alter table public.channels add column if not exists showcase boolean not null default false;

-- Startseite: Kanäle, deren Streamer zugestimmt haben – live zuerst
create or replace function public.showcase_list()
returns json language sql stable security definer set search_path = '' as $$
  select coalesce(json_agg(x order by x.live desc, lower(x.display_name)), '[]'::json) from (
    select c.login, c.display_name, c.avatar_url,
      coalesce(g.live_at > now() - interval '15 minutes', false) as live,
      case when g.live_at > now() - interval '15 minutes' then left(coalesce(g.live_category, ''), 60) else '' end as category
    from public.channels c
    left join core.stream_games g on g.channel_id = c.id and g.id = 1
    where c.status = 'active' and c.showcase and c.login is not null
    limit 48
  ) x;
$$;
grant execute on function public.showcase_list() to anon, authenticated;

-- Streamer: eigenen Kanal zeigen oder verstecken
create or replace function public.channel_showcase_set(p_on boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
begin
  if not public.is_owner_of(v_ch) then
    raise exception 'Das entscheidet nur der Streamer.';
  end if;
  update public.channels set showcase = coalesce(p_on, false) where id = v_ch;
  return coalesce(p_on, false);
end;
$$;
revoke execute on function public.channel_showcase_set(boolean) from public, anon;
grant execute on function public.channel_showcase_set(boolean) to authenticated;

-- Steht mein Kanal im Showcase?
create or replace function public.channel_showcase()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select showcase from public.channels where id = public.current_channel()), false);
$$;
grant execute on function public.channel_showcase() to authenticated;

notify pgrst, 'reload schema';
