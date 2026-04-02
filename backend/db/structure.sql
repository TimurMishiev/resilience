--
-- PostgreSQL database dump
--


-- Dumped from database version 17.7 (Ubuntu 17.7-3.pgdg24.04+1)
-- Dumped by pg_dump version 17.9 (Debian 17.9-0+deb13u1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
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
-- Name: postgis; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;


--
-- Name: EXTENSION postgis; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION postgis IS 'PostGIS geometry and geography spatial types and functions';


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


--
-- Name: sync_external_signal_location(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_external_signal_location() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.lat IS NOT NULL AND NEW.lng IS NOT NULL THEN
    NEW.location := ST_SetSRID(ST_MakePoint(NEW.lng::double precision, NEW.lat::double precision), 4326);
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: sync_site_location(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_site_location() RETURNS trigger
    LANGUAGE plpgsql
    AS $$ BEGIN IF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL THEN NEW.location := ST_SetSRID(ST_MakePoint(NEW.longitude::double precision, NEW.latitude::double precision), 4326); END IF; RETURN NEW; END; $$;


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
    location public.geography(Point,4326),
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
    geofence_radius_km double precision DEFAULT 50.0 NOT NULL,
    location public.geography(Point,4326)
);


--
-- Name: solid_cache_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.solid_cache_entries (
    id bigint NOT NULL,
    key bytea NOT NULL,
    value bytea NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    key_hash bigint NOT NULL,
    byte_size integer NOT NULL
);


--
-- Name: solid_cache_entries_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.solid_cache_entries_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: solid_cache_entries_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.solid_cache_entries_id_seq OWNED BY public.solid_cache_entries.id;


--
-- Name: solid_queue_blocked_executions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.solid_queue_blocked_executions (
    id bigint NOT NULL,
    job_id bigint NOT NULL,
    queue_name character varying NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    concurrency_key character varying NOT NULL,
    expires_at timestamp(6) without time zone NOT NULL,
    created_at timestamp(6) without time zone NOT NULL
);


--
-- Name: solid_queue_blocked_executions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.solid_queue_blocked_executions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: solid_queue_blocked_executions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.solid_queue_blocked_executions_id_seq OWNED BY public.solid_queue_blocked_executions.id;


--
-- Name: solid_queue_claimed_executions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.solid_queue_claimed_executions (
    id bigint NOT NULL,
    job_id bigint NOT NULL,
    process_id bigint,
    created_at timestamp(6) without time zone NOT NULL
);


--
-- Name: solid_queue_claimed_executions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.solid_queue_claimed_executions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: solid_queue_claimed_executions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.solid_queue_claimed_executions_id_seq OWNED BY public.solid_queue_claimed_executions.id;


--
-- Name: solid_queue_failed_executions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.solid_queue_failed_executions (
    id bigint NOT NULL,
    job_id bigint NOT NULL,
    error text,
    created_at timestamp(6) without time zone NOT NULL
);


--
-- Name: solid_queue_failed_executions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.solid_queue_failed_executions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: solid_queue_failed_executions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.solid_queue_failed_executions_id_seq OWNED BY public.solid_queue_failed_executions.id;


--
-- Name: solid_queue_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.solid_queue_jobs (
    id bigint NOT NULL,
    queue_name character varying NOT NULL,
    class_name character varying NOT NULL,
    arguments text,
    priority integer DEFAULT 0 NOT NULL,
    active_job_id character varying,
    scheduled_at timestamp(6) without time zone,
    finished_at timestamp(6) without time zone,
    concurrency_key character varying,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: solid_queue_jobs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.solid_queue_jobs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: solid_queue_jobs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.solid_queue_jobs_id_seq OWNED BY public.solid_queue_jobs.id;


--
-- Name: solid_queue_pauses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.solid_queue_pauses (
    id bigint NOT NULL,
    queue_name character varying NOT NULL,
    created_at timestamp(6) without time zone NOT NULL
);


--
-- Name: solid_queue_pauses_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.solid_queue_pauses_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: solid_queue_pauses_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.solid_queue_pauses_id_seq OWNED BY public.solid_queue_pauses.id;


--
-- Name: solid_queue_processes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.solid_queue_processes (
    id bigint NOT NULL,
    kind character varying NOT NULL,
    last_heartbeat_at timestamp(6) without time zone NOT NULL,
    supervisor_id bigint,
    pid integer NOT NULL,
    hostname character varying,
    metadata text,
    created_at timestamp(6) without time zone NOT NULL,
    name character varying NOT NULL
);


--
-- Name: solid_queue_processes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.solid_queue_processes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: solid_queue_processes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.solid_queue_processes_id_seq OWNED BY public.solid_queue_processes.id;


--
-- Name: solid_queue_ready_executions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.solid_queue_ready_executions (
    id bigint NOT NULL,
    job_id bigint NOT NULL,
    queue_name character varying NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    created_at timestamp(6) without time zone NOT NULL
);


--
-- Name: solid_queue_ready_executions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.solid_queue_ready_executions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: solid_queue_ready_executions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.solid_queue_ready_executions_id_seq OWNED BY public.solid_queue_ready_executions.id;


--
-- Name: solid_queue_recurring_executions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.solid_queue_recurring_executions (
    id bigint NOT NULL,
    job_id bigint NOT NULL,
    task_key character varying NOT NULL,
    run_at timestamp(6) without time zone NOT NULL,
    created_at timestamp(6) without time zone NOT NULL
);


--
-- Name: solid_queue_recurring_executions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.solid_queue_recurring_executions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: solid_queue_recurring_executions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.solid_queue_recurring_executions_id_seq OWNED BY public.solid_queue_recurring_executions.id;


--
-- Name: solid_queue_recurring_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.solid_queue_recurring_tasks (
    id bigint NOT NULL,
    key character varying NOT NULL,
    schedule character varying NOT NULL,
    command character varying(2048),
    class_name character varying,
    arguments text,
    queue_name character varying,
    priority integer DEFAULT 0,
    static boolean DEFAULT true NOT NULL,
    description text,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: solid_queue_recurring_tasks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.solid_queue_recurring_tasks_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: solid_queue_recurring_tasks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.solid_queue_recurring_tasks_id_seq OWNED BY public.solid_queue_recurring_tasks.id;


--
-- Name: solid_queue_scheduled_executions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.solid_queue_scheduled_executions (
    id bigint NOT NULL,
    job_id bigint NOT NULL,
    queue_name character varying NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    scheduled_at timestamp(6) without time zone NOT NULL,
    created_at timestamp(6) without time zone NOT NULL
);


--
-- Name: solid_queue_scheduled_executions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.solid_queue_scheduled_executions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: solid_queue_scheduled_executions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.solid_queue_scheduled_executions_id_seq OWNED BY public.solid_queue_scheduled_executions.id;


--
-- Name: solid_queue_semaphores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.solid_queue_semaphores (
    id bigint NOT NULL,
    key character varying NOT NULL,
    value integer DEFAULT 1 NOT NULL,
    expires_at timestamp(6) without time zone NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: solid_queue_semaphores_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.solid_queue_semaphores_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: solid_queue_semaphores_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.solid_queue_semaphores_id_seq OWNED BY public.solid_queue_semaphores.id;


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
    CONSTRAINT users_role_check CHECK (((role)::text = ANY (ARRAY[('operator'::character varying)::text, ('commander'::character varying)::text])))
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
-- Name: solid_cache_entries id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solid_cache_entries ALTER COLUMN id SET DEFAULT nextval('public.solid_cache_entries_id_seq'::regclass);


--
-- Name: solid_queue_blocked_executions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solid_queue_blocked_executions ALTER COLUMN id SET DEFAULT nextval('public.solid_queue_blocked_executions_id_seq'::regclass);


--
-- Name: solid_queue_claimed_executions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solid_queue_claimed_executions ALTER COLUMN id SET DEFAULT nextval('public.solid_queue_claimed_executions_id_seq'::regclass);


--
-- Name: solid_queue_failed_executions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solid_queue_failed_executions ALTER COLUMN id SET DEFAULT nextval('public.solid_queue_failed_executions_id_seq'::regclass);


--
-- Name: solid_queue_jobs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solid_queue_jobs ALTER COLUMN id SET DEFAULT nextval('public.solid_queue_jobs_id_seq'::regclass);


--
-- Name: solid_queue_pauses id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solid_queue_pauses ALTER COLUMN id SET DEFAULT nextval('public.solid_queue_pauses_id_seq'::regclass);


--
-- Name: solid_queue_processes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solid_queue_processes ALTER COLUMN id SET DEFAULT nextval('public.solid_queue_processes_id_seq'::regclass);


--
-- Name: solid_queue_ready_executions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solid_queue_ready_executions ALTER COLUMN id SET DEFAULT nextval('public.solid_queue_ready_executions_id_seq'::regclass);


--
-- Name: solid_queue_recurring_executions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solid_queue_recurring_executions ALTER COLUMN id SET DEFAULT nextval('public.solid_queue_recurring_executions_id_seq'::regclass);


--
-- Name: solid_queue_recurring_tasks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solid_queue_recurring_tasks ALTER COLUMN id SET DEFAULT nextval('public.solid_queue_recurring_tasks_id_seq'::regclass);


--
-- Name: solid_queue_scheduled_executions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solid_queue_scheduled_executions ALTER COLUMN id SET DEFAULT nextval('public.solid_queue_scheduled_executions_id_seq'::regclass);


--
-- Name: solid_queue_semaphores id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solid_queue_semaphores ALTER COLUMN id SET DEFAULT nextval('public.solid_queue_semaphores_id_seq'::regclass);


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
-- Name: recommendations recommendations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recommendations
    ADD CONSTRAINT recommendations_pkey PRIMARY KEY (id);


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
-- Name: solid_cache_entries solid_cache_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solid_cache_entries
    ADD CONSTRAINT solid_cache_entries_pkey PRIMARY KEY (id);


--
-- Name: solid_queue_blocked_executions solid_queue_blocked_executions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solid_queue_blocked_executions
    ADD CONSTRAINT solid_queue_blocked_executions_pkey PRIMARY KEY (id);


--
-- Name: solid_queue_claimed_executions solid_queue_claimed_executions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solid_queue_claimed_executions
    ADD CONSTRAINT solid_queue_claimed_executions_pkey PRIMARY KEY (id);


--
-- Name: solid_queue_failed_executions solid_queue_failed_executions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solid_queue_failed_executions
    ADD CONSTRAINT solid_queue_failed_executions_pkey PRIMARY KEY (id);


--
-- Name: solid_queue_jobs solid_queue_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solid_queue_jobs
    ADD CONSTRAINT solid_queue_jobs_pkey PRIMARY KEY (id);


--
-- Name: solid_queue_pauses solid_queue_pauses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solid_queue_pauses
    ADD CONSTRAINT solid_queue_pauses_pkey PRIMARY KEY (id);


--
-- Name: solid_queue_processes solid_queue_processes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solid_queue_processes
    ADD CONSTRAINT solid_queue_processes_pkey PRIMARY KEY (id);


--
-- Name: solid_queue_ready_executions solid_queue_ready_executions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solid_queue_ready_executions
    ADD CONSTRAINT solid_queue_ready_executions_pkey PRIMARY KEY (id);


--
-- Name: solid_queue_recurring_executions solid_queue_recurring_executions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solid_queue_recurring_executions
    ADD CONSTRAINT solid_queue_recurring_executions_pkey PRIMARY KEY (id);


--
-- Name: solid_queue_recurring_tasks solid_queue_recurring_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solid_queue_recurring_tasks
    ADD CONSTRAINT solid_queue_recurring_tasks_pkey PRIMARY KEY (id);


--
-- Name: solid_queue_scheduled_executions solid_queue_scheduled_executions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solid_queue_scheduled_executions
    ADD CONSTRAINT solid_queue_scheduled_executions_pkey PRIMARY KEY (id);


--
-- Name: solid_queue_semaphores solid_queue_semaphores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solid_queue_semaphores
    ADD CONSTRAINT solid_queue_semaphores_pkey PRIMARY KEY (id);


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
-- Name: idx_external_signals_location_gist; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_external_signals_location_gist ON public.external_signals USING gist (location);


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
-- Name: idx_sites_location_gist; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sites_location_gist ON public.sites USING gist (location);


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
-- Name: index_solid_cache_entries_on_byte_size; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_solid_cache_entries_on_byte_size ON public.solid_cache_entries USING btree (byte_size);


--
-- Name: index_solid_cache_entries_on_key_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_solid_cache_entries_on_key_hash ON public.solid_cache_entries USING btree (key_hash);


--
-- Name: index_solid_cache_entries_on_key_hash_and_byte_size; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_solid_cache_entries_on_key_hash_and_byte_size ON public.solid_cache_entries USING btree (key_hash, byte_size);


--
-- Name: index_solid_queue_blocked_executions_for_maintenance; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_solid_queue_blocked_executions_for_maintenance ON public.solid_queue_blocked_executions USING btree (expires_at, concurrency_key);


--
-- Name: index_solid_queue_blocked_executions_for_release; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_solid_queue_blocked_executions_for_release ON public.solid_queue_blocked_executions USING btree (concurrency_key, priority, job_id);


--
-- Name: index_solid_queue_blocked_executions_on_job_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_solid_queue_blocked_executions_on_job_id ON public.solid_queue_blocked_executions USING btree (job_id);


--
-- Name: index_solid_queue_claimed_executions_on_job_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_solid_queue_claimed_executions_on_job_id ON public.solid_queue_claimed_executions USING btree (job_id);


--
-- Name: index_solid_queue_claimed_executions_on_process_id_and_job_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_solid_queue_claimed_executions_on_process_id_and_job_id ON public.solid_queue_claimed_executions USING btree (process_id, job_id);


--
-- Name: index_solid_queue_dispatch_all; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_solid_queue_dispatch_all ON public.solid_queue_scheduled_executions USING btree (scheduled_at, priority, job_id);


--
-- Name: index_solid_queue_failed_executions_on_job_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_solid_queue_failed_executions_on_job_id ON public.solid_queue_failed_executions USING btree (job_id);


--
-- Name: index_solid_queue_jobs_for_alerting; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_solid_queue_jobs_for_alerting ON public.solid_queue_jobs USING btree (scheduled_at, finished_at);


--
-- Name: index_solid_queue_jobs_for_filtering; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_solid_queue_jobs_for_filtering ON public.solid_queue_jobs USING btree (queue_name, finished_at);


--
-- Name: index_solid_queue_jobs_on_active_job_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_solid_queue_jobs_on_active_job_id ON public.solid_queue_jobs USING btree (active_job_id);


--
-- Name: index_solid_queue_jobs_on_class_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_solid_queue_jobs_on_class_name ON public.solid_queue_jobs USING btree (class_name);


--
-- Name: index_solid_queue_jobs_on_finished_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_solid_queue_jobs_on_finished_at ON public.solid_queue_jobs USING btree (finished_at);


--
-- Name: index_solid_queue_pauses_on_queue_name; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_solid_queue_pauses_on_queue_name ON public.solid_queue_pauses USING btree (queue_name);


--
-- Name: index_solid_queue_poll_all; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_solid_queue_poll_all ON public.solid_queue_ready_executions USING btree (priority, job_id);


--
-- Name: index_solid_queue_poll_by_queue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_solid_queue_poll_by_queue ON public.solid_queue_ready_executions USING btree (queue_name, priority, job_id);


--
-- Name: index_solid_queue_processes_on_last_heartbeat_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_solid_queue_processes_on_last_heartbeat_at ON public.solid_queue_processes USING btree (last_heartbeat_at);


--
-- Name: index_solid_queue_processes_on_name_and_supervisor_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_solid_queue_processes_on_name_and_supervisor_id ON public.solid_queue_processes USING btree (name, supervisor_id);


--
-- Name: index_solid_queue_processes_on_supervisor_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_solid_queue_processes_on_supervisor_id ON public.solid_queue_processes USING btree (supervisor_id);


--
-- Name: index_solid_queue_ready_executions_on_job_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_solid_queue_ready_executions_on_job_id ON public.solid_queue_ready_executions USING btree (job_id);


--
-- Name: index_solid_queue_recurring_executions_on_job_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_solid_queue_recurring_executions_on_job_id ON public.solid_queue_recurring_executions USING btree (job_id);


--
-- Name: index_solid_queue_recurring_executions_on_task_key_and_run_at; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_solid_queue_recurring_executions_on_task_key_and_run_at ON public.solid_queue_recurring_executions USING btree (task_key, run_at);


--
-- Name: index_solid_queue_recurring_tasks_on_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_solid_queue_recurring_tasks_on_key ON public.solid_queue_recurring_tasks USING btree (key);


--
-- Name: index_solid_queue_recurring_tasks_on_static; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_solid_queue_recurring_tasks_on_static ON public.solid_queue_recurring_tasks USING btree (static);


--
-- Name: index_solid_queue_scheduled_executions_on_job_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_solid_queue_scheduled_executions_on_job_id ON public.solid_queue_scheduled_executions USING btree (job_id);


--
-- Name: index_solid_queue_semaphores_on_expires_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_solid_queue_semaphores_on_expires_at ON public.solid_queue_semaphores USING btree (expires_at);


--
-- Name: index_solid_queue_semaphores_on_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_solid_queue_semaphores_on_key ON public.solid_queue_semaphores USING btree (key);


--
-- Name: index_solid_queue_semaphores_on_key_and_value; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_solid_queue_semaphores_on_key_and_value ON public.solid_queue_semaphores USING btree (key, value);


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
-- Name: incident_notes incident_notes_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER incident_notes_immutable BEFORE UPDATE ON public.incident_notes FOR EACH ROW EXECUTE FUNCTION public.prevent_incident_note_update();


--
-- Name: incident_notes incident_notes_no_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER incident_notes_no_delete BEFORE DELETE ON public.incident_notes FOR EACH ROW EXECUTE FUNCTION public.prevent_incident_note_delete();


--
-- Name: external_signals trg_sync_external_signal_location; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_external_signal_location BEFORE INSERT OR UPDATE OF lat, lng ON public.external_signals FOR EACH ROW EXECUTE FUNCTION public.sync_external_signal_location();


--
-- Name: sites trg_sync_site_location; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_site_location BEFORE INSERT OR UPDATE OF latitude, longitude ON public.sites FOR EACH ROW EXECUTE FUNCTION public.sync_site_location();


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
-- Name: solid_queue_recurring_executions fk_rails_318a5533ed; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solid_queue_recurring_executions
    ADD CONSTRAINT fk_rails_318a5533ed FOREIGN KEY (job_id) REFERENCES public.solid_queue_jobs(id) ON DELETE CASCADE;


--
-- Name: solid_queue_failed_executions fk_rails_39bbc7a631; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solid_queue_failed_executions
    ADD CONSTRAINT fk_rails_39bbc7a631 FOREIGN KEY (job_id) REFERENCES public.solid_queue_jobs(id) ON DELETE CASCADE;


--
-- Name: solid_queue_blocked_executions fk_rails_4cd34e2228; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solid_queue_blocked_executions
    ADD CONSTRAINT fk_rails_4cd34e2228 FOREIGN KEY (job_id) REFERENCES public.solid_queue_jobs(id) ON DELETE CASCADE;


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
-- Name: incidents fk_rails_7d00d680b0; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incidents
    ADD CONSTRAINT fk_rails_7d00d680b0 FOREIGN KEY (site_id) REFERENCES public.sites(id);


--
-- Name: solid_queue_ready_executions fk_rails_81fcbd66af; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solid_queue_ready_executions
    ADD CONSTRAINT fk_rails_81fcbd66af FOREIGN KEY (job_id) REFERENCES public.solid_queue_jobs(id) ON DELETE CASCADE;


--
-- Name: assets fk_rails_905e385552; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assets
    ADD CONSTRAINT fk_rails_905e385552 FOREIGN KEY (home_site_id) REFERENCES public.sites(id);


--
-- Name: solid_queue_claimed_executions fk_rails_9cfe4d4944; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solid_queue_claimed_executions
    ADD CONSTRAINT fk_rails_9cfe4d4944 FOREIGN KEY (job_id) REFERENCES public.solid_queue_jobs(id) ON DELETE CASCADE;


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
-- Name: solid_queue_scheduled_executions fk_rails_c4316f352d; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solid_queue_scheduled_executions
    ADD CONSTRAINT fk_rails_c4316f352d FOREIGN KEY (job_id) REFERENCES public.solid_queue_jobs(id) ON DELETE CASCADE;


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


