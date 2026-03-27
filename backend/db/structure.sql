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


--
-- Name: prevent_incident_note_delete(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_incident_note_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'incident_notes are immutable — deletes are not permitted';
END;
$$;


--
-- Name: prevent_incident_note_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_incident_note_update() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'incident_notes are immutable — updates are not permitted';
END;
$$;


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
    posture character varying DEFAULT 'observe'::character varying NOT NULL,
    posture_changed_at timestamp(6) without time zone,
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
    updated_at timestamp(6) without time zone NOT NULL,
    last_reported_at timestamp(6) without time zone
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
-- Name: chokepoints; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chokepoints (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    area_of_operation_id uuid NOT NULL,
    created_by_id uuid NOT NULL,
    updated_by_id uuid NOT NULL,
    name character varying NOT NULL,
    category character varying NOT NULL,
    status character varying NOT NULL,
    latitude numeric(10,6) NOT NULL,
    longitude numeric(10,6) NOT NULL,
    watch_radius_km numeric(6,2) NOT NULL,
    notes text,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: commander_intents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.commander_intents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    area_of_operation_id uuid NOT NULL,
    created_by_id uuid NOT NULL,
    updated_by_id uuid NOT NULL,
    title character varying NOT NULL,
    objective text NOT NULL,
    end_state text NOT NULL,
    constraints text,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
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
-- Name: incident_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.incident_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    incident_id uuid NOT NULL,
    author_id uuid NOT NULL,
    body text NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: incidents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.incidents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    description text,
    status character varying DEFAULT 'open'::character varying NOT NULL,
    severity character varying DEFAULT 'moderate'::character varying NOT NULL,
    confidence double precision DEFAULT 0.0 NOT NULL,
    site_id uuid,
    area_of_operation_id uuid,
    opened_at timestamp without time zone DEFAULT now() NOT NULL,
    acknowledged_at timestamp without time zone,
    closed_at timestamp without time zone,
    fusion_rationale text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL,
    assigned_to_id uuid,
    assigned_at timestamp(6) without time zone
);


--
-- Name: pace_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pace_plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    area_of_operation_id uuid NOT NULL,
    created_by_id uuid NOT NULL,
    updated_by_id uuid NOT NULL,
    primary_plan text NOT NULL,
    alternate_plan text NOT NULL,
    contingency_plan text NOT NULL,
    emergency_plan text NOT NULL,
    notes text,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: recommendations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.recommendations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    recommendation_type character varying NOT NULL,
    status character varying DEFAULT 'pending'::character varying NOT NULL,
    tier character varying NOT NULL,
    confidence double precision NOT NULL,
    rationale text NOT NULL,
    evidence jsonb DEFAULT '[]'::jsonb NOT NULL,
    action_payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    affected_entity_type character varying,
    affected_entity_id uuid,
    reviewed_by_id uuid,
    reviewed_at timestamp without time zone,
    review_reason text,
    executed_at timestamp without time zone,
    expires_at timestamp without time zone NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: salute_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.salute_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    area_of_operation_id uuid NOT NULL,
    site_id uuid,
    created_by_id uuid NOT NULL,
    size character varying,
    activity text NOT NULL,
    location text NOT NULL,
    unit character varying,
    observed_at timestamp(6) without time zone NOT NULL,
    equipment text,
    remarks text,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
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
    correlation_rule_id uuid,
    site_id uuid,
    task_id uuid,
    fired_at timestamp(6) without time zone DEFAULT now() NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    confidence double precision DEFAULT 0.0 NOT NULL,
    workflow_status character varying DEFAULT 'unacknowledged'::character varying NOT NULL,
    acknowledged_at timestamp(6) without time zone,
    notes text,
    acknowledged_by_id uuid,
    incident_id uuid
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
    flag_reason text,
    geofence_radius_km double precision DEFAULT 50.0 NOT NULL
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
-- Name: telemetry_readings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telemetry_readings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    asset_id uuid NOT NULL,
    lat double precision NOT NULL,
    lng double precision NOT NULL,
    speed double precision,
    heading double precision,
    battery double precision,
    occurred_at timestamp(6) without time zone NOT NULL,
    created_at timestamp(6) without time zone DEFAULT now() NOT NULL
)
PARTITION BY RANGE (occurred_at);


