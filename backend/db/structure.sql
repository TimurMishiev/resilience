SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: ar_internal_metadata; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ar_internal_metadata (
    key character varying NOT NULL,
    value character varying,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: areas_of_operation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.areas_of_operation (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    description text,
    threat_level text DEFAULT 'green'::text NOT NULL,
    color text DEFAULT '#23d160'::text NOT NULL,
    geometry jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by_id uuid NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    CONSTRAINT areas_of_operation_threat_level_check CHECK ((threat_level = ANY (ARRAY['green'::text, 'amber'::text, 'red'::text, 'black'::text])))
);


--
-- Name: assets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    asset_type text NOT NULL,
    status text DEFAULT 'available'::text NOT NULL,
    home_site_id uuid,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: audit_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    schema_version integer DEFAULT 1 NOT NULL,
    actor text NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,
    event_type text NOT NULL,
    action text,
    before_snapshot jsonb,
    after_snapshot jsonb NOT NULL,
    metadata jsonb,
    correlation_id uuid NOT NULL,
    occurred_at timestamp(6) without time zone DEFAULT now() NOT NULL
);


--
-- Name: correlation_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.correlation_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    description text,
    is_active boolean DEFAULT true NOT NULL,
    conditions jsonb DEFAULT '{}'::jsonb NOT NULL,
    actions jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by_id uuid NOT NULL,
    cooldown_minutes integer DEFAULT 60 NOT NULL,
    last_fired_at timestamp(6) without time zone,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    area_of_operation_id uuid
);


--
-- Name: external_signals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.external_signals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source text NOT NULL,
    signal_type text NOT NULL,
    external_id text NOT NULL,
    lat numeric(9,6) NOT NULL,
    lng numeric(9,6) NOT NULL,
    altitude numeric(10,2),
    speed numeric(8,2),
    heading numeric(6,2),
    magnitude numeric(5,2),
    raw_payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    occurred_at timestamp(6) without time zone NOT NULL,
    ingested_at timestamp(6) without time zone DEFAULT now() NOT NULL,
    CONSTRAINT signals_signal_type_check CHECK ((signal_type = ANY (ARRAY['aircraft_position'::text, 'vessel_position'::text, 'seismic_event'::text, 'gps_jamming'::text, 'wildfire'::text, 'manual'::text]))),
    CONSTRAINT signals_source_check CHECK ((source = ANY (ARRAY['opensky'::text, 'ais'::text, 'usgs_seismic'::text, 'gpsjam'::text, 'firms_wildfire'::text, 'manual'::text])))
);


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    version character varying NOT NULL
);


--
-- Name: signal_rule_matches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.signal_rule_matches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    signal_id uuid NOT NULL,
    correlation_rule_id uuid NOT NULL,
    site_id uuid,
    task_id uuid,
    fired_at timestamp(6) without time zone DEFAULT now() NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: sites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sites (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    latitude numeric(9,6) NOT NULL,
    longitude numeric(9,6) NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    area_of_operation_id uuid
);


--
-- Name: tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    site_id uuid NOT NULL,
    asset_id uuid,
    title text NOT NULL,
    description text,
    priority text DEFAULT 'normal'::text NOT NULL,
    workflow_status text DEFAULT 'new'::text NOT NULL,
    blocked_reason text,
    resolved_at timestamp(6) without time zone,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    CONSTRAINT blocked_reason_consistency CHECK ((((workflow_status = 'blocked'::text) AND (blocked_reason IS NOT NULL)) OR ((workflow_status <> 'blocked'::text) AND (blocked_reason IS NULL))))
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email character varying NOT NULL,
    password_digest character varying NOT NULL,
    role character varying DEFAULT 'operator'::character varying NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    CONSTRAINT users_role_check CHECK (((role)::text = ANY ((ARRAY['operator'::character varying, 'commander'::character varying])::text[])))
);


--
-- Name: ar_internal_metadata ar_internal_metadata_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ar_internal_metadata
    ADD CONSTRAINT ar_internal_metadata_pkey PRIMARY KEY (key);


--
-- Name: areas_of_operation areas_of_operation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.areas_of_operation
    ADD CONSTRAINT areas_of_operation_pkey PRIMARY KEY (id);


--
-- Name: assets assets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assets
    ADD CONSTRAINT assets_pkey PRIMARY KEY (id);


--
-- Name: audit_events audit_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT audit_events_pkey PRIMARY KEY (id);


--
-- Name: correlation_rules correlation_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.correlation_rules
    ADD CONSTRAINT correlation_rules_pkey PRIMARY KEY (id);


--
-- Name: external_signals external_signals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_signals
    ADD CONSTRAINT external_signals_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: signal_rule_matches signal_rule_matches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signal_rule_matches
    ADD CONSTRAINT signal_rule_matches_pkey PRIMARY KEY (id);


--
-- Name: sites sites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sites
    ADD CONSTRAINT sites_pkey PRIMARY KEY (id);


--
-- Name: tasks tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: idx_on_entity_type_entity_id_occurred_at_dfd7f189aa; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_on_entity_type_entity_id_occurred_at_dfd7f189aa ON public.audit_events USING btree (entity_type, entity_id, occurred_at);


--
-- Name: index_ao_on_threat_level; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_ao_on_threat_level ON public.areas_of_operation USING btree (threat_level);


--
-- Name: index_areas_of_operation_on_created_by_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_areas_of_operation_on_created_by_id ON public.areas_of_operation USING btree (created_by_id);


--
-- Name: index_assets_on_home_site_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_assets_on_home_site_id ON public.assets USING btree (home_site_id);


