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
-- Name: prevent_audit_event_delete(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_audit_event_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'audit_events are append-only — deletes are not permitted (see ADR-009 item 1, ADR-010)';
END;
$$;


--
-- Name: prevent_audit_event_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_audit_event_update() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'audit_events are immutable — updates are not permitted (see ADR-009 item 1, ADR-010)';
END;
$$;


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
    NEW.location := ST_SetSRID(
      ST_MakePoint(NEW.lng::double precision, NEW.lat::double precision), 4326
    );
  END IF;
  RETURN NEW;
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
    organization_id uuid,
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
    after_workflow_status text GENERATED ALWAYS AS ((after_snapshot ->> 'workflow_status'::text)) STORED,
    organization_id uuid,
    sequence bigint NOT NULL,
    chain_position bigint NOT NULL,
    prev_hash bytea NOT NULL,
    row_hash bytea NOT NULL,
    hash_version smallint DEFAULT 1 NOT NULL
);


--
-- Name: audit_events_sequence_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.audit_events_sequence_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: audit_events_sequence_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.audit_events_sequence_seq OWNED BY public.audit_events.sequence;


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
    assigned_at timestamp(6) without time zone,
    prosecution_phase character varying,
    prosecuted_by_id uuid,
    prosecution_initiated_at timestamp(6) without time zone
);


--
-- Name: ingestion_cursors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ingestion_cursors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying NOT NULL,
    last_ingested_at timestamp(6) without time zone NOT NULL,
    last_signal_id uuid,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: mfa_recovery_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mfa_recovery_codes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    code_hash text NOT NULL,
    used_at timestamp(6) without time zone,
    created_at timestamp(6) without time zone NOT NULL
);