--
-- Name: telemetry_readings_p20260323; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telemetry_readings_p20260323 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    asset_id uuid NOT NULL,
    lat double precision NOT NULL,
    lng double precision NOT NULL,
    speed double precision,
    heading double precision,
    battery double precision,
    occurred_at timestamp(6) without time zone NOT NULL,
    created_at timestamp(6) without time zone DEFAULT now() NOT NULL
);


--
-- Name: telemetry_readings_p20260324; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telemetry_readings_p20260324 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    asset_id uuid NOT NULL,
    lat double precision NOT NULL,
    lng double precision NOT NULL,
    speed double precision,
    heading double precision,
    battery double precision,
    occurred_at timestamp(6) without time zone NOT NULL,
    created_at timestamp(6) without time zone DEFAULT now() NOT NULL
);


--
-- Name: telemetry_readings_p20260325; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telemetry_readings_p20260325 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    asset_id uuid NOT NULL,
    lat double precision NOT NULL,
    lng double precision NOT NULL,
    speed double precision,
    heading double precision,
    battery double precision,
    occurred_at timestamp(6) without time zone NOT NULL,
    created_at timestamp(6) without time zone DEFAULT now() NOT NULL
);


--
-- Name: telemetry_readings_p20260326; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telemetry_readings_p20260326 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    asset_id uuid NOT NULL,
    lat double precision NOT NULL,
    lng double precision NOT NULL,
    speed double precision,
    heading double precision,
    battery double precision,
    occurred_at timestamp(6) without time zone NOT NULL,
    created_at timestamp(6) without time zone DEFAULT now() NOT NULL
);


--
-- Name: telemetry_readings_p20260327; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telemetry_readings_p20260327 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    asset_id uuid NOT NULL,
    lat double precision NOT NULL,
    lng double precision NOT NULL,
    speed double precision,
    heading double precision,
    battery double precision,
    occurred_at timestamp(6) without time zone NOT NULL,
    created_at timestamp(6) without time zone DEFAULT now() NOT NULL
);


--
-- Name: telemetry_readings_p20260328; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telemetry_readings_p20260328 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    asset_id uuid NOT NULL,
    lat double precision NOT NULL,
    lng double precision NOT NULL,
    speed double precision,
    heading double precision,
    battery double precision,
    occurred_at timestamp(6) without time zone NOT NULL,
    created_at timestamp(6) without time zone DEFAULT now() NOT NULL
);


--
-- Name: telemetry_readings_p20260329; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telemetry_readings_p20260329 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    asset_id uuid NOT NULL,
    lat double precision NOT NULL,
    lng double precision NOT NULL,
    speed double precision,
    heading double precision,
    battery double precision,
    occurred_at timestamp(6) without time zone NOT NULL,
    created_at timestamp(6) without time zone DEFAULT now() NOT NULL
);


--
-- Name: telemetry_readings_p20260330; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telemetry_readings_p20260330 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    asset_id uuid NOT NULL,
    lat double precision NOT NULL,
    lng double precision NOT NULL,
    speed double precision,
    heading double precision,
    battery double precision,
    occurred_at timestamp(6) without time zone NOT NULL,
    created_at timestamp(6) without time zone DEFAULT now() NOT NULL
);


--
-- Name: telemetry_readings_p20260331; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telemetry_readings_p20260331 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    asset_id uuid NOT NULL,
    lat double precision NOT NULL,
    lng double precision NOT NULL,
    speed double precision,
    heading double precision,
    battery double precision,
    occurred_at timestamp(6) without time zone NOT NULL,
    created_at timestamp(6) without time zone DEFAULT now() NOT NULL
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
-- Name: telemetry_readings_p20260323; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemetry_readings ATTACH PARTITION public.telemetry_readings_p20260323 FOR VALUES FROM ('2026-03-23 00:00:00') TO ('2026-03-24 00:00:00');