--
-- Name: index_audit_events_on_correlation_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_audit_events_on_correlation_id ON public.audit_events USING btree (correlation_id);


--
-- Name: index_audit_events_on_occurred_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_audit_events_on_occurred_at ON public.audit_events USING btree (occurred_at);


--
-- Name: index_correlation_rules_on_area_of_operation_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_correlation_rules_on_area_of_operation_id ON public.correlation_rules USING btree (area_of_operation_id);


--
-- Name: index_correlation_rules_on_created_by_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_correlation_rules_on_created_by_id ON public.correlation_rules USING btree (created_by_id);


--
-- Name: index_correlation_rules_on_is_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_correlation_rules_on_is_active ON public.correlation_rules USING btree (is_active);


--
-- Name: index_external_signals_on_lat_and_lng; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_external_signals_on_lat_and_lng ON public.external_signals USING btree (lat, lng);


--
-- Name: index_external_signals_on_occurred_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_external_signals_on_occurred_at ON public.external_signals USING btree (occurred_at);


--
-- Name: index_external_signals_on_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_external_signals_on_source ON public.external_signals USING btree (source);


--
-- Name: index_signal_rule_matches_on_correlation_rule_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_signal_rule_matches_on_correlation_rule_id ON public.signal_rule_matches USING btree (correlation_rule_id);


--
-- Name: index_signal_rule_matches_on_fired_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_signal_rule_matches_on_fired_at ON public.signal_rule_matches USING btree (fired_at);


--
-- Name: index_signal_rule_matches_on_signal_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_signal_rule_matches_on_signal_id ON public.signal_rule_matches USING btree (signal_id);


--
-- Name: index_signal_rule_matches_on_site_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_signal_rule_matches_on_site_id ON public.signal_rule_matches USING btree (site_id);


--
-- Name: index_signal_rule_matches_on_task_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_signal_rule_matches_on_task_id ON public.signal_rule_matches USING btree (task_id);


--
-- Name: index_signals_on_dedup; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_signals_on_dedup ON public.external_signals USING btree (source, external_id, occurred_at);


--
-- Name: index_sites_on_area_of_operation_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_sites_on_area_of_operation_id ON public.sites USING btree (area_of_operation_id);


--
-- Name: index_tasks_on_asset_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_tasks_on_asset_id ON public.tasks USING btree (asset_id);


--
-- Name: index_tasks_on_site_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_tasks_on_site_id ON public.tasks USING btree (site_id);


--
-- Name: index_tasks_on_workflow_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_tasks_on_workflow_status ON public.tasks USING btree (workflow_status);


--
-- Name: index_users_on_email; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_users_on_email ON public.users USING btree (email);


--
-- Name: areas_of_operation fk_rails_0bd4a97ef0; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.areas_of_operation
    ADD CONSTRAINT fk_rails_0bd4a97ef0 FOREIGN KEY (created_by_id) REFERENCES public.users(id);


--
-- Name: tasks fk_rails_546c3973b4; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT fk_rails_546c3973b4 FOREIGN KEY (asset_id) REFERENCES public.assets(id);


--
-- Name: signal_rule_matches fk_rails_56955fb8d9; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signal_rule_matches
    ADD CONSTRAINT fk_rails_56955fb8d9 FOREIGN KEY (signal_id) REFERENCES public.external_signals(id);


--
-- Name: assets fk_rails_905e385552; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assets
    ADD CONSTRAINT fk_rails_905e385552 FOREIGN KEY (home_site_id) REFERENCES public.sites(id);


--
-- Name: tasks fk_rails_a53067c46b; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT fk_rails_a53067c46b FOREIGN KEY (site_id) REFERENCES public.sites(id);


--
-- Name: sites fk_rails_ad9cdb6510; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sites
    ADD CONSTRAINT fk_rails_ad9cdb6510 FOREIGN KEY (area_of_operation_id) REFERENCES public.areas_of_operation(id) ON DELETE SET NULL;


--
-- Name: correlation_rules fk_rails_b88d28d836; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.correlation_rules
    ADD CONSTRAINT fk_rails_b88d28d836 FOREIGN KEY (area_of_operation_id) REFERENCES public.areas_of_operation(id) ON DELETE SET NULL;


--
-- Name: signal_rule_matches fk_rails_d0622d6dac; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signal_rule_matches
    ADD CONSTRAINT fk_rails_d0622d6dac FOREIGN KEY (task_id) REFERENCES public.tasks(id);


--
-- Name: correlation_rules fk_rails_df82305965; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.correlation_rules
    ADD CONSTRAINT fk_rails_df82305965 FOREIGN KEY (created_by_id) REFERENCES public.users(id);


--
-- Name: signal_rule_matches fk_rails_e7bfadaf05; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signal_rule_matches
    ADD CONSTRAINT fk_rails_e7bfadaf05 FOREIGN KEY (correlation_rule_id) REFERENCES public.correlation_rules(id);


--
-- Name: signal_rule_matches fk_rails_f6fa1e442c; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signal_rule_matches
    ADD CONSTRAINT fk_rails_f6fa1e442c FOREIGN KEY (site_id) REFERENCES public.sites(id);


--
-- PostgreSQL database dump complete
--

SET search_path TO "$user", public;

INSERT INTO "schema_migrations" (version) VALUES
('20260315061734'),
('20260315000006'),
('20260315000005'),
('20260315000004'),
('20260315000003'),
('20260315000002'),
('20260315000001'),
('20260314034831'),
('20260313104951'),
('20260313104950'),
('20260313104949'),
('20260313104948'),
('20260313104919');

