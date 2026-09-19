-- Social-Logins (Twitch, Discord, Google, Spotify, GitHub):
-- Benutzername aus den Daten des Anbieters übernehmen. Manche Anbieter liefern
-- keine E-Mail – dann gibt es trotzdem einen Namen statt eines Fehlers.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into public.profiles (id, username)
  values (
    new.id,
    left(coalesce(
      nullif(trim(meta ->> 'username'), ''),           -- E-Mail-Registrierung auf der Webseite
      nullif(trim(meta #>> '{custom_claims,global_name}'), ''), -- Discord-Anzeigename
      nullif(trim(meta ->> 'nickname'), ''),           -- Twitch
      nullif(trim(meta ->> 'preferred_username'), ''), -- GitHub, Twitch
      nullif(trim(meta ->> 'user_name'), ''),          -- GitHub
      nullif(trim(meta ->> 'full_name'), ''),          -- Google, Discord
      nullif(trim(meta ->> 'name'), ''),               -- Spotify, Google
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Zuschauer'
    ), 25)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