--
-- Name: telemetry_readings_p20260324; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemetry_readings ATTACH PARTITION public.telemetry_readings_p20260324 FOR VALUES FROM ('2026-03-24 00:00:00') TO ('2026-03-25 00:00:00');


--
-- Name: telemetry_readings_p20260325; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemetry_readings ATTACH PARTITION public.telemetry_readings_p20260325 FOR VALUES FROM ('2026-03-25 00:00:00') TO ('2026-03-26 00:00:00');


--
-- Name: telemetry_readings_p20260326; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemetry_readings ATTACH PARTITION public.telemetry_readings_p20260326 FOR VALUES FROM ('2026-03-26 00:00:00') TO ('2026-03-27 00:00:00');


--
-- Name: telemetry_readings_p20260327; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemetry_readings ATTACH PARTITION public.telemetry_readings_p20260327 FOR VALUES FROM ('2026-03-27 00:00:00') TO ('2026-03-28 00:00:00');


--
-- Name: telemetry_readings_p20260328; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemetry_readings ATTACH PARTITION public.telemetry_readings_p20260328 FOR VALUES FROM ('2026-03-28 00:00:00') TO ('2026-03-29 00:00:00');


--
-- Name: telemetry_readings_p20260329; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemetry_readings ATTACH PARTITION public.telemetry_readings_p20260329 FOR VALUES FROM ('2026-03-29 00:00:00') TO ('2026-03-30 00:00:00');


--
-- Name: telemetry_readings_p20260330; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemetry_readings ATTACH PARTITION public.telemetry_readings_p20260330 FOR VALUES FROM ('2026-03-30 00:00:00') TO ('2026-03-31 00:00:00');


--
-- Name: telemetry_readings_p20260331; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemetry_readings ATTACH PARTITION public.telemetry_readings_p20260331 FOR VALUES FROM ('2026-03-31 00:00:00') TO ('2026-04-01 00:00:00');


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
-- Name: chokepoints chokepoints_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chokepoints
    ADD CONSTRAINT chokepoints_pkey PRIMARY KEY (id);


--
-- Name: commander_intents commander_intents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commander_intents
    ADD CONSTRAINT commander_intents_pkey PRIMARY KEY (id);


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
-- Name: incident_notes incident_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_notes
    ADD CONSTRAINT incident_notes_pkey PRIMARY KEY (id);


--
-- Name: incidents incidents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incidents
    ADD CONSTRAINT incidents_pkey PRIMARY KEY (id);


--
-- Name: pace_plans pace_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pace_plans
    ADD CONSTRAINT pace_plans_pkey PRIMARY KEY (id);


--
-- Name: recommendations recommendations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recommendations
    ADD CONSTRAINT recommendations_pkey PRIMARY KEY (id);


--
-- Name: salute_reports salute_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salute_reports
    ADD CONSTRAINT salute_reports_pkey PRIMARY KEY (id);


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
-- Name: idx_geofence_breach_signal_site_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_geofence_breach_signal_site_unique ON public.signal_rule_matches USING btree (signal_id, site_id) WHERE (correlation_rule_id IS NULL);


--
-- Name: idx_on_entity_type_entity_id_occurred_at_dfd7f189aa; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_on_entity_type_entity_id_occurred_at_dfd7f189aa ON public.audit_events USING btree (entity_type, entity_id, occurred_at);


--
-- Name: idx_recommendations_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_recommendations_entity ON public.recommendations USING btree (affected_entity_type, affected_entity_id);


--
-- Name: idx_recommendations_pending_dedup; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_recommendations_pending_dedup ON public.recommendations USING btree (recommendation_type, affected_entity_type, affected_entity_id) WHERE ((status)::text = 'pending'::text);


