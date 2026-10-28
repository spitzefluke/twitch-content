-- ============================================================
-- StreamHelp: Markenfarbe fürs öffentliche Profil (nach …_artists.sql einspielen)
--   Die Farbe kommt aus dem Look-Baukasten bzw. „Farben aus dem Logo“ (js/brand-colors.js – das Logo
--   selbst wird nicht hochgeladen). Overlay und Alerts speichern ihre Farbe wie bisher (overlay_config,
--   alert_config); hier nur die Farbe für profil.html.
-- Mehrfach ausführbar.
-- ============================================================

alter table core.channel_profile add column if not exists accent text;
alter table core.channel_profile drop constraint if exists channel_profile_accent_check;
alter table core.channel_profile add constraint channel_profile_accent_check check (accent is null or accent ~ '^#[0-9a-f]{6}$');

-- Streamer, Admins und freigegebene Mods; null = Standardfarbe
create or replace function public.profile_accent_save(p_accent text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
  v_accent text := nullif(lower(btrim(coalesce(p_accent, ''))), '');
begin
  if v_ch is null or not public.is_admin_of(v_ch) then raise exception 'Das ist gerade nicht erlaubt.' using errcode = '42501'; end if;
  if v_accent is not null and v_accent !~ '^#[0-9a-f]{6}$' then raise exception 'Bitte eine Farbe wie #9146ff.'; end if;
  insert into core.channel_profile (channel_id, accent) values (v_ch, v_accent)
    on conflict (channel_id) do update set accent = excluded.accent, updated_at = now();
  return v_accent;
end;
$$;
revoke execute on function public.profile_accent_save(text) from public, anon;
grant execute on function public.profile_accent_save(text) to authenticated;

-- profile_get und public_profile wie in …_profile_schedule.sql, dazu die Farbe
create or replace function public.profile_get()
returns json language plpgsql stable security definer set search_path = '' as $$
declare
  v_ch uuid := public.current_channel();
begin
  if not public.is_admin_of(v_ch) then raise exception 'Das ist gerade nicht erlaubt.'; end if;
  return (
    select json_build_object(
      'login', c.login, 'display_name', c.display_name, 'can_publish', public.is_owner_of(v_ch),
      'is_public', coalesce(cp.is_public, false), 'bio', coalesce(cp.bio, ''), 'links', coalesce(cp.links, '[]'::jsonb),
      'tz', coalesce(cp.tz, 'Europe/Berlin'), 'away_until', cp.away_until, 'away_note', coalesce(cp.away_note, ''),
      'accent', cp.accent,
      'slots', coalesce((select json_agg(json_build_object('weekday', s.weekday, 'start', to_char(s.start_time, 'HH24:MI'),
                          'minutes', s.minutes, 'title', s.title, 'game', s.game) order by s.weekday, s.start_time)
                         from core.stream_schedule s where s.channel_id = v_ch), '[]'::json),
      'upcoming', public.schedule_upcoming(v_ch, 6))
    from public.channels c left join core.channel_profile cp on cp.channel_id = c.id
    where c.id = v_ch
  );
end;
$$;
revoke execute on function public.profile_get() from public, anon;
grant execute on function public.profile_get() to authenticated;

create or replace function public.public_profile(p_login text)
returns json language sql stable security definer set search_path = '' as $$
  select json_build_object(
    'login', c.login, 'display_name', c.display_name, 'avatar_url', c.avatar_url,
    'live', coalesce(g.live_at > now() - interval '15 minutes', false),
    'category', case when g.live_at > now() - interval '15 minutes' then left(coalesce(g.live_category, ''), 60) else '' end,
    'bio', cp.bio, 'links', cp.links, 'tz', cp.tz, 'accent', cp.accent,
    'away_until', case when cp.away_until >= (now() at time zone cp.tz)::date then cp.away_until end,
    'away_note', case when cp.away_until >= (now() at time zone cp.tz)::date then cp.away_note else '' end,
    'slots', coalesce((select json_agg(json_build_object('weekday', s.weekday, 'start', to_char(s.start_time, 'HH24:MI'),
                        'minutes', s.minutes, 'title', s.title, 'game', s.game) order by s.weekday, s.start_time)
                       from core.stream_schedule s where s.channel_id = c.id), '[]'::json),
    'upcoming', public.schedule_upcoming(c.id, 8))
  from public.channels c
  join core.channel_profile cp on cp.channel_id = c.id and cp.is_public
  left join core.stream_games g on g.channel_id = c.id and g.id = 1
  where c.status = 'active' and c.login = lower(btrim(coalesce(p_login, '')))
  limit 1;
$$;
grant execute on function public.public_profile(text) to anon, authenticated;

notify pgrst, 'reload schema';
