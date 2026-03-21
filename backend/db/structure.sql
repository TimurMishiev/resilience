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
    occurred_at timestamp(6) without time zone DEFAULT now() NOT NULL,
    after_workflow_status text GENERATED ALWAYS AS ((after_snapshot ->> 'workflow_status'::text)) STORED
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
    area_of_operation_id uuid,
    mitre_tags text[] DEFAULT '{}'::text[]
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
    CONSTRAINT signals_signal_type_check CHECK ((signal_type = ANY (ARRAY['aircraft_position'::text, 'vessel_position'::text, 'seismic_event'::text, 'gps_jamming'::text, 'wildfire'::text, 'manual'::text, 'ais_gap'::text, 'conflict_event'::text, 'disaster_alert'::text]))),
    CONSTRAINT signals_source_check CHECK ((source = ANY (ARRAY['opensky'::text, 'ais'::text, 'usgs_seismic'::text, 'gpsjam'::text, 'firms_wildfire'::text, 'manual'::text, 'derived'::text, 'acled'::text, 'gdacs'::text])))
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
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    confidence double precision DEFAULT 0.0 NOT NULL,
    workflow_status character varying DEFAULT 'unacknowledged'::character varying NOT NULL,
    acknowledged_at timestamp(6) without time zone,
    notes text,
    acknowledged_by_id uuid
);


--
-- Name: site_risk_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.site_risk_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    site_id uuid NOT NULL,
    score integer NOT NULL,
    risk_level character varying NOT NULL,
    alert_pressure numeric(5,2) NOT NULL,
    task_health numeric(5,2) NOT NULL,
    signal_density numeric(5,2) NOT NULL,
    recorded_at timestamp(6) without time zone NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
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
    area_of_operation_id uuid,
    flagged_at timestamp(6) without time zone,
    flag_reason text
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
    CONSTRAINT blocked_reason_consistency CHECK ((((workflow_status = 'blocked'::text) AND (blocked_reason IS NOT NULL)) OR ((workflow_status <> 'blocked'::text) AND (blocked_reason IS NULL)))),
    CONSTRAINT resolved_at_only_when_resolved CHECK (((resolved_at IS NULL) OR (workflow_status = 'resolved'::text))),
    CONSTRAINT resolved_at_required_when_resolved CHECK (((workflow_status <> 'resolved'::text) OR (resolved_at IS NOT NULL)))
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
-- Name: vessel_tracks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vessel_tracks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    vessel_id uuid NOT NULL,
    lat double precision NOT NULL,
    lng double precision NOT NULL,
    speed double precision,
    heading double precision,
    occurred_at timestamp(6) without time zone NOT NULL,
    created_at timestamp(6) without time zone NOT NULL
);