--
-- Name: index_ao_on_threat_level; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_ao_on_threat_level ON public.areas_of_operation USING btree (threat_level);


--
-- Name: index_areas_of_operation_on_created_by_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_areas_of_operation_on_created_by_id ON public.areas_of_operation USING btree (created_by_id);


--
-- Name: index_areas_of_operation_on_posture; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_areas_of_operation_on_posture ON public.areas_of_operation USING btree (posture);


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
-- Name: index_chokepoints_on_ao_id_and_lower_name; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_chokepoints_on_ao_id_and_lower_name ON public.chokepoints USING btree (area_of_operation_id, lower((name)::text));


--
-- Name: index_chokepoints_on_area_of_operation_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_chokepoints_on_area_of_operation_id ON public.chokepoints USING btree (area_of_operation_id);


--
-- Name: index_chokepoints_on_area_of_operation_id_and_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_chokepoints_on_area_of_operation_id_and_status ON public.chokepoints USING btree (area_of_operation_id, status);


--
-- Name: index_chokepoints_on_created_by_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_chokepoints_on_created_by_id ON public.chokepoints USING btree (created_by_id);


--
-- Name: index_chokepoints_on_updated_by_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_chokepoints_on_updated_by_id ON public.chokepoints USING btree (updated_by_id);


--
-- Name: index_commander_intents_on_area_of_operation_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_commander_intents_on_area_of_operation_id ON public.commander_intents USING btree (area_of_operation_id);


--
-- Name: index_commander_intents_on_created_by_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_commander_intents_on_created_by_id ON public.commander_intents USING btree (created_by_id);


--
-- Name: index_commander_intents_on_updated_by_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_commander_intents_on_updated_by_id ON public.commander_intents USING btree (updated_by_id);


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
-- Name: index_external_signals_on_ingested_at_and_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_external_signals_on_ingested_at_and_id ON public.external_signals USING btree (ingested_at, id);


--
-- Name: index_external_signals_on_lat_and_lng; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_external_signals_on_lat_and_lng ON public.external_signals USING btree (lat, lng);


--
-- Name: index_external_signals_on_occurred_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_external_signals_on_occurred_at ON public.external_signals USING btree (occurred_at);


--
-- Name: index_external_signals_on_signal_type_and_occurred_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_external_signals_on_signal_type_and_occurred_at ON public.external_signals USING btree (signal_type, occurred_at);


--
-- Name: index_external_signals_on_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_external_signals_on_source ON public.external_signals USING btree (source);


--
-- Name: index_incident_notes_on_author_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_incident_notes_on_author_id ON public.incident_notes USING btree (author_id);


--
-- Name: index_incident_notes_on_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_incident_notes_on_created_at ON public.incident_notes USING btree (created_at);


--
-- Name: index_incident_notes_on_incident_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_incident_notes_on_incident_id ON public.incident_notes USING btree (incident_id);


--
-- Name: index_incidents_on_assigned_to_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_incidents_on_assigned_to_id ON public.incidents USING btree (assigned_to_id);


--
-- Name: index_incidents_on_opened_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_incidents_on_opened_at ON public.incidents USING btree (opened_at);


--
-- Name: index_incidents_on_severity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_incidents_on_severity ON public.incidents USING btree (severity);


--
-- Name: index_incidents_on_site_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_incidents_on_site_id ON public.incidents USING btree (site_id);


--
-- Name: index_incidents_on_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_incidents_on_status ON public.incidents USING btree (status);


--
-- Name: index_pace_plans_on_area_of_operation_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_pace_plans_on_area_of_operation_id ON public.pace_plans USING btree (area_of_operation_id);


--
-- Name: index_pace_plans_on_created_by_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_pace_plans_on_created_by_id ON public.pace_plans USING btree (created_by_id);


--
-- Name: index_pace_plans_on_updated_by_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_pace_plans_on_updated_by_id ON public.pace_plans USING btree (updated_by_id);


