-- El proyecto se creo sin exponer tablas nuevas automaticamente, asi que service_role
-- tampoco tiene permisos. Se le da solo lo que necesitan los scripts de alta de usuarios:
-- asignar el perfil y el rol de alguien recien creado. Nada mas.
grant usage on schema public to service_role;
grant select, update on profile to service_role;
