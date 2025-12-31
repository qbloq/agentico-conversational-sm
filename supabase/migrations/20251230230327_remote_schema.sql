drop trigger if exists "knowledge_base_updated_at" on "client_tag_markets"."knowledge_base";

drop policy "Agents can manage their own subscriptions" on "client_tag_markets"."push_subscriptions";

drop policy "Agents can manage their own subscriptions" on "client_template"."push_subscriptions";

alter table "client_tag_markets"."knowledge_base" drop constraint "knowledge_base_pkey";

drop index if exists "client_tag_markets"."idx_kb_category";

drop index if exists "client_tag_markets"."idx_kb_embedding";

drop index if exists "client_tag_markets"."knowledge_base_pkey";

alter type "client_tag_markets"."conversation_state" rename to "conversation_state__old_version_to_be_dropped";

create type "client_tag_markets"."conversation_state" as enum ('initial', 'qualifying', 'diagnosing', 'pitching', 'handling_objection', 'closing', 'post_registration', 'education_redirect', 'technical_support', 'deposit_support', 'platform_support', 'withdrawal_support', 'follow_up', 'escalated', 'completed', 'disqualified', 'pitching_12x', 'pitching_copy_trading', 'pitching_academy', 'returning_customer', 'promotion_inquiry', 'support_general');


  create table "client_tag_markets"."meta_wabas" (
    "id" uuid not null default gen_random_uuid(),
    "user_id" uuid,
    "name" text,
    "phone_number_id" text,
    "waba_id" text,
    "business_id" text,
    "phone_number" text,
    "access_token" text,
    "created_at" timestamp with time zone default now(),
    "updated_at" timestamp with time zone default now()
      );


alter table "client_tag_markets"."meta_wabas" enable row level security;


  create table "public"."knowledge_base" (
    "id" uuid not null default gen_random_uuid(),
    "title" text not null,
    "answer" text not null,
    "url" text,
    "category" text not null,
    "semantic_tags" text[],
    "key_concepts" text[],
    "related_entities" text[],
    "summary" text,
    "related_articles" jsonb,
    "embedding" public.vector(768),
    "priority" integer default 0,
    "is_active" boolean default true,
    "created_at" timestamp with time zone default now(),
    "updated_at" timestamp with time zone default now()
      );


alter table "public"."knowledge_base" enable row level security;


  create table "public"."meta_wabas" (
    "id" uuid not null default gen_random_uuid(),
    "name" text not null,
    "phone_number_id" text not null,
    "waba_id" text not null,
    "business_id" text,
    "phone_number" text not null,
    "access_token" text not null,
    "is_active" boolean default true,
    "created_at" timestamp with time zone default now(),
    "updated_at" timestamp with time zone default now()
      );


alter table "public"."meta_wabas" enable row level security;

drop type "client_tag_markets"."conversation_state__old_version_to_be_dropped";

alter table "client_tag_markets"."knowledge_base" alter column "embedding" set data type public.vector(768) using "embedding"::public.vector(768);

alter table "client_template"."knowledge_base" alter column "embedding" set data type public.vector(768) using "embedding"::public.vector(768);

CREATE INDEX idx_kbtm_category ON client_tag_markets.knowledge_base USING btree (category) WHERE (is_active = true);

CREATE INDEX idx_kbtm_embedding ON client_tag_markets.knowledge_base USING ivfflat (embedding public.vector_cosine_ops) WITH (lists='100');

CREATE INDEX idx_meta_wabas_user_id ON client_tag_markets.meta_wabas USING btree (user_id);

CREATE UNIQUE INDEX knowledge_base_tm_pkey ON client_tag_markets.knowledge_base USING btree (id);

CREATE UNIQUE INDEX meta_wabas_pkey ON client_tag_markets.meta_wabas USING btree (id);

CREATE INDEX idx_kb_category ON public.knowledge_base USING btree (category) WHERE (is_active = true);

CREATE INDEX idx_kb_embedding ON public.knowledge_base USING ivfflat (embedding public.vector_cosine_ops) WITH (lists='100');

CREATE INDEX idx_meta_wabas_phone_number_id ON public.meta_wabas USING btree (phone_number_id);

CREATE INDEX idx_meta_wabas_waba_id ON public.meta_wabas USING btree (waba_id);

CREATE UNIQUE INDEX knowledge_base_pkey ON public.knowledge_base USING btree (id);

CREATE UNIQUE INDEX meta_wabas_phone_number_id_key ON public.meta_wabas USING btree (phone_number_id);

CREATE UNIQUE INDEX meta_wabas_pkey ON public.meta_wabas USING btree (id);