--
-- Name: index_recommendations_on_expires_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_recommendations_on_expires_at ON public.recommendations USING btree (expires_at);


--
-- Name: index_recommendations_on_recommendation_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_recommendations_on_recommendation_type ON public.recommendations USING btree (recommendation_type);


--
-- Name: index_recommendations_on_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_recommendations_on_status ON public.recommendations USING btree (status);


--
-- Name: index_salute_reports_on_area_of_operation_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_salute_reports_on_area_of_operation_id ON public.salute_reports USING btree (area_of_operation_id);


--
-- Name: index_salute_reports_on_area_of_operation_id_and_observed_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_salute_reports_on_area_of_operation_id_and_observed_at ON public.salute_reports USING btree (area_of_operation_id, observed_at);


--
-- Name: index_salute_reports_on_created_by_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_salute_reports_on_created_by_id ON public.salute_reports USING btree (created_by_id);


--
-- Name: index_salute_reports_on_site_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_salute_reports_on_site_id ON public.salute_reports USING btree (site_id);


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
-- Name: index_signal_rule_matches_on_correlation_rule_id_and_fired_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_signal_rule_matches_on_correlation_rule_id_and_fired_at ON public.signal_rule_matches USING btree (correlation_rule_id, fired_at);


--
-- Name: index_signal_rule_matches_on_fired_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_signal_rule_matches_on_fired_at ON public.signal_rule_matches USING btree (fired_at);


--
-- Name: index_signal_rule_matches_on_incident_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_signal_rule_matches_on_incident_id ON public.signal_rule_matches USING btree (incident_id);


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
-- Name: index_sites_on_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_sites_on_status ON public.sites USING btree (status);


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
-- Name: index_telemetry_readings_on_asset_id_and_occurred_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_telemetry_readings_on_asset_id_and_occurred_at ON ONLY public.telemetry_readings USING btree (asset_id, occurred_at DESC);


--
-- Name: index_telemetry_readings_on_occurred_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_telemetry_readings_on_occurred_at ON ONLY public.telemetry_readings USING brin (occurred_at);


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
-- Name: telemetry_readings_p20260323_asset_id_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_readings_p20260323_asset_id_occurred_at_idx ON public.telemetry_readings_p20260323 USING btree (asset_id, occurred_at DESC);


--
-- Name: telemetry_readings_p20260323_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_readings_p20260323_occurred_at_idx ON public.telemetry_readings_p20260323 USING brin (occurred_at);


--
-- Name: telemetry_readings_p20260324_asset_id_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_readings_p20260324_asset_id_occurred_at_idx ON public.telemetry_readings_p20260324 USING btree (asset_id, occurred_at DESC);


--
-- Name: telemetry_readings_p20260324_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_readings_p20260324_occurred_at_idx ON public.telemetry_readings_p20260324 USING brin (occurred_at);


--
-- Name: telemetry_readings_p20260325_asset_id_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_readings_p20260325_asset_id_occurred_at_idx ON public.telemetry_readings_p20260325 USING btree (asset_id, occurred_at DESC);


--
-- Name: telemetry_readings_p20260325_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_readings_p20260325_occurred_at_idx ON public.telemetry_readings_p20260325 USING brin (occurred_at);


--
-- Name: telemetry_readings_p20260326_asset_id_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_readings_p20260326_asset_id_occurred_at_idx ON public.telemetry_readings_p20260326 USING btree (asset_id, occurred_at DESC);


--
-- Name: telemetry_readings_p20260326_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_readings_p20260326_occurred_at_idx ON public.telemetry_readings_p20260326 USING brin (occurred_at);


--
-- Name: telemetry_readings_p20260327_asset_id_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_readings_p20260327_asset_id_occurred_at_idx ON public.telemetry_readings_p20260327 USING btree (asset_id, occurred_at DESC);


--
-- Name: telemetry_readings_p20260327_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_readings_p20260327_occurred_at_idx ON public.telemetry_readings_p20260327 USING brin (occurred_at);


