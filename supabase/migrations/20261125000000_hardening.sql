-- Härtung nach dem Sicherheits-Audit (nach …_bot_more.sql einspielen). Ändert keine Daten.
--
-- 1) Bot-Einstellungen und Auto-Nachrichten: Die Policies prüften is_admin() – Admin des Kanals der
--    Anfrage –, nicht des Kanals der Zeile. Wer in einem Kanal Streamer oder Mod ist, hätte direkt in
--    core.bot_settings/core.bot_timers die Zeilen aller Kanäle lesen (Timer auch ändern und löschen)
--    können. Über die Sichten in public ging das nicht (die filtern auf den Kanal), aber die Policy
--    ist die letzte Grenze. Jetzt wie überall: is_admin_of(channel_id).
--    (tools/check-sql.mjs prüft das ab jetzt für jede neue Policy.)
--
-- 2) Bits-Quittungen: Jede Twitch-Transaktion zählte nur je Kanal einmal (Schlüssel channel_id +
--    transaction_id). Dieselbe Quittung ließ sich so in jedem anderen StreamHelp-Kanal noch einmal
--    einlösen – ein Sound gratis pro Kanal. Jetzt gilt jede Transaktions-ID plattformweit genau einmal.

-- ---------- 1) Policies an den Kanal der Zeile binden ----------
drop policy if exists "bot_settings: lesen für admins" on core.bot_settings;
create policy "bot_settings: lesen für admins" on core.bot_settings for select to authenticated
  using ((select public.is_admin_of(channel_id)));

drop policy if exists "bot_timers: lesen für admins" on core.bot_timers;
create policy "bot_timers: lesen für admins" on core.bot_timers for select to authenticated
  using ((select public.is_admin_of(channel_id)));
drop policy if exists "bot_timers: anlegen für admins" on core.bot_timers;
create policy "bot_timers: anlegen für admins" on core.bot_timers for insert to authenticated
  with check ((select public.is_admin_of(channel_id)));
drop policy if exists "bot_timers: ändern für admins" on core.bot_timers;
create policy "bot_timers: ändern für admins" on core.bot_timers for update to authenticated
  using ((select public.is_admin_of(channel_id))) with check ((select public.is_admin_of(channel_id)));
drop policy if exists "bot_timers: löschen für admins" on core.bot_timers;
create policy "bot_timers: löschen für admins" on core.bot_timers for delete to authenticated
  using ((select public.is_admin_of(channel_id)));

-- ---------- 2) Bits-Transaktionen plattformweit eindeutig ----------
-- Gibt es schon dieselbe Transaktion in zwei Kanälen (ausgenutzt oder Zufall), bleibt der Index weg
-- und die Prüfung in panel_sound_play übernimmt – die Migration bricht nicht ab.
do $$
begin
  if exists (select transaction_id from core.bits_transactions group by transaction_id having count(*) > 1) then
    raise notice 'bits_transactions: Transaktionen in mehreren Kanälen gefunden – kein eindeutiger Index, nur die Prüfung in panel_sound_play.';
  else
    create unique index if not exists bits_transactions_tx_unique on core.bits_transactions (transaction_id);
  end if;
end $$;

-- Wie in …_panel_bits_subs.sql, dazu: dieselbe Transaktions-ID aus einem anderen Kanal → {ok:false, reason:'receipt'}
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
    -- Schon in einem anderen Kanal eingelöst: dieselbe Quittung zählt nicht noch einmal
    if exists (select 1 from core.bits_transactions
               where transaction_id = left(p_paid, 100) and channel_id is distinct from public.current_channel()) then
      return json_build_object('ok', false, 'reason', 'receipt');
    end if;
    insert into public.bits_transactions (transaction_id, player_key, sku, bits, item)
      values (left(p_paid, 100), p_key, left(coalesce(p_sku, ''), 40), greatest(0, coalesce(p_bits, 0)),
              left(case when p_item = 'custom' then coalesce(p_label, '') else p_item end, 100))
      on conflict do nothing
      returning true into v_new;
    if v_new is null then
      -- Gleichzeitig in einem anderen Kanal eingelöst (eindeutiger Index) oder hier schon gezählt
      if exists (select 1 from core.bits_transactions
                 where transaction_id = left(p_paid, 100) and channel_id is distinct from public.current_channel()) then
        return json_build_object('ok', false, 'reason', 'receipt');
      end if;
      return json_build_object('ok', true, 'duplicate', true);
    end if;
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