--
-- Name: operational_statuses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.operational_statuses (
    id bigint NOT NULL,
    category character varying NOT NULL,
    key character varying NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


--
-- Name: operational_statuses_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.operational_statuses_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: operational_statuses_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.operational_statuses_id_seq OWNED BY public.operational_statuses.id;


--
-- Name: organizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organizations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying NOT NULL,
    slug character varying NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
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
-- Name: prosecution_steps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prosecution_steps (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    incident_id uuid NOT NULL,
    actor_id uuid NOT NULL,
    phase character varying NOT NULL,
    action_type character varying NOT NULL,
    notes text,
    evidence_refs jsonb DEFAULT '{}'::jsonb NOT NULL,
    occurred_at timestamp(6) without time zone DEFAULT now() NOT NULL,
    created_at timestamp(6) without time zone DEFAULT now() NOT NULL
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
-- Name: revoked_jwts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.revoked_jwts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    jti character varying NOT NULL,
    expires_at timestamp(6) without time zone NOT NULL,
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
    incident_id uuid,
    created_at timestamp(6) without time zone DEFAULT now() NOT NULL,
    updated_at timestamp(6) without time zone DEFAULT now() NOT NULL
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
    organization_id uuid,
    honeytoken boolean DEFAULT false NOT NULL
);


--
-- Name: sse_stream_leases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sse_stream_leases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    stream_name character varying NOT NULL,
    remote_ip character varying NOT NULL,
    lease_key character varying NOT NULL,
    expires_at timestamp(6) without time zone NOT NULL,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
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
-- Name: telemetry_readings_p20260401; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telemetry_readings_p20260401 (
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
-- Name: telemetry_readings_p20260402; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telemetry_readings_p20260402 (
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
-- Name: telemetry_readings_p20260403; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telemetry_readings_p20260403 (
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
-- Name: telemetry_readings_p20260404; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telemetry_readings_p20260404 (
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
-- Name: telemetry_readings_p20260405; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telemetry_readings_p20260405 (
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
-- Name: telemetry_readings_p20260406; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telemetry_readings_p20260406 (
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
-- Name: telemetry_readings_p20260407; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telemetry_readings_p20260407 (
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
-- Name: telemetry_readings_p20260408; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telemetry_readings_p20260408 (
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
-- Name: telemetry_readings_p20260409; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telemetry_readings_p20260409 (
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
-- Name: telemetry_readings_p20260410; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telemetry_readings_p20260410 (
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
-- Name: telemetry_readings_p20260411; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telemetry_readings_p20260411 (
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
-- Name: telemetry_readings_p20260412; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telemetry_readings_p20260412 (
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
-- Name: telemetry_readings_p20260413; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telemetry_readings_p20260413 (
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
-- Name: telemetry_readings_p20260414; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telemetry_readings_p20260414 (
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
-- Name: telemetry_readings_p20260415; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telemetry_readings_p20260415 (
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
-- Name: telemetry_readings_p20260416; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telemetry_readings_p20260416 (
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
-- Name: telemetry_readings_p20260417; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telemetry_readings_p20260417 (
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
-- Name: telemetry_readings_p20260418; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telemetry_readings_p20260418 (
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
-- Name: telemetry_readings_p20260419; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telemetry_readings_p20260419 (
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
-- Name: telemetry_readings_p20260422; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telemetry_readings_p20260422 (
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
-- Name: telemetry_readings_p20260423; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telemetry_readings_p20260423 (
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
-- Name: telemetry_readings_p20260424; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telemetry_readings_p20260424 (
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
-- Name: telemetry_readings_p20260425; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telemetry_readings_p20260425 (
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
-- Name: telemetry_readings_p20260426; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telemetry_readings_p20260426 (
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
-- Name: telemetry_readings_p20260427; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telemetry_readings_p20260427 (
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
-- Name: telemetry_readings_p20260428; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telemetry_readings_p20260428 (
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
-- Name: telemetry_readings_p20260429; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telemetry_readings_p20260429 (
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
-- Name: user_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    jti character varying NOT NULL,
    user_agent character varying,
    ip_address character varying,
    last_seen_at timestamp(6) without time zone NOT NULL,
    expires_at timestamp(6) without time zone NOT NULL,
    revoked_at timestamp(6) without time zone,
    revoked_by_id uuid,
    revoke_reason character varying,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
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
    tokens_valid_after timestamp(6) without time zone,
    area_of_operation_id uuid,
    organization_id uuid,
    totp_secret_ciphertext bytea,
    totp_enabled_at timestamp(6) without time zone,
    totp_last_used_at timestamp(6) without time zone,
    CONSTRAINT users_role_check CHECK (((role)::text = ANY (ARRAY[('viewer'::character varying)::text, ('operator'::character varying)::text, ('commander'::character varying)::text, ('admin'::character varying)::text])))
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
-- Name: telemetry_readings_p20260401; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemetry_readings ATTACH PARTITION public.telemetry_readings_p20260401 FOR VALUES FROM ('2026-04-01 00:00:00') TO ('2026-04-02 00:00:00');


--
-- Name: telemetry_readings_p20260402; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemetry_readings ATTACH PARTITION public.telemetry_readings_p20260402 FOR VALUES FROM ('2026-04-02 00:00:00') TO ('2026-04-03 00:00:00');


--
-- Name: telemetry_readings_p20260403; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemetry_readings ATTACH PARTITION public.telemetry_readings_p20260403 FOR VALUES FROM ('2026-04-03 00:00:00') TO ('2026-04-04 00:00:00');


--
-- Name: telemetry_readings_p20260404; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemetry_readings ATTACH PARTITION public.telemetry_readings_p20260404 FOR VALUES FROM ('2026-04-04 00:00:00') TO ('2026-04-05 00:00:00');


--
-- Name: telemetry_readings_p20260405; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemetry_readings ATTACH PARTITION public.telemetry_readings_p20260405 FOR VALUES FROM ('2026-04-05 00:00:00') TO ('2026-04-06 00:00:00');


--
-- Name: telemetry_readings_p20260406; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemetry_readings ATTACH PARTITION public.telemetry_readings_p20260406 FOR VALUES FROM ('2026-04-06 00:00:00') TO ('2026-04-07 00:00:00');


--
-- Name: telemetry_readings_p20260407; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemetry_readings ATTACH PARTITION public.telemetry_readings_p20260407 FOR VALUES FROM ('2026-04-07 00:00:00') TO ('2026-04-08 00:00:00');


--
-- Name: telemetry_readings_p20260408; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemetry_readings ATTACH PARTITION public.telemetry_readings_p20260408 FOR VALUES FROM ('2026-04-08 00:00:00') TO ('2026-04-09 00:00:00');


--
-- Name: telemetry_readings_p20260409; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemetry_readings ATTACH PARTITION public.telemetry_readings_p20260409 FOR VALUES FROM ('2026-04-09 00:00:00') TO ('2026-04-10 00:00:00');


--
-- Name: telemetry_readings_p20260410; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemetry_readings ATTACH PARTITION public.telemetry_readings_p20260410 FOR VALUES FROM ('2026-04-10 00:00:00') TO ('2026-04-11 00:00:00');


--
-- Name: telemetry_readings_p20260411; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemetry_readings ATTACH PARTITION public.telemetry_readings_p20260411 FOR VALUES FROM ('2026-04-11 00:00:00') TO ('2026-04-12 00:00:00');


--
-- Name: telemetry_readings_p20260412; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemetry_readings ATTACH PARTITION public.telemetry_readings_p20260412 FOR VALUES FROM ('2026-04-12 00:00:00') TO ('2026-04-13 00:00:00');


--
-- Name: telemetry_readings_p20260413; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemetry_readings ATTACH PARTITION public.telemetry_readings_p20260413 FOR VALUES FROM ('2026-04-13 00:00:00') TO ('2026-04-14 00:00:00');


--
-- Name: telemetry_readings_p20260414; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemetry_readings ATTACH PARTITION public.telemetry_readings_p20260414 FOR VALUES FROM ('2026-04-14 00:00:00') TO ('2026-04-15 00:00:00');


--
-- Name: telemetry_readings_p20260415; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemetry_readings ATTACH PARTITION public.telemetry_readings_p20260415 FOR VALUES FROM ('2026-04-15 00:00:00') TO ('2026-04-16 00:00:00');


--
-- Name: telemetry_readings_p20260416; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemetry_readings ATTACH PARTITION public.telemetry_readings_p20260416 FOR VALUES FROM ('2026-04-16 00:00:00') TO ('2026-04-17 00:00:00');


--
-- Name: telemetry_readings_p20260417; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemetry_readings ATTACH PARTITION public.telemetry_readings_p20260417 FOR VALUES FROM ('2026-04-17 00:00:00') TO ('2026-04-18 00:00:00');


--
-- Name: telemetry_readings_p20260418; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemetry_readings ATTACH PARTITION public.telemetry_readings_p20260418 FOR VALUES FROM ('2026-04-18 00:00:00') TO ('2026-04-19 00:00:00');


--
-- Name: telemetry_readings_p20260419; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemetry_readings ATTACH PARTITION public.telemetry_readings_p20260419 FOR VALUES FROM ('2026-04-19 00:00:00') TO ('2026-04-20 00:00:00');


--
-- Name: telemetry_readings_p20260422; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemetry_readings ATTACH PARTITION public.telemetry_readings_p20260422 FOR VALUES FROM ('2026-04-22 00:00:00') TO ('2026-04-23 00:00:00');


--
-- Name: telemetry_readings_p20260423; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemetry_readings ATTACH PARTITION public.telemetry_readings_p20260423 FOR VALUES FROM ('2026-04-23 00:00:00') TO ('2026-04-24 00:00:00');


--
-- Name: telemetry_readings_p20260424; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemetry_readings ATTACH PARTITION public.telemetry_readings_p20260424 FOR VALUES FROM ('2026-04-24 00:00:00') TO ('2026-04-25 00:00:00');


--
-- Name: telemetry_readings_p20260425; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemetry_readings ATTACH PARTITION public.telemetry_readings_p20260425 FOR VALUES FROM ('2026-04-25 00:00:00') TO ('2026-04-26 00:00:00');


--
-- Name: telemetry_readings_p20260426; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemetry_readings ATTACH PARTITION public.telemetry_readings_p20260426 FOR VALUES FROM ('2026-04-26 00:00:00') TO ('2026-04-27 00:00:00');


--
-- Name: telemetry_readings_p20260427; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemetry_readings ATTACH PARTITION public.telemetry_readings_p20260427 FOR VALUES FROM ('2026-04-27 00:00:00') TO ('2026-04-28 00:00:00');


--
-- Name: telemetry_readings_p20260428; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemetry_readings ATTACH PARTITION public.telemetry_readings_p20260428 FOR VALUES FROM ('2026-04-28 00:00:00') TO ('2026-04-29 00:00:00');


--
-- Name: telemetry_readings_p20260429; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemetry_readings ATTACH PARTITION public.telemetry_readings_p20260429 FOR VALUES FROM ('2026-04-29 00:00:00') TO ('2026-04-30 00:00:00');


--
-- Name: audit_events sequence; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_events ALTER COLUMN sequence SET DEFAULT nextval('public.audit_events_sequence_seq'::regclass);


--
-- Name: operational_statuses id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operational_statuses ALTER COLUMN id SET DEFAULT nextval('public.operational_statuses_id_seq'::regclass);


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
-- Name: ingestion_cursors ingestion_cursors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ingestion_cursors
    ADD CONSTRAINT ingestion_cursors_pkey PRIMARY KEY (id);


--
-- Name: mfa_recovery_codes mfa_recovery_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mfa_recovery_codes
    ADD CONSTRAINT mfa_recovery_codes_pkey PRIMARY KEY (id);


--
-- Name: operational_statuses operational_statuses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operational_statuses
    ADD CONSTRAINT operational_statuses_pkey PRIMARY KEY (id);


--
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);


--
-- Name: pace_plans pace_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pace_plans
    ADD CONSTRAINT pace_plans_pkey PRIMARY KEY (id);


--
-- Name: prosecution_steps prosecution_steps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prosecution_steps
    ADD CONSTRAINT prosecution_steps_pkey PRIMARY KEY (id);


--
-- Name: recommendations recommendations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recommendations
    ADD CONSTRAINT recommendations_pkey PRIMARY KEY (id);


--
-- Name: revoked_jwts revoked_jwts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.revoked_jwts
    ADD CONSTRAINT revoked_jwts_pkey PRIMARY KEY (id);


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
-- Name: sse_stream_leases sse_stream_leases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sse_stream_leases
    ADD CONSTRAINT sse_stream_leases_pkey PRIMARY KEY (id);


--
-- Name: tasks tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_pkey PRIMARY KEY (id);


--
-- Name: user_sessions user_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_sessions
    ADD CONSTRAINT user_sessions_pkey PRIMARY KEY (id);


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
-- Name: idx_audit_events_chain_position_scoped; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_audit_events_chain_position_scoped ON public.audit_events USING btree (organization_id, chain_position) WHERE (organization_id IS NOT NULL);


--
-- Name: idx_audit_events_chain_position_unscoped; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_audit_events_chain_position_unscoped ON public.audit_events USING btree (chain_position) WHERE (organization_id IS NULL);


--
-- Name: idx_external_signals_location_gist; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_external_signals_location_gist ON public.external_signals USING gist (location);


--
-- Name: idx_geofence_breach_signal_site_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_geofence_breach_signal_site_unique ON public.signal_rule_matches USING btree (signal_id, site_id) WHERE (correlation_rule_id IS NULL);


--
-- Name: idx_incidents_active_prosecution; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_incidents_active_prosecution ON public.incidents USING btree (prosecution_phase) WHERE (prosecution_phase IS NOT NULL);


--
-- Name: idx_mfa_recovery_codes_active_per_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mfa_recovery_codes_active_per_user ON public.mfa_recovery_codes USING btree (user_id, used_at) WHERE (used_at IS NULL);


--
-- Name: idx_on_entity_type_entity_id_occurred_at_dfd7f189aa; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_on_entity_type_entity_id_occurred_at_dfd7f189aa ON public.audit_events USING btree (entity_type, entity_id, occurred_at);


--
-- Name: idx_operational_statuses_category_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_operational_statuses_category_key ON public.operational_statuses USING btree (category, key);


--
-- Name: idx_prosecution_steps_incident_phase; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prosecution_steps_incident_phase ON public.prosecution_steps USING btree (incident_id, phase);


--
-- Name: idx_prosecution_steps_incident_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prosecution_steps_incident_time ON public.prosecution_steps USING btree (incident_id, occurred_at);


--
-- Name: idx_recommendations_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_recommendations_entity ON public.recommendations USING btree (affected_entity_type, affected_entity_id);


--
-- Name: idx_recommendations_pending_dedup; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_recommendations_pending_dedup ON public.recommendations USING btree (recommendation_type, affected_entity_type, affected_entity_id) WHERE ((status)::text = 'pending'::text);


--
-- Name: idx_rule_match_signal_rule_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_rule_match_signal_rule_unique ON public.signal_rule_matches USING btree (signal_id, correlation_rule_id) WHERE (correlation_rule_id IS NOT NULL);


--
-- Name: idx_sse_stream_leases_ip_expiry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sse_stream_leases_ip_expiry ON public.sse_stream_leases USING btree (remote_ip, expires_at);


--
-- Name: idx_sse_stream_leases_lease_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_sse_stream_leases_lease_key ON public.sse_stream_leases USING btree (lease_key);


--
-- Name: idx_sse_stream_leases_stream_expiry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sse_stream_leases_stream_expiry ON public.sse_stream_leases USING btree (stream_name, expires_at);


--
-- Name: idx_sse_stream_leases_user_expiry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sse_stream_leases_user_expiry ON public.sse_stream_leases USING btree (user_id, expires_at);


--
-- Name: index_ao_on_threat_level; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_ao_on_threat_level ON public.areas_of_operation USING btree (threat_level);


--
-- Name: index_areas_of_operation_on_created_by_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_areas_of_operation_on_created_by_id ON public.areas_of_operation USING btree (created_by_id);


--
-- Name: index_areas_of_operation_on_organization_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_areas_of_operation_on_organization_id ON public.areas_of_operation USING btree (organization_id);


--
-- Name: index_areas_of_operation_on_organization_id_and_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_areas_of_operation_on_organization_id_and_name ON public.areas_of_operation USING btree (organization_id, name);


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
-- Name: index_audit_events_on_organization_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_audit_events_on_organization_id ON public.audit_events USING btree (organization_id) WHERE (organization_id IS NOT NULL);


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
-- Name: index_incidents_fusion_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_incidents_fusion_lookup ON public.incidents USING btree (site_id, status, updated_at) WHERE ((status)::text = ANY (ARRAY[('open'::character varying)::text, ('acknowledged'::character varying)::text]));


--
-- Name: index_incidents_on_area_of_operation_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_incidents_on_area_of_operation_id ON public.incidents USING btree (area_of_operation_id);


--
-- Name: index_incidents_on_assigned_to_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_incidents_on_assigned_to_id ON public.incidents USING btree (assigned_to_id);


--
-- Name: index_incidents_on_opened_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_incidents_on_opened_at ON public.incidents USING btree (opened_at);


--
-- Name: index_incidents_on_prosecuted_by_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_incidents_on_prosecuted_by_id ON public.incidents USING btree (prosecuted_by_id);


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
-- Name: index_ingestion_cursors_on_name_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_ingestion_cursors_on_name_unique ON public.ingestion_cursors USING btree (name);


--
-- Name: index_mfa_recovery_codes_on_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_mfa_recovery_codes_on_user_id ON public.mfa_recovery_codes USING btree (user_id);


--
-- Name: index_organizations_on_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_organizations_on_slug ON public.organizations USING btree (slug);


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
-- Name: index_prosecution_steps_on_actor_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_prosecution_steps_on_actor_id ON public.prosecution_steps USING btree (actor_id);


--
-- Name: index_prosecution_steps_on_incident_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_prosecution_steps_on_incident_id ON public.prosecution_steps USING btree (incident_id);


--
-- Name: index_recommendations_on_expires_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_recommendations_on_expires_at ON public.recommendations USING btree (expires_at);


--
-- Name: index_recommendations_on_recommendation_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_recommendations_on_recommendation_type ON public.recommendations USING btree (recommendation_type);


--
-- Name: index_recommendations_on_reviewed_by_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_recommendations_on_reviewed_by_id ON public.recommendations USING btree (reviewed_by_id);


--
-- Name: index_recommendations_on_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_recommendations_on_status ON public.recommendations USING btree (status);


--
-- Name: index_revoked_jwts_on_expires_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_revoked_jwts_on_expires_at ON public.revoked_jwts USING btree (expires_at);


--
-- Name: index_revoked_jwts_on_jti; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_revoked_jwts_on_jti ON public.revoked_jwts USING btree (jti);


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
-- Name: index_sites_on_organization_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_sites_on_organization_id ON public.sites USING btree (organization_id);


--
-- Name: index_sites_on_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_sites_on_status ON public.sites USING btree (status);


--
-- Name: index_sse_stream_leases_on_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_sse_stream_leases_on_user_id ON public.sse_stream_leases USING btree (user_id);


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
-- Name: index_user_sessions_on_expires_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_user_sessions_on_expires_at ON public.user_sessions USING btree (expires_at);


--
-- Name: index_user_sessions_on_jti; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_user_sessions_on_jti ON public.user_sessions USING btree (jti);


--
-- Name: index_user_sessions_on_revoked_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_user_sessions_on_revoked_at ON public.user_sessions USING btree (revoked_at);


--
-- Name: index_user_sessions_on_revoked_by_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_user_sessions_on_revoked_by_id ON public.user_sessions USING btree (revoked_by_id);


--
-- Name: index_user_sessions_on_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_user_sessions_on_user_id ON public.user_sessions USING btree (user_id);


--
-- Name: index_user_sessions_on_user_id_and_last_seen_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_user_sessions_on_user_id_and_last_seen_at ON public.user_sessions USING btree (user_id, last_seen_at);


--
-- Name: index_users_on_area_of_operation_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_users_on_area_of_operation_id ON public.users USING btree (area_of_operation_id);


--
-- Name: index_users_on_email; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX index_users_on_email ON public.users USING btree (email);


--
-- Name: index_users_on_organization_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX index_users_on_organization_id ON public.users USING btree (organization_id);


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
-- Name: telemetry_readings_p20260401_asset_id_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_readings_p20260401_asset_id_occurred_at_idx ON public.telemetry_readings_p20260401 USING btree (asset_id, occurred_at DESC);


--
-- Name: telemetry_readings_p20260401_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_readings_p20260401_occurred_at_idx ON public.telemetry_readings_p20260401 USING brin (occurred_at);


--
-- Name: telemetry_readings_p20260402_asset_id_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_readings_p20260402_asset_id_occurred_at_idx ON public.telemetry_readings_p20260402 USING btree (asset_id, occurred_at DESC);


--
-- Name: telemetry_readings_p20260402_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_readings_p20260402_occurred_at_idx ON public.telemetry_readings_p20260402 USING brin (occurred_at);


--
-- Name: telemetry_readings_p20260403_asset_id_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_readings_p20260403_asset_id_occurred_at_idx ON public.telemetry_readings_p20260403 USING btree (asset_id, occurred_at DESC);


--
-- Name: telemetry_readings_p20260403_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_readings_p20260403_occurred_at_idx ON public.telemetry_readings_p20260403 USING brin (occurred_at);


--
-- Name: telemetry_readings_p20260404_asset_id_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_readings_p20260404_asset_id_occurred_at_idx ON public.telemetry_readings_p20260404 USING btree (asset_id, occurred_at DESC);


--
-- Name: telemetry_readings_p20260404_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_readings_p20260404_occurred_at_idx ON public.telemetry_readings_p20260404 USING brin (occurred_at);


--
-- Name: telemetry_readings_p20260405_asset_id_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_readings_p20260405_asset_id_occurred_at_idx ON public.telemetry_readings_p20260405 USING btree (asset_id, occurred_at DESC);


--
-- Name: telemetry_readings_p20260405_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_readings_p20260405_occurred_at_idx ON public.telemetry_readings_p20260405 USING brin (occurred_at);


--
-- Name: telemetry_readings_p20260406_asset_id_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_readings_p20260406_asset_id_occurred_at_idx ON public.telemetry_readings_p20260406 USING btree (asset_id, occurred_at DESC);


--
-- Name: telemetry_readings_p20260406_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_readings_p20260406_occurred_at_idx ON public.telemetry_readings_p20260406 USING brin (occurred_at);


--
-- Name: telemetry_readings_p20260407_asset_id_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_readings_p20260407_asset_id_occurred_at_idx ON public.telemetry_readings_p20260407 USING btree (asset_id, occurred_at DESC);


--
-- Name: telemetry_readings_p20260407_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_readings_p20260407_occurred_at_idx ON public.telemetry_readings_p20260407 USING brin (occurred_at);


--
-- Name: telemetry_readings_p20260408_asset_id_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_readings_p20260408_asset_id_occurred_at_idx ON public.telemetry_readings_p20260408 USING btree (asset_id, occurred_at DESC);


--
-- Name: telemetry_readings_p20260408_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_readings_p20260408_occurred_at_idx ON public.telemetry_readings_p20260408 USING brin (occurred_at);


--
-- Name: telemetry_readings_p20260409_asset_id_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_readings_p20260409_asset_id_occurred_at_idx ON public.telemetry_readings_p20260409 USING btree (asset_id, occurred_at DESC);


--
-- Name: telemetry_readings_p20260409_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_readings_p20260409_occurred_at_idx ON public.telemetry_readings_p20260409 USING brin (occurred_at);


--
-- Name: telemetry_readings_p20260410_asset_id_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_readings_p20260410_asset_id_occurred_at_idx ON public.telemetry_readings_p20260410 USING btree (asset_id, occurred_at DESC);


--
-- Name: telemetry_readings_p20260410_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_readings_p20260410_occurred_at_idx ON public.telemetry_readings_p20260410 USING brin (occurred_at);


--
-- Name: telemetry_readings_p20260411_asset_id_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_readings_p20260411_asset_id_occurred_at_idx ON public.telemetry_readings_p20260411 USING btree (asset_id, occurred_at DESC);


--
-- Name: telemetry_readings_p20260411_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_readings_p20260411_occurred_at_idx ON public.telemetry_readings_p20260411 USING brin (occurred_at);


--
-- Name: telemetry_readings_p20260412_asset_id_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_readings_p20260412_asset_id_occurred_at_idx ON public.telemetry_readings_p20260412 USING btree (asset_id, occurred_at DESC);


--
-- Name: telemetry_readings_p20260412_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_readings_p20260412_occurred_at_idx ON public.telemetry_readings_p20260412 USING brin (occurred_at);


--
-- Name: telemetry_readings_p20260413_asset_id_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_readings_p20260413_asset_id_occurred_at_idx ON public.telemetry_readings_p20260413 USING btree (asset_id, occurred_at DESC);


--
-- Name: telemetry_readings_p20260413_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_readings_p20260413_occurred_at_idx ON public.telemetry_readings_p20260413 USING brin (occurred_at);


--
-- Name: telemetry_readings_p20260414_asset_id_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_readings_p20260414_asset_id_occurred_at_idx ON public.telemetry_readings_p20260414 USING btree (asset_id, occurred_at DESC);


--
-- Name: telemetry_readings_p20260414_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_readings_p20260414_occurred_at_idx ON public.telemetry_readings_p20260414 USING brin (occurred_at);


--
-- Name: telemetry_readings_p20260415_asset_id_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_readings_p20260415_asset_id_occurred_at_idx ON public.telemetry_readings_p20260415 USING btree (asset_id, occurred_at DESC);


--
-- Name: telemetry_readings_p20260415_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_readings_p20260415_occurred_at_idx ON public.telemetry_readings_p20260415 USING brin (occurred_at);


--
-- Name: telemetry_readings_p20260416_asset_id_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_readings_p20260416_asset_id_occurred_at_idx ON public.telemetry_readings_p20260416 USING btree (asset_id, occurred_at DESC);


--
-- Name: telemetry_readings_p20260416_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_readings_p20260416_occurred_at_idx ON public.telemetry_readings_p20260416 USING brin (occurred_at);


--
-- Name: telemetry_readings_p20260417_asset_id_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_readings_p20260417_asset_id_occurred_at_idx ON public.telemetry_readings_p20260417 USING btree (asset_id, occurred_at DESC);


--
-- Name: telemetry_readings_p20260417_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_readings_p20260417_occurred_at_idx ON public.telemetry_readings_p20260417 USING brin (occurred_at);


--
-- Name: telemetry_readings_p20260418_asset_id_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_readings_p20260418_asset_id_occurred_at_idx ON public.telemetry_readings_p20260418 USING btree (asset_id, occurred_at DESC);


--
-- Name: telemetry_readings_p20260418_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_readings_p20260418_occurred_at_idx ON public.telemetry_readings_p20260418 USING brin (occurred_at);


--
-- Name: telemetry_readings_p20260419_asset_id_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_readings_p20260419_asset_id_occurred_at_idx ON public.telemetry_readings_p20260419 USING btree (asset_id, occurred_at DESC);


--
-- Name: telemetry_readings_p20260419_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_readings_p20260419_occurred_at_idx ON public.telemetry_readings_p20260419 USING brin (occurred_at);


--
-- Name: telemetry_readings_p20260422_asset_id_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_readings_p20260422_asset_id_occurred_at_idx ON public.telemetry_readings_p20260422 USING btree (asset_id, occurred_at DESC);


--
-- Name: telemetry_readings_p20260422_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_readings_p20260422_occurred_at_idx ON public.telemetry_readings_p20260422 USING brin (occurred_at);


--
-- Name: telemetry_readings_p20260423_asset_id_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_readings_p20260423_asset_id_occurred_at_idx ON public.telemetry_readings_p20260423 USING btree (asset_id, occurred_at DESC);


--
-- Name: telemetry_readings_p20260423_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_readings_p20260423_occurred_at_idx ON public.telemetry_readings_p20260423 USING brin (occurred_at);


--
-- Name: telemetry_readings_p20260424_asset_id_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_readings_p20260424_asset_id_occurred_at_idx ON public.telemetry_readings_p20260424 USING btree (asset_id, occurred_at DESC);


--
-- Name: telemetry_readings_p20260424_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_readings_p20260424_occurred_at_idx ON public.telemetry_readings_p20260424 USING brin (occurred_at);


--
-- Name: telemetry_readings_p20260425_asset_id_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_readings_p20260425_asset_id_occurred_at_idx ON public.telemetry_readings_p20260425 USING btree (asset_id, occurred_at DESC);


--
-- Name: telemetry_readings_p20260425_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_readings_p20260425_occurred_at_idx ON public.telemetry_readings_p20260425 USING brin (occurred_at);


--
-- Name: telemetry_readings_p20260426_asset_id_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_readings_p20260426_asset_id_occurred_at_idx ON public.telemetry_readings_p20260426 USING btree (asset_id, occurred_at DESC);


--
-- Name: telemetry_readings_p20260426_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_readings_p20260426_occurred_at_idx ON public.telemetry_readings_p20260426 USING brin (occurred_at);


--
-- Name: telemetry_readings_p20260427_asset_id_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_readings_p20260427_asset_id_occurred_at_idx ON public.telemetry_readings_p20260427 USING btree (asset_id, occurred_at DESC);


--
-- Name: telemetry_readings_p20260427_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_readings_p20260427_occurred_at_idx ON public.telemetry_readings_p20260427 USING brin (occurred_at);


--
-- Name: telemetry_readings_p20260428_asset_id_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_readings_p20260428_asset_id_occurred_at_idx ON public.telemetry_readings_p20260428 USING btree (asset_id, occurred_at DESC);


--
-- Name: telemetry_readings_p20260428_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_readings_p20260428_occurred_at_idx ON public.telemetry_readings_p20260428 USING brin (occurred_at);


--
-- Name: telemetry_readings_p20260429_asset_id_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_readings_p20260429_asset_id_occurred_at_idx ON public.telemetry_readings_p20260429 USING btree (asset_id, occurred_at DESC);


--
-- Name: telemetry_readings_p20260429_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_readings_p20260429_occurred_at_idx ON public.telemetry_readings_p20260429 USING brin (occurred_at);


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
-- Name: telemetry_readings_p20260401_asset_id_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.index_telemetry_readings_on_asset_id_and_occurred_at ATTACH PARTITION public.telemetry_readings_p20260401_asset_id_occurred_at_idx;


--
-- Name: telemetry_readings_p20260401_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.index_telemetry_readings_on_occurred_at ATTACH PARTITION public.telemetry_readings_p20260401_occurred_at_idx;


--
-- Name: telemetry_readings_p20260402_asset_id_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.index_telemetry_readings_on_asset_id_and_occurred_at ATTACH PARTITION public.telemetry_readings_p20260402_asset_id_occurred_at_idx;


--
-- Name: telemetry_readings_p20260402_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.index_telemetry_readings_on_occurred_at ATTACH PARTITION public.telemetry_readings_p20260402_occurred_at_idx;


--
-- Name: telemetry_readings_p20260403_asset_id_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.index_telemetry_readings_on_asset_id_and_occurred_at ATTACH PARTITION public.telemetry_readings_p20260403_asset_id_occurred_at_idx;


--
-- Name: telemetry_readings_p20260403_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.index_telemetry_readings_on_occurred_at ATTACH PARTITION public.telemetry_readings_p20260403_occurred_at_idx;


--
-- Name: telemetry_readings_p20260404_asset_id_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.index_telemetry_readings_on_asset_id_and_occurred_at ATTACH PARTITION public.telemetry_readings_p20260404_asset_id_occurred_at_idx;


--
-- Name: telemetry_readings_p20260404_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.index_telemetry_readings_on_occurred_at ATTACH PARTITION public.telemetry_readings_p20260404_occurred_at_idx;


--
-- Name: telemetry_readings_p20260405_asset_id_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.index_telemetry_readings_on_asset_id_and_occurred_at ATTACH PARTITION public.telemetry_readings_p20260405_asset_id_occurred_at_idx;


--
-- Name: telemetry_readings_p20260405_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.index_telemetry_readings_on_occurred_at ATTACH PARTITION public.telemetry_readings_p20260405_occurred_at_idx;


--
-- Name: telemetry_readings_p20260406_asset_id_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.index_telemetry_readings_on_asset_id_and_occurred_at ATTACH PARTITION public.telemetry_readings_p20260406_asset_id_occurred_at_idx;


--
-- Name: telemetry_readings_p20260406_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.index_telemetry_readings_on_occurred_at ATTACH PARTITION public.telemetry_readings_p20260406_occurred_at_idx;


--
-- Name: telemetry_readings_p20260407_asset_id_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.index_telemetry_readings_on_asset_id_and_occurred_at ATTACH PARTITION public.telemetry_readings_p20260407_asset_id_occurred_at_idx;


--
-- Name: telemetry_readings_p20260407_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.index_telemetry_readings_on_occurred_at ATTACH PARTITION public.telemetry_readings_p20260407_occurred_at_idx;


--
-- Name: telemetry_readings_p20260408_asset_id_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.index_telemetry_readings_on_asset_id_and_occurred_at ATTACH PARTITION public.telemetry_readings_p20260408_asset_id_occurred_at_idx;


--
-- Name: telemetry_readings_p20260408_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.index_telemetry_readings_on_occurred_at ATTACH PARTITION public.telemetry_readings_p20260408_occurred_at_idx;


--
-- Name: telemetry_readings_p20260409_asset_id_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.index_telemetry_readings_on_asset_id_and_occurred_at ATTACH PARTITION public.telemetry_readings_p20260409_asset_id_occurred_at_idx;


--
-- Name: telemetry_readings_p20260409_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.index_telemetry_readings_on_occurred_at ATTACH PARTITION public.telemetry_readings_p20260409_occurred_at_idx;


--
-- Name: telemetry_readings_p20260410_asset_id_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.index_telemetry_readings_on_asset_id_and_occurred_at ATTACH PARTITION public.telemetry_readings_p20260410_asset_id_occurred_at_idx;


--
-- Name: telemetry_readings_p20260410_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.index_telemetry_readings_on_occurred_at ATTACH PARTITION public.telemetry_readings_p20260410_occurred_at_idx;


--
-- Name: telemetry_readings_p20260411_asset_id_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.index_telemetry_readings_on_asset_id_and_occurred_at ATTACH PARTITION public.telemetry_readings_p20260411_asset_id_occurred_at_idx;


--
-- Name: telemetry_readings_p20260411_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.index_telemetry_readings_on_occurred_at ATTACH PARTITION public.telemetry_readings_p20260411_occurred_at_idx;


--
-- Name: telemetry_readings_p20260412_asset_id_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.index_telemetry_readings_on_asset_id_and_occurred_at ATTACH PARTITION public.telemetry_readings_p20260412_asset_id_occurred_at_idx;


--
-- Name: telemetry_readings_p20260412_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.index_telemetry_readings_on_occurred_at ATTACH PARTITION public.telemetry_readings_p20260412_occurred_at_idx;


--
-- Name: telemetry_readings_p20260413_asset_id_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.index_telemetry_readings_on_asset_id_and_occurred_at ATTACH PARTITION public.telemetry_readings_p20260413_asset_id_occurred_at_idx;


--
-- Name: telemetry_readings_p20260413_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.index_telemetry_readings_on_occurred_at ATTACH PARTITION public.telemetry_readings_p20260413_occurred_at_idx;


--
-- Name: telemetry_readings_p20260414_asset_id_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.index_telemetry_readings_on_asset_id_and_occurred_at ATTACH PARTITION public.telemetry_readings_p20260414_asset_id_occurred_at_idx;


--
-- Name: telemetry_readings_p20260414_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.index_telemetry_readings_on_occurred_at ATTACH PARTITION public.telemetry_readings_p20260414_occurred_at_idx;


--
-- Name: telemetry_readings_p20260415_asset_id_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.index_telemetry_readings_on_asset_id_and_occurred_at ATTACH PARTITION public.telemetry_readings_p20260415_asset_id_occurred_at_idx;


--
-- Name: telemetry_readings_p20260415_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.index_telemetry_readings_on_occurred_at ATTACH PARTITION public.telemetry_readings_p20260415_occurred_at_idx;


--
-- Name: telemetry_readings_p20260416_asset_id_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.index_telemetry_readings_on_asset_id_and_occurred_at ATTACH PARTITION public.telemetry_readings_p20260416_asset_id_occurred_at_idx;


--
-- Name: telemetry_readings_p20260416_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.index_telemetry_readings_on_occurred_at ATTACH PARTITION public.telemetry_readings_p20260416_occurred_at_idx;


--
-- Name: telemetry_readings_p20260417_asset_id_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.index_telemetry_readings_on_asset_id_and_occurred_at ATTACH PARTITION public.telemetry_readings_p20260417_asset_id_occurred_at_idx;


--
-- Name: telemetry_readings_p20260417_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.index_telemetry_readings_on_occurred_at ATTACH PARTITION public.telemetry_readings_p20260417_occurred_at_idx;


--
-- Name: telemetry_readings_p20260418_asset_id_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.index_telemetry_readings_on_asset_id_and_occurred_at ATTACH PARTITION public.telemetry_readings_p20260418_asset_id_occurred_at_idx;


--
-- Name: telemetry_readings_p20260418_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.index_telemetry_readings_on_occurred_at ATTACH PARTITION public.telemetry_readings_p20260418_occurred_at_idx;


--
-- Name: telemetry_readings_p20260419_asset_id_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.index_telemetry_readings_on_asset_id_and_occurred_at ATTACH PARTITION public.telemetry_readings_p20260419_asset_id_occurred_at_idx;


--
-- Name: telemetry_readings_p20260419_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.index_telemetry_readings_on_occurred_at ATTACH PARTITION public.telemetry_readings_p20260419_occurred_at_idx;


--
-- Name: telemetry_readings_p20260422_asset_id_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.index_telemetry_readings_on_asset_id_and_occurred_at ATTACH PARTITION public.telemetry_readings_p20260422_asset_id_occurred_at_idx;


--
-- Name: telemetry_readings_p20260422_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.index_telemetry_readings_on_occurred_at ATTACH PARTITION public.telemetry_readings_p20260422_occurred_at_idx;


--
-- Name: telemetry_readings_p20260423_asset_id_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.index_telemetry_readings_on_asset_id_and_occurred_at ATTACH PARTITION public.telemetry_readings_p20260423_asset_id_occurred_at_idx;


--
-- Name: telemetry_readings_p20260423_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.index_telemetry_readings_on_occurred_at ATTACH PARTITION public.telemetry_readings_p20260423_occurred_at_idx;


--
-- Name: telemetry_readings_p20260424_asset_id_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.index_telemetry_readings_on_asset_id_and_occurred_at ATTACH PARTITION public.telemetry_readings_p20260424_asset_id_occurred_at_idx;


--
-- Name: telemetry_readings_p20260424_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.index_telemetry_readings_on_occurred_at ATTACH PARTITION public.telemetry_readings_p20260424_occurred_at_idx;


--
-- Name: telemetry_readings_p20260425_asset_id_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.index_telemetry_readings_on_asset_id_and_occurred_at ATTACH PARTITION public.telemetry_readings_p20260425_asset_id_occurred_at_idx;


--
-- Name: telemetry_readings_p20260425_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.index_telemetry_readings_on_occurred_at ATTACH PARTITION public.telemetry_readings_p20260425_occurred_at_idx;


--
-- Name: telemetry_readings_p20260426_asset_id_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.index_telemetry_readings_on_asset_id_and_occurred_at ATTACH PARTITION public.telemetry_readings_p20260426_asset_id_occurred_at_idx;


--
-- Name: telemetry_readings_p20260426_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.index_telemetry_readings_on_occurred_at ATTACH PARTITION public.telemetry_readings_p20260426_occurred_at_idx;


--
-- Name: telemetry_readings_p20260427_asset_id_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.index_telemetry_readings_on_asset_id_and_occurred_at ATTACH PARTITION public.telemetry_readings_p20260427_asset_id_occurred_at_idx;


--
-- Name: telemetry_readings_p20260427_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.index_telemetry_readings_on_occurred_at ATTACH PARTITION public.telemetry_readings_p20260427_occurred_at_idx;


--
-- Name: telemetry_readings_p20260428_asset_id_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.index_telemetry_readings_on_asset_id_and_occurred_at ATTACH PARTITION public.telemetry_readings_p20260428_asset_id_occurred_at_idx;


--
-- Name: telemetry_readings_p20260428_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.index_telemetry_readings_on_occurred_at ATTACH PARTITION public.telemetry_readings_p20260428_occurred_at_idx;


--
-- Name: telemetry_readings_p20260429_asset_id_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.index_telemetry_readings_on_asset_id_and_occurred_at ATTACH PARTITION public.telemetry_readings_p20260429_asset_id_occurred_at_idx;


--
-- Name: telemetry_readings_p20260429_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.index_telemetry_readings_on_occurred_at ATTACH PARTITION public.telemetry_readings_p20260429_occurred_at_idx;


--
-- Name: audit_events audit_events_immutable_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_events_immutable_delete BEFORE DELETE ON public.audit_events FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_event_delete();


--
-- Name: audit_events audit_events_immutable_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_events_immutable_update BEFORE UPDATE ON public.audit_events FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_event_update();


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
-- Name: sse_stream_leases fk_rails_20ad4565e9; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sse_stream_leases
    ADD CONSTRAINT fk_rails_20ad4565e9 FOREIGN KEY (user_id) REFERENCES public.users(id);


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
-- Name: sites fk_rails_404a8b1c56; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sites
    ADD CONSTRAINT fk_rails_404a8b1c56 FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: prosecution_steps fk_rails_49c61f9f4e; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prosecution_steps
    ADD CONSTRAINT fk_rails_49c61f9f4e FOREIGN KEY (incident_id) REFERENCES public.incidents(id);


--
-- Name: mfa_recovery_codes fk_rails_4c8a297a66; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mfa_recovery_codes
    ADD CONSTRAINT fk_rails_4c8a297a66 FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: tasks fk_rails_546c3973b4; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT fk_rails_546c3973b4 FOREIGN KEY (asset_id) REFERENCES public.assets(id) ON DELETE SET NULL;


--
-- Name: signal_rule_matches fk_rails_56955fb8d9; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.signal_rule_matches
    ADD CONSTRAINT fk_rails_56955fb8d9 FOREIGN KEY (signal_id) REFERENCES public.external_signals(id);


--
-- Name: users fk_rails_6aff989a3f; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT fk_rails_6aff989a3f FOREIGN KEY (area_of_operation_id) REFERENCES public.areas_of_operation(id);


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
-- Name: prosecution_steps fk_rails_70213e48a7; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prosecution_steps
    ADD CONSTRAINT fk_rails_70213e48a7 FOREIGN KEY (actor_id) REFERENCES public.users(id);


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
-- Name: user_sessions fk_rails_9fa262d742; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_sessions
    ADD CONSTRAINT fk_rails_9fa262d742 FOREIGN KEY (user_id) REFERENCES public.users(id);


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
-- Name: incidents fk_rails_b8b5a0282f; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incidents
    ADD CONSTRAINT fk_rails_b8b5a0282f FOREIGN KEY (prosecuted_by_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: areas_of_operation fk_rails_c977736256; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.areas_of_operation
    ADD CONSTRAINT fk_rails_c977736256 FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


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
    ADD CONSTRAINT fk_rails_d2436dcc2e FOREIGN KEY (assigned_to_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: telemetry_readings fk_rails_d477387a3c; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.telemetry_readings
    ADD CONSTRAINT fk_rails_d477387a3c FOREIGN KEY (asset_id) REFERENCES public.assets(id) ON DELETE CASCADE;


--
-- Name: users fk_rails_d7b9ff90af; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT fk_rails_d7b9ff90af FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


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
-- Name: user_sessions fk_rails_f1ed1a810d; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_sessions
    ADD CONSTRAINT fk_rails_f1ed1a810d FOREIGN KEY (revoked_by_id) REFERENCES public.users(id);


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
    ADD CONSTRAINT fk_rails_f6fa1e442c FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE SET NULL;


--
-- PostgreSQL database dump complete
--

SET search_path TO "$user", public;

INSERT INTO "schema_migrations" (version) VALUES
('20260425200000'),
('20260425100001'),
('20260425100000'),
('20260424220004'),
('20260424220003'),
('20260424220002'),
('20260424220001'),
('20260424220000'),
('20260424200000'),
('20260424180000'),
('20260415100001'),
('20260415100000'),
('20260406130000'),
('20260406120000'),
('20260406110000'),
('20260406100000'),
('20260405120000'),
('20260405100000'),
('20260402070000'),
('20260402060000'),
('20260402050000'),
('20260402040000'),
('20260402030000'),
('20260402020000'),
('20260402010000'),
('20260401030000'),
('20260401020000'),
('20260401010000'),
('20260330010000'),
('20260329230000'),
('20260329020000'),
('20260329010000'),
('20260328010000'),
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