--
-- Name: telemetry_readings_p20260328_asset_id_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_readings_p20260328_asset_id_occurred_at_idx ON public.telemetry_readings_p20260328 USING btree (asset_id, occurred_at DESC);


--
-- Name: telemetry_readings_p20260328_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_readings_p20260328_occurred_at_idx ON public.telemetry_readings_p20260328 USING brin (occurred_at);


--
-- Name: telemetry_readings_p20260329_asset_id_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_readings_p20260329_asset_id_occurred_at_idx ON public.telemetry_readings_p20260329 USING btree (asset_id, occurred_at DESC);


--
-- Name: telemetry_readings_p20260329_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_readings_p20260329_occurred_at_idx ON public.telemetry_readings_p20260329 USING brin (occurred_at);


--
-- Name: telemetry_readings_p20260330_asset_id_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_readings_p20260330_asset_id_occurred_at_idx ON public.telemetry_readings_p20260330 USING btree (asset_id, occurred_at DESC);


--
-- Name: telemetry_readings_p20260330_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_readings_p20260330_occurred_at_idx ON public.telemetry_readings_p20260330 USING brin (occurred_at);


--
-- Name: telemetry_readings_p20260331_asset_id_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_readings_p20260331_asset_id_occurred_at_idx ON public.telemetry_readings_p20260331 USING btree (asset_id, occurred_at DESC);


--
-- Name: telemetry_readings_p20260331_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_readings_p20260331_occurred_at_idx ON public.telemetry_readings_p20260331 USING brin (occurred_at);


--
-- Name: telemetry_readings_p20260323_asset_id_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.index_telemetry_readings_on_asset_id_and_occurred_at ATTACH PARTITION public.telemetry_readings_p20260323_asset_id_occurred_at_idx;


--
-- Name: telemetry_readings_p20260323_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.index_telemetry_readings_on_occurred_at ATTACH PARTITION public.telemetry_readings_p20260323_occurred_at_idx;


--
-- Name: telemetry_readings_p20260324_asset_id_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.index_telemetry_readings_on_asset_id_and_occurred_at ATTACH PARTITION public.telemetry_readings_p20260324_asset_id_occurred_at_idx;


--
-- Name: telemetry_readings_p20260324_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.index_telemetry_readings_on_occurred_at ATTACH PARTITION public.telemetry_readings_p20260324_occurred_at_idx;


--
-- Name: telemetry_readings_p20260325_asset_id_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.index_telemetry_readings_on_asset_id_and_occurred_at ATTACH PARTITION public.telemetry_readings_p20260325_asset_id_occurred_at_idx;


--
-- Name: telemetry_readings_p20260325_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.index_telemetry_readings_on_occurred_at ATTACH PARTITION public.telemetry_readings_p20260325_occurred_at_idx;


--
-- Name: telemetry_readings_p20260326_asset_id_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.index_telemetry_readings_on_asset_id_and_occurred_at ATTACH PARTITION public.telemetry_readings_p20260326_asset_id_occurred_at_idx;


--
-- Name: telemetry_readings_p20260326_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.index_telemetry_readings_on_occurred_at ATTACH PARTITION public.telemetry_readings_p20260326_occurred_at_idx;


--
-- Name: telemetry_readings_p20260327_asset_id_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.index_telemetry_readings_on_asset_id_and_occurred_at ATTACH PARTITION public.telemetry_readings_p20260327_asset_id_occurred_at_idx;


--
-- Name: telemetry_readings_p20260327_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.index_telemetry_readings_on_occurred_at ATTACH PARTITION public.telemetry_readings_p20260327_occurred_at_idx;


--
-- Name: telemetry_readings_p20260328_asset_id_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.index_telemetry_readings_on_asset_id_and_occurred_at ATTACH PARTITION public.telemetry_readings_p20260328_asset_id_occurred_at_idx;


--
-- Name: telemetry_readings_p20260328_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.index_telemetry_readings_on_occurred_at ATTACH PARTITION public.telemetry_readings_p20260328_occurred_at_idx;