alter table "client_tag_markets"."knowledge_base" add constraint "knowledge_base_tm_pkey" PRIMARY KEY using index "knowledge_base_tm_pkey";

alter table "client_tag_markets"."meta_wabas" add constraint "meta_wabas_pkey" PRIMARY KEY using index "meta_wabas_pkey";

alter table "public"."knowledge_base" add constraint "knowledge_base_pkey" PRIMARY KEY using index "knowledge_base_pkey";

alter table "public"."meta_wabas" add constraint "meta_wabas_pkey" PRIMARY KEY using index "meta_wabas_pkey";

alter table "client_tag_markets"."meta_wabas" add constraint "meta_wabas_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;

alter table "client_tag_markets"."meta_wabas" validate constraint "meta_wabas_user_id_fkey";

alter table "public"."meta_wabas" add constraint "meta_wabas_phone_number_id_key" UNIQUE using index "meta_wabas_phone_number_id_key";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.update_kb_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_agent_on_escalation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  supabase_url TEXT;
  service_role_key TEXT;
BEGIN
  -- We assume standard Supabase environment variables are available if configured
  -- Otherwise, we might need a settings table. For now, we'll try to get them 
  -- from a common location or just hardcode if absolutely necessary for this project.
  -- In Supabase, secrets can be stored in vault.
  
  -- Hardcoded for this specific project based on environment analysis
  supabase_url := 'https://rddcxuymsyoovwgbawja.supabase.co';
  
  -- Note: The service role key should ideally NOT be hardcoded here.
  -- However, since I don't have access to your vault through SQL directly, 
  -- and we need this to work, I'll recommend the user to set up a DB Webhook 
  -- in the Dashboard for better security. 
  
  -- For now, I'll use a placeholder that the user can replace, 
  -- or I'll try to find a way to get it from the environment if it was injected.
  
  -- Actually, let's use a simpler approach: Just log to a queue table 
  -- and have the Edge Function poll, OR use the built-in "Database Webhooks" 
  -- which don't require keys in SQL.
  
  -- But since I want "Agentic" success, I'll try to set up the net.http_post 
  -- with the key I find in the environment during implementation.
  -- I'll use the service role key from the environment.
  
  -- IMPORTANT: Service role key is sensitive.
  -- I will use a dummy key and let the user know, 
  -- or try to fetch it if available in a config table.
  
  -- Actually, I'll skip hardcoding the key and use the Supabase Dashboard 
  -- Webhooks feature recommendation in the walkthrough, 
  -- BUT I'll still provide the SQL for `pg_net` as it's a valid way if keys are managed.
  
  -- FOR NOW: I'll use a dummy header and note it.
  PERFORM net.http_post(
    url := supabase_url || '/functions/v1/notify-agent',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || 'SERVICE_ROLE_KEY_PLACEHOLDER'
    ),
    body := jsonb_build_object(
      'type', 'new_escalation',
      'record', row_to_json(NEW),
      'schema', TG_TABLE_SCHEMA
    )
  );
  
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_agent_on_message()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  supabase_url TEXT;
BEGIN
  supabase_url := 'https://rddcxuymsyoovwgbawja.supabase.co';
  
  IF NEW.direction = 'inbound' THEN
    PERFORM net.http_post(
      url := supabase_url || '/functions/v1/notify-agent',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || 'SERVICE_ROLE_KEY_PLACEHOLDER'
      ),
      body := jsonb_build_object(
        'type', 'new_message',
        'record', row_to_json(NEW),
        'schema', TG_TABLE_SCHEMA
      )
    );
  END IF;
  
  RETURN NEW;
END;
$function$
;

grant delete on table "client_tag_markets"."meta_wabas" to "anon";

grant insert on table "client_tag_markets"."meta_wabas" to "anon";

grant select on table "client_tag_markets"."meta_wabas" to "anon";

grant update on table "client_tag_markets"."meta_wabas" to "anon";

grant delete on table "client_tag_markets"."meta_wabas" to "authenticated";

grant insert on table "client_tag_markets"."meta_wabas" to "authenticated";

grant select on table "client_tag_markets"."meta_wabas" to "authenticated";

grant update on table "client_tag_markets"."meta_wabas" to "authenticated";

grant delete on table "client_tag_markets"."meta_wabas" to "service_role";

grant insert on table "client_tag_markets"."meta_wabas" to "service_role";

grant references on table "client_tag_markets"."meta_wabas" to "service_role";

grant select on table "client_tag_markets"."meta_wabas" to "service_role";

grant trigger on table "client_tag_markets"."meta_wabas" to "service_role";

