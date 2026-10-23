-- ============================================================
-- StreamHelp: Twitch-Erweiterung mit Bits und Abo-Extras
--   1) Sounds gegen Bits: Der Streamer schaltet es im Dialog „Ärgere den Streamer“ ein
--      (prank_settings.panel_bits) und wählt den Preis (panel_bits_sku – eines der Bits-Produkte der
--      Erweiterung: sound_50, sound_100, sound_250, sound_500). Ein bezahlter Sound läuft sofort, ohne
--      Wartezeit. Jede Twitch-Transaktion zählt genau einmal (core.bits_transactions).
--   2) Abonnenten: einzelne Sounds nur für Abonnenten (panel_sub_sounds – IDs wie im Panel: eingebauter
--      Sound „gong“ oder hochgeladener „c:<uuid>“) und eine eigene, kürzere Wartezeit (panel_sub_cooldown).
--      Ob jemand Abonnent ist, prüft die Edge Function twitch-ext bei Twitch (Helix), nie der Browser.
--   3) panel_sound_play bekommt p_sub (Abo-Wartezeit) und p_paid (Bits-Transaktion: ohne Wartezeit).
--      Nur twitch-ext ruft es auf (Service-Rolle).
-- Braucht 20261114000000_panel_sounds.sql. Mehrfach ausführbar.
-- ============================================================

do $$
begin
  if to_regclass('core.panel_sound_uses') is null then
    raise exception 'Erst die Migration 20261114000000_panel_sounds.sql ausführen.';
  end if;
end;
$$;

-- ---------- Einstellungen ----------
alter table core.prank_settings add column if not exists panel_sub_sounds text[] not null default '{}';
alter table core.prank_settings add column if not exists panel_sub_cooldown int not null default 30;
alter table core.prank_settings add column if not exists panel_bits boolean not null default false;
alter table core.prank_settings add column if not exists panel_bits_sku text not null default 'sound_100';
alter table core.prank_settings drop constraint if exists prank_settings_panel_sub_sounds_check;
alter table core.prank_settings add constraint prank_settings_panel_sub_sounds_check
  check (cardinality(panel_sub_sounds) <= 20
         and array_to_string(panel_sub_sounds, ',') ~ '^((c:[0-9a-f-]{36}|[a-z0-9_-]{1,24})(,(c:[0-9a-f-]{36}|[a-z0-9_-]{1,24}))*)?$');
alter table core.prank_settings drop constraint if exists prank_settings_panel_sub_cooldown_check;
alter table core.prank_settings add constraint prank_settings_panel_sub_cooldown_check check (panel_sub_cooldown between 0 and 3600);
alter table core.prank_settings drop constraint if exists prank_settings_panel_bits_sku_check;
alter table core.prank_settings add constraint prank_settings_panel_bits_sku_check
  check (panel_bits_sku in ('sound_50', 'sound_100', 'sound_250', 'sound_500'));
select public.channel_view('prank_settings');

-- ---------- Bits-Transaktionen (jede genau einmal; nur für die Edge Function) ----------
create table if not exists core.bits_transactions (
  channel_id uuid not null default public.current_channel() references public.channels on delete cascade,
  transaction_id text not null check (char_length(transaction_id) between 1 and 100),
  player_key text not null check (player_key ~ '^tw:\d{1,20}$'),
  sku text not null check (char_length(sku) <= 40),
  bits int not null check (bits between 0 and 1000000),
  item text not null default '' check (char_length(item) <= 100),
  created_at timestamptz not null default now(),
  primary key (channel_id, transaction_id)
);
alter table core.bits_transactions enable row level security;
revoke all on core.bits_transactions from anon, authenticated;
select public.channel_view('bits_transactions');
revoke all on public.bits_transactions from anon, authenticated;

