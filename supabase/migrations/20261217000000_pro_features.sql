-- ============================================================
-- StreamHelp Pro: Abfrage, ob ein Kanal Pro hat
--   Pro-Ideen (js/pro.js: Stream-Dino, Cup, Herzfrequenz, Vorlesen lassen) sperrt das Dashboard für Kanäle
--   ohne Pro, sobald Pro gilt (PRO_ENFORCED). Dafür braucht es eine Abfrage, die auch Zuschauer stellen dürfen –
--   pro_status() ist nur fürs Team und nennt das Ablaufdatum.
--   1) public.channel_is_pro(kanal)  → true/false, nur Service-Rolle (für Edge Functions, z. B. Vorlesen und Bot)
--   2) public.channel_has_pro()      → true/false für den aktuellen Kanal (x-channel), für alle lesbar
-- Braucht 20261211000000_tips_sponsors_pro.sql. Mehrfach ausführbar.
-- ============================================================

do $$
begin
  if to_regclass('core.channel_plans') is null then
    raise exception 'Erst die Migration 20261211000000_tips_sponsors_pro.sql ausführen.';
  end if;
end;
$$;

create or replace function public.channel_is_pro(p_channel uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from core.channel_plans p where p.channel_id = p_channel and p.until > now());
$$;
revoke execute on function public.channel_is_pro(uuid) from public, anon, authenticated;

-- Nur ja/nein, ohne Ablaufdatum oder Notiz des Admins
create or replace function public.channel_has_pro()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.channel_is_pro(public.current_channel());
$$;
revoke execute on function public.channel_has_pro() from public;
grant execute on function public.channel_has_pro() to anon, authenticated;