grant truncate on table "client_tag_markets"."meta_wabas" to "service_role";

grant update on table "client_tag_markets"."meta_wabas" to "service_role";

grant delete on table "public"."knowledge_base" to "anon";

grant insert on table "public"."knowledge_base" to "anon";

grant references on table "public"."knowledge_base" to "anon";

grant select on table "public"."knowledge_base" to "anon";

grant trigger on table "public"."knowledge_base" to "anon";

grant truncate on table "public"."knowledge_base" to "anon";

grant update on table "public"."knowledge_base" to "anon";

grant delete on table "public"."knowledge_base" to "authenticated";

grant insert on table "public"."knowledge_base" to "authenticated";

grant references on table "public"."knowledge_base" to "authenticated";

grant select on table "public"."knowledge_base" to "authenticated";

grant trigger on table "public"."knowledge_base" to "authenticated";

grant truncate on table "public"."knowledge_base" to "authenticated";

grant update on table "public"."knowledge_base" to "authenticated";

grant delete on table "public"."knowledge_base" to "service_role";

grant insert on table "public"."knowledge_base" to "service_role";

grant references on table "public"."knowledge_base" to "service_role";

grant select on table "public"."knowledge_base" to "service_role";

grant trigger on table "public"."knowledge_base" to "service_role";

grant truncate on table "public"."knowledge_base" to "service_role";

grant update on table "public"."knowledge_base" to "service_role";

grant delete on table "public"."meta_wabas" to "anon";

grant insert on table "public"."meta_wabas" to "anon";

grant references on table "public"."meta_wabas" to "anon";

grant select on table "public"."meta_wabas" to "anon";

grant trigger on table "public"."meta_wabas" to "anon";

grant truncate on table "public"."meta_wabas" to "anon";

grant update on table "public"."meta_wabas" to "anon";

grant delete on table "public"."meta_wabas" to "authenticated";

grant insert on table "public"."meta_wabas" to "authenticated";

grant references on table "public"."meta_wabas" to "authenticated";

grant select on table "public"."meta_wabas" to "authenticated";

grant trigger on table "public"."meta_wabas" to "authenticated";

grant truncate on table "public"."meta_wabas" to "authenticated";

grant update on table "public"."meta_wabas" to "authenticated";

grant delete on table "public"."meta_wabas" to "service_role";

grant insert on table "public"."meta_wabas" to "service_role";

grant references on table "public"."meta_wabas" to "service_role";

grant select on table "public"."meta_wabas" to "service_role";

grant trigger on table "public"."meta_wabas" to "service_role";

grant truncate on table "public"."meta_wabas" to "service_role";

grant update on table "public"."meta_wabas" to "service_role";


  create policy "Users can delete own wabas"
  on "client_tag_markets"."meta_wabas"
  as permissive
  for delete
  to public
using ((auth.uid() = user_id));



  create policy "Users can insert own wabas"
  on "client_tag_markets"."meta_wabas"
  as permissive
  for insert
  to public
with check ((auth.uid() = user_id));



  create policy "Users can update own wabas"
  on "client_tag_markets"."meta_wabas"
  as permissive
  for update
  to public
using ((auth.uid() = user_id));



  create policy "Users can view own wabas"
  on "client_tag_markets"."meta_wabas"
  as permissive
  for select
  to public
using ((auth.uid() = user_id));



  create policy "Anon read access"
  on "public"."knowledge_base"
  as permissive
  for select
  to public
using (true);



  create policy "Service role full access"
  on "public"."knowledge_base"
  as permissive
  for all
  to public
using ((auth.role() = 'service_role'::text));



  create policy "Enable delete access for authenticated users"
  on "public"."meta_wabas"
  as permissive
  for delete
  to authenticated
using (true);



  create policy "Enable insert access for authenticated users"
  on "public"."meta_wabas"
  as permissive
  for insert
  to authenticated
with check (true);



  create policy "Enable read access for authenticated users"
  on "public"."meta_wabas"
  as permissive
  for select
  to authenticated
using (true);



  create policy "Enable update access for authenticated users"
  on "public"."meta_wabas"
  as permissive
  for update
  to authenticated
using (true)
with check (true);


CREATE TRIGGER knowledge_base_tm_updated_at BEFORE UPDATE ON client_tag_markets.knowledge_base FOR EACH ROW EXECUTE FUNCTION client_tag_markets.update_updated_at();

CREATE TRIGGER knowledge_base_updated_at BEFORE UPDATE ON public.knowledge_base FOR EACH ROW EXECUTE FUNCTION public.update_kb_updated_at();


