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
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    version character varying NOT NULL
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
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


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
-- Name: tasks fk_rails_546c3973b4; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT fk_rails_546c3973b4 FOREIGN KEY (asset_id) REFERENCES public.assets(id);


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
-- PostgreSQL database dump complete
--

SET search_path TO "$user", public;

INSERT INTO "schema_migrations" (version) VALUES
('20260314034831'),
('20260313104951'),
('20260313104950'),
('20260313104949'),
('20260313104948'),
('20260313104919');