--
-- Name: telemetry_readings_p20260329_asset_id_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.index_telemetry_readings_on_asset_id_and_occurred_at ATTACH PARTITION public.telemetry_readings_p20260329_asset_id_occurred_at_idx;


--
-- Name: telemetry_readings_p20260329_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.index_telemetry_readings_on_occurred_at ATTACH PARTITION public.telemetry_readings_p20260329_occurred_at_idx;


--
-- Name: telemetry_readings_p20260330_asset_id_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.index_telemetry_readings_on_asset_id_and_occurred_at ATTACH PARTITION public.telemetry_readings_p20260330_asset_id_occurred_at_idx;


--
-- Name: telemetry_readings_p20260330_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.index_telemetry_readings_on_occurred_at ATTACH PARTITION public.telemetry_readings_p20260330_occurred_at_idx;


--
-- Name: telemetry_readings_p20260331_asset_id_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.index_telemetry_readings_on_asset_id_and_occurred_at ATTACH PARTITION public.telemetry_readings_p20260331_asset_id_occurred_at_idx;


--
-- Name: telemetry_readings_p20260331_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.index_telemetry_readings_on_occurred_at ATTACH PARTITION public.telemetry_readings_p20260331_occurred_at_idx;


--
-- Name: incident_notes incident_notes_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER incident_notes_immutable BEFORE UPDATE ON public.incident_notes FOR EACH ROW EXECUTE FUNCTION public.prevent_incident_note_update();


--
-- Name: incident_notes incident_notes_no_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER incident_notes_no_delete BEFORE DELETE ON public.incident_notes FOR EACH ROW EXECUTE FUNCTION public.prevent_incident_note_delete();


--
-- Name: chokepoints fk_rails_05fec8fd98; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chokepoints
    ADD CONSTRAINT fk_rails_05fec8fd98 FOREIGN KEY (updated_by_id) REFERENCES public.users(id);


--
-- Name: salute_reports fk_rails_0aaaed891e; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salute_reports
    ADD CONSTRAINT fk_rails_0aaaed891e FOREIGN KEY (site_id) REFERENCES public.sites(id);