-- ---------- Abspielen ----------
-- Wie in …_panel_sounds.sql, dazu:
--   p_sub  = true → Wartezeit je Zuschauer ist panel_sub_cooldown statt panel_sound_cooldown
--   p_paid = Transaktions-ID von Twitch (Bits) → ohne Wartezeit und ohne Abstand; dieselbe ID ein zweites
--            Mal ergibt {ok:true, duplicate:true} ohne zweiten Sound. Bezahlt ist bezahlt: läuft auch, wenn
--            der Streamer die Sounds inzwischen ausgeschaltet oder pausiert hat.
-- Antwort: {ok:true} | {ok:false, reason:'off'|'closed'|'cooldown'|'share'|'sound', wait:<Sekunden>}
drop function if exists public.panel_sound_play(text, text, text, text, text);
create or replace function public.panel_sound_play(p_key text, p_name text, p_item text, p_path text default null, p_label text default '',
                                                   p_sub boolean default false, p_paid text default null, p_sku text default null,
                                                   p_bits int default null)
returns json language plpgsql security definer set search_path = '' as $$
declare
  s public.prank_settings;
  v_last timestamptz;
  v_wait int;
  v_cool int;
  v_new boolean;
begin
  if coalesce(p_key, '') !~ '^tw:\d{1,20}$' then return json_build_object('ok', false, 'reason', 'share'); end if;
  if coalesce(p_item, '') !~ '^[a-z0-9_-]{1,24}$' then return json_build_object('ok', false, 'reason', 'sound'); end if;
  select * into s from public.prank_settings where id = 1 for update;

  if p_paid is not null then
    insert into public.bits_transactions (transaction_id, player_key, sku, bits, item)
      values (left(p_paid, 100), p_key, left(coalesce(p_sku, ''), 40), greatest(0, coalesce(p_bits, 0)),
              left(case when p_item = 'custom' then coalesce(p_label, '') else p_item end, 100))
      on conflict (channel_id, transaction_id) do nothing
      returning true into v_new;
    if v_new is null then return json_build_object('ok', true, 'duplicate', true); end if;
  else
    if s.id is null or not s.panel_sounds then return json_build_object('ok', false, 'reason', 'off'); end if;
    if public.viewer_paused() or not public.tile_started('prank') then return json_build_object('ok', false, 'reason', 'closed'); end if;

    -- Ganzer Kanal: Mindestabstand zum letzten Panel-Sound
    select max(last_at) into v_last from public.panel_sound_uses;
    if v_last is not null and v_last > now() - make_interval(secs => s.panel_sound_gap) then
      v_wait := ceil(extract(epoch from v_last + make_interval(secs => s.panel_sound_gap) - now()))::int;
      return json_build_object('ok', false, 'reason', 'cooldown', 'wait', greatest(v_wait, 1));
    end if;
    -- Dieser Zuschauer: eigene Abklingzeit (Abonnenten: die kürzere)
    v_cool := case when coalesce(p_sub, false) then s.panel_sub_cooldown else s.panel_sound_cooldown end;
    select last_at into v_last from public.panel_sound_uses where player_key = p_key;
    if v_cool > 0 and v_last is not null and v_last > now() - make_interval(secs => v_cool) then
      v_wait := ceil(extract(epoch from v_last + make_interval(secs => v_cool) - now()))::int;
      return json_build_object('ok', false, 'reason', 'cooldown', 'wait', greatest(v_wait, 1));
    end if;
    insert into public.panel_sound_uses (player_key, last_at) values (p_key, now())
      on conflict (channel_id, player_key) do update set last_at = excluded.last_at;
  end if;

  insert into public.pranks (kind, item, sound_path, label, requested_by)
    values ('sound', p_item, case when p_item = 'custom' then p_path end,
            case when p_item = 'custom' then left(coalesce(p_label, ''), 60) else '' end,
            left(coalesce(nullif(btrim(p_name), ''), 'Zuschauer'), 40));
  -- Aufräumen wie beim Kanalpunkte-Weg
  delete from public.pranks where created_at < now() - interval '2 days';
  delete from public.panel_sound_uses where last_at < now() - interval '1 day';
  -- Bits-Belege: 13 Monate (Rückfragen zu Zahlungen), danach weg
  if random() < 0.02 then delete from public.bits_transactions where created_at < now() - interval '13 months'; end if;
  return json_build_object('ok', true);
end;
$$;
revoke execute on function public.panel_sound_play(text, text, text, text, text, boolean, text, text, int) from public, anon, authenticated;
grant execute on function public.panel_sound_play(text, text, text, text, text, boolean, text, text, int) to service_role;

notify pgrst, 'reload schema';
