-- Equatorial Slides • Supabase
-- Cole este arquivo inteiro em: Supabase > SQL Editor > New query > Run.

-- 1) Armazenamento: um documento por chave. A chave 'current' guarda o estado da apresentação;
--    'previous', 'official' e 'undo:*' guardam reunião anterior, apresentação oficial e restaurações.
create table if not exists public.kv (
  key        text primary key,
  value      jsonb       not null,
  version    bigint      not null default 1,   -- só é usado na chave 'current'
  updated_at timestamptz not null default now()
);

-- 2) Gravação atômica com controle de concorrência (compare-and-swap).
--    Só grava se a versão que o navegador leu ainda for a atual; senão devolve 'conflict' e o navegador tenta de novo.
create or replace function public.kv_commit(p_expected bigint, p_writes jsonb)
returns bigint
language plpgsql
security invoker
as $$
declare
  cur  bigint;
  newv bigint;
  k    text;
begin
  select version into cur from public.kv where key = 'current' for update;
  if cur is null then
    if p_expected <> 0 then raise exception 'conflict'; end if;
    newv := 1;
  else
    if cur <> p_expected then raise exception 'conflict'; end if;
    newv := cur + 1;
  end if;
  for k in select jsonb_object_keys(p_writes) loop
    if k = 'current' then
      insert into public.kv(key, value, version) values ('current', p_writes -> k, newv)
      on conflict (key) do update set value = excluded.value, version = newv, updated_at = now();
    else
      insert into public.kv(key, value) values (k, p_writes -> k)
      on conflict (key) do update set value = excluded.value, updated_at = now();
    end if;
  end loop;
  return newv;
end;
$$;

-- 3) Segurança: somente usuários autenticados (a conta única da equipe) leem e gravam.
alter table public.kv enable row level security;
drop policy if exists kv_equipe on public.kv;
create policy kv_equipe on public.kv for all to authenticated using (true) with check (true);
revoke all on public.kv from anon;
grant select, insert, update, delete on public.kv to authenticated;
grant execute on function public.kv_commit(bigint, jsonb) to authenticated;
revoke execute on function public.kv_commit(bigint, jsonb) from anon;

-- 4) Imagens e PDFs: bucket público para leitura (os nomes são hashes) e envio só para autenticados.
insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do update set public = true;

drop policy if exists media_leitura on storage.objects;
create policy media_leitura on storage.objects for select using (bucket_id = 'media');
drop policy if exists media_envio on storage.objects;
create policy media_envio on storage.objects for insert to authenticated with check (bucket_id = 'media');