--
-- Name: areas_of_operation fk_rails_0bd4a97ef0; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.areas_of_operation
    ADD CONSTRAINT fk_rails_0bd4a97ef0 FOREIGN KEY (created_by_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: incident_notes fk_rails_0cdae229bf; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_notes
    ADD CONSTRAINT fk_rails_0cdae229bf FOREIGN KEY (incident_id) REFERENCES public.incidents(id);


--
-- Name: incidents fk_rails_15ea701cfa; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incidents
    ADD CONSTRAINT fk_rails_15ea701cfa FOREIGN KEY (area_of_operation_id) REFERENCES public.areas_of_operation(id);


--
-- Name: commander_intents fk_rails_19d7c98de8; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commander_intents
    ADD CONSTRAINT fk_rails_19d7c98de8 FOREIGN KEY (created_by_id) REFERENCES public.users(id);


--
-- Name: incident_notes fk_rails_1f12c8a379; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_notes
    ADD CONSTRAINT fk_rails_1f12c8a379 FOREIGN KEY (author_id) REFERENCES public.users(id);


--
-- Name: site_risk_snapshots fk_rails_2321d15556; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_risk_snapshots
    ADD CONSTRAINT fk_rails_2321d15556 FOREIGN KEY (site_id) REFERENCES public.sites(id);


--
-- Name: recommendations fk_rails_246db9116b; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recommendations
    ADD CONSTRAINT fk_rails_246db9116b FOREIGN KEY (reviewed_by_id) REFERENCES public.users(id);


--
-- Name: vessel_tracks fk_rails_28041b5ea5; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vessel_tracks
    ADD CONSTRAINT fk_rails_28041b5ea5 FOREIGN KEY (vessel_id) REFERENCES public.vessels(id) ON DELETE CASCADE;


--
-- Name: pace_plans fk_rails_3ff56ca6ef; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pace_plans
    ADD CONSTRAINT fk_rails_3ff56ca6ef FOREIGN KEY (updated_by_id) REFERENCES public.users(id);


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
-- Name: salute_reports fk_rails_6c5cdccf86; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salute_reports
    ADD CONSTRAINT fk_rails_6c5cdccf86 FOREIGN KEY (area_of_operation_id) REFERENCES public.areas_of_operation(id);


--
-- Name: pace_plans fk_rails_6ddc9c0711; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pace_plans
    ADD CONSTRAINT fk_rails_6ddc9c0711 FOREIGN KEY (created_by_id) REFERENCES public.users(id);


--
-- Name: commander_intents fk_rails_75058a68bc; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commander_intents
    ADD CONSTRAINT fk_rails_75058a68bc FOREIGN KEY (area_of_operation_id) REFERENCES public.areas_of_operation(id);


--
-- Name: incidents fk_rails_7d00d680b0; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incidents
    ADD CONSTRAINT fk_rails_7d00d680b0 FOREIGN KEY (site_id) REFERENCES public.sites(id);


--
-- Name: assets fk_rails_905e385552; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assets
    ADD CONSTRAINT fk_rails_905e385552 FOREIGN KEY (home_site_id) REFERENCES public.sites(id);


--
-- Name: salute_reports fk_rails_9d7b682dfe; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.salute_reports
    ADD CONSTRAINT fk_rails_9d7b682dfe FOREIGN KEY (created_by_id) REFERENCES public.users(id);


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
-- Name: signal_rule_matches fk_rails_ae93be248f; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signal_rule_matches
    ADD CONSTRAINT fk_rails_ae93be248f FOREIGN KEY (incident_id) REFERENCES public.incidents(id);


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
-- Name: commander_intents fk_rails_cca27b17dd; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commander_intents
    ADD CONSTRAINT fk_rails_cca27b17dd FOREIGN KEY (updated_by_id) REFERENCES public.users(id);


--
-- Name: signal_rule_matches fk_rails_d0622d6dac; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signal_rule_matches
    ADD CONSTRAINT fk_rails_d0622d6dac FOREIGN KEY (task_id) REFERENCES public.tasks(id);


--
-- Name: incidents fk_rails_d2436dcc2e; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incidents
    ADD CONSTRAINT fk_rails_d2436dcc2e FOREIGN KEY (assigned_to_id) REFERENCES public.users(id);


--
-- Name: telemetry_readings fk_rails_d477387a3c; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.telemetry_readings
    ADD CONSTRAINT fk_rails_d477387a3c FOREIGN KEY (asset_id) REFERENCES public.assets(id) ON DELETE CASCADE;


--
-- Name: pace_plans fk_rails_db6b98f6a6; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pace_plans
    ADD CONSTRAINT fk_rails_db6b98f6a6 FOREIGN KEY (area_of_operation_id) REFERENCES public.areas_of_operation(id);


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
-- Name: chokepoints fk_rails_f4f59d5fbb; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chokepoints
    ADD CONSTRAINT fk_rails_f4f59d5fbb FOREIGN KEY (created_by_id) REFERENCES public.users(id);


--
-- Name: chokepoints fk_rails_f514f46e00; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chokepoints
    ADD CONSTRAINT fk_rails_f514f46e00 FOREIGN KEY (area_of_operation_id) REFERENCES public.areas_of_operation(id);


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
('20260327030000'),
('20260327020000'),
('20260327010000'),
('20260325020000'),
('20260325010000'),
('20260324010000'),
('20260324000100'),
('20260323200001'),
('20260323100001'),
('20260323100000'),
('20260321234646'),
('20260321225132'),
('20260321150001'),
('20260321150000'),
('20260321120000'),
('20260321045816'),
('20260320000008'),
('20260320000007'),
('20260320000006'),
('20260320000005'),
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