--
-- Name: vessels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vessels (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    mmsi character varying NOT NULL,
    name character varying,
    vessel_type character varying,
    flag character varying,
    destination character varying,
    lat double precision NOT NULL,
    lng double precision NOT NULL,
    speed double precision,
    heading double precision,
    first_seen_at timestamp(6) without time zone NOT NULL,
    last_seen_at timestamp(6) without time zone NOT NULL,
    last_signal_id uuid,
    loitering_since timestamp(6) without time zone,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
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
-- Name: site_risk_snapshots site_risk_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_risk_snapshots
    ADD CONSTRAINT site_risk_snapshots_pkey PRIMARY KEY (id);


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
-- Name: vessel_tracks vessel_tracks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vessel_tracks
    ADD CONSTRAINT vessel_tracks_pkey PRIMARY KEY (id);


--
-- Name: vessels vessels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vessels
    ADD CONSTRAINT vessels_pkey PRIMARY KEY (id);


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
-- Name: index_audit_events_analytics; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_audit_events_analytics ON public.audit_events USING btree (entity_type, after_workflow_status, occurred_at);


--
-- Name: index_audit_events_on_after_workflow_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_audit_events_on_after_workflow_status ON public.audit_events USING btree (after_workflow_status) WHERE (after_workflow_status IS NOT NULL);


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
-- Name: index_signal_rule_matches_on_acknowledged_by_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_signal_rule_matches_on_acknowledged_by_id ON public.signal_rule_matches USING btree (acknowledged_by_id);


--
-- Name: index_signal_rule_matches_on_confidence; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_signal_rule_matches_on_confidence ON public.signal_rule_matches USING btree (confidence);


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
-- Name: index_signal_rule_matches_on_workflow_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_signal_rule_matches_on_workflow_status ON public.signal_rule_matches USING btree (workflow_status);


--
-- Name: index_signals_on_dedup; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_signals_on_dedup ON public.external_signals USING btree (source, external_id, occurred_at);


--
-- Name: index_site_risk_snapshots_on_site_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_site_risk_snapshots_on_site_id ON public.site_risk_snapshots USING btree (site_id);


--
-- Name: index_site_risk_snapshots_on_site_id_and_recorded_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_site_risk_snapshots_on_site_id_and_recorded_at ON public.site_risk_snapshots USING btree (site_id, recorded_at);


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
-- Name: index_vessel_tracks_on_occurred_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_vessel_tracks_on_occurred_at ON public.vessel_tracks USING btree (occurred_at);


--
-- Name: index_vessel_tracks_on_vessel_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_vessel_tracks_on_vessel_id ON public.vessel_tracks USING btree (vessel_id);


--
-- Name: index_vessel_tracks_on_vessel_id_and_occurred_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_vessel_tracks_on_vessel_id_and_occurred_at ON public.vessel_tracks USING btree (vessel_id, occurred_at);


--
-- Name: index_vessels_on_last_seen_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_vessels_on_last_seen_at ON public.vessels USING btree (last_seen_at);


--
-- Name: index_vessels_on_last_signal_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_vessels_on_last_signal_id ON public.vessels USING btree (last_signal_id);


--
-- Name: index_vessels_on_loitering_since; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_vessels_on_loitering_since ON public.vessels USING btree (loitering_since) WHERE (loitering_since IS NOT NULL);


--
-- Name: index_vessels_on_mmsi; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_vessels_on_mmsi ON public.vessels USING btree (mmsi);


--
-- Name: areas_of_operation fk_rails_0bd4a97ef0; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.areas_of_operation
    ADD CONSTRAINT fk_rails_0bd4a97ef0 FOREIGN KEY (created_by_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: site_risk_snapshots fk_rails_2321d15556; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_risk_snapshots
    ADD CONSTRAINT fk_rails_2321d15556 FOREIGN KEY (site_id) REFERENCES public.sites(id);


--
-- Name: vessel_tracks fk_rails_28041b5ea5; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vessel_tracks
    ADD CONSTRAINT fk_rails_28041b5ea5 FOREIGN KEY (vessel_id) REFERENCES public.vessels(id) ON DELETE CASCADE;


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
    ADD CONSTRAINT fk_rails_a53067c46b FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE RESTRICT;


--
-- Name: sites fk_rails_ad9cdb6510; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sites
    ADD CONSTRAINT fk_rails_ad9cdb6510 FOREIGN KEY (area_of_operation_id) REFERENCES public.areas_of_operation(id) ON DELETE SET NULL;


--
-- Name: signal_rule_matches fk_rails_b85002b8dc; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signal_rule_matches
    ADD CONSTRAINT fk_rails_b85002b8dc FOREIGN KEY (acknowledged_by_id) REFERENCES public.users(id);


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
    ADD CONSTRAINT fk_rails_df82305965 FOREIGN KEY (created_by_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: signal_rule_matches fk_rails_e7bfadaf05; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signal_rule_matches
    ADD CONSTRAINT fk_rails_e7bfadaf05 FOREIGN KEY (correlation_rule_id) REFERENCES public.correlation_rules(id) ON DELETE CASCADE;


--
-- Name: vessels fk_rails_f4b4982a14; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vessels
    ADD CONSTRAINT fk_rails_f4b4982a14 FOREIGN KEY (last_signal_id) REFERENCES public.external_signals(id);


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
('20260320000004'),
('20260320000003'),
('20260320000002'),
('20260320000001'),
('20260318030004'),
('20260318030003'),
('20260318030002'),
('20260318030001'),
('20260318030000'),
('20260318020001'),
('20260318020000'),
('20260318011248'),
('20260317232051'),
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

