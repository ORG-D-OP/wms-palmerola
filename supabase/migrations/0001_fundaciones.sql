create type user_role as enum (
  'operador_recibo',
  'operador_picking',
  'montacargista',
  'supervisor',
  'inventarios',
  'admin',
  'solo_lectura'
);

create table profile (
  id uuid primary key references auth.users on delete cascade,
  full_name text not null check (length(trim(full_name)) between 1 and 120),
  employee_code text unique check (length(trim(employee_code)) between 1 and 30),
  role user_role not null default 'solo_lectura',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profile_updated_at before update on profile
for each row execute function set_updated_at();

create function handle_new_user() returns trigger
language plpgsql security definer set search_path = public, auth as $$
begin
  insert into profile (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.email));
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
for each row execute function handle_new_user();

-- security definer para que las politicas puedan leer profile sin recursion de RLS
create function current_role_name() returns user_role
language sql stable security definer set search_path = public as $$
  select role from profile where id = auth.uid() and is_active;
$$;

create function has_role(variadic roles user_role[]) returns boolean
language sql stable as $$
  select current_role_name() = any(roles);
$$;

create table audit_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_id uuid references auth.users on delete set null,
  table_name text not null,
  record_id text not null,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  old_value jsonb,
  new_value jsonb
);

create index audit_log_lookup on audit_log (table_name, record_id, occurred_at desc);

create function audit_changes() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into audit_log (actor_id, table_name, record_id, action, old_value, new_value)
  values (
    auth.uid(),
    tg_table_name,
    coalesce(new.id, old.id)::text,
    tg_op,
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    case when tg_op = 'DELETE' then null else to_jsonb(new) end
  );
  return coalesce(new, old);
end;
$$;

create trigger profile_audit after insert or update or delete on profile
for each row execute function audit_changes();

alter table profile enable row level security;
alter table audit_log enable row level security;

create policy profile_select_own on profile
for select to authenticated using (id = auth.uid() or has_role('supervisor', 'admin'));

create policy profile_write_admin on profile
for all to authenticated using (has_role('admin')) with check (has_role('admin'));

create policy audit_log_select on audit_log
for select to authenticated using (has_role('supervisor', 'admin'));

grant usage on schema public to authenticated;
grant select on profile to authenticated;
grant insert, update, delete on profile to authenticated;
grant select on audit_log to authenticated;
