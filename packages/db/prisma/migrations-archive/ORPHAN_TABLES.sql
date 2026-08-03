--
-- ORPHAN TABLES — preserved 2026-08-03 during baseline adoption.
--
-- These 11 tables existed in the local dev database and in NO other place:
-- no model in schema.prisma, no Prisma client accessor, no raw SQL reference
-- anywhere in apps/ or packages/. They came from commit c7ab974a
-- ("Phase 5: payroll MVP") on a branch that never merged to main. Someone ran
-- the migrations locally, the branch was abandoned, the tables stayed.
--
-- Because they are absent from schema.prisma they are also absent from
-- 0_baseline, so every freshly-deployed database lacks them. Keeping them only
-- in one developer's database IS the drift.
--
-- They were NOT empty. Five carried one row each, all belonging to a single
-- business, all dated 2026-07-22, and self-identified as test data
-- (payroll_runs.notes = 'verification run'; support_ticket_messages.id =
-- 'p11_msg_1' with an obviously synthetic body). Dumped here with data rather
-- than dropped blind, so the decision is reversible:
--
--   psql -U keyflow -d keyflow -f ORPHAN_TABLES.sql
--
-- This is worth keeping rather than deleting because the payroll and staff
-- tables (pay_rates, payroll_items, payroll_runs,
-- staff_performance_snapshots) are the data layer for people/HR, which is the
-- next organ scheduled to be built, and they reference org_assignments —
-- a model that IS live. Read this before designing those models fresh.
--
--
-- PostgreSQL database dump
--

\restrict 0ZEORGuLyQeA4WJSNnvQkcQv8WwkFqNwXwSXTF4xEDqqgQypQKL01jZEAuBVCEO

-- Dumped from database version 16.13
-- Dumped by pg_dump version 16.13

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

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: event_attendees; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_attendees (
    id text NOT NULL,
    event_id text NOT NULL,
    ticket_type_id text,
    business_id text NOT NULL,
    email text NOT NULL,
    name text,
    phone text,
    status text DEFAULT 'REGISTERED'::text NOT NULL,
    payment_id text,
    checked_in_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: event_check_ins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_check_ins (
    id text NOT NULL,
    event_id text NOT NULL,
    attendee_id text NOT NULL,
    checked_in_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    checked_in_by text,
    notes text
);


--
-- Name: event_ticket_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_ticket_types (
    id text NOT NULL,
    event_id text NOT NULL,
    name text NOT NULL,
    description text,
    price numeric(12,2) DEFAULT 0 NOT NULL,
    currency text DEFAULT 'USD'::text NOT NULL,
    quantity integer,
    quantity_sold integer DEFAULT 0 NOT NULL,
    sales_start_at timestamp(3) without time zone,
    sales_end_at timestamp(3) without time zone,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.events (
    id text NOT NULL,
    business_id text NOT NULL,
    name text NOT NULL,
    description text,
    starts_at timestamp(3) without time zone NOT NULL,
    ends_at timestamp(3) without time zone,
    timezone text DEFAULT 'UTC'::text NOT NULL,
    location text,
    is_published boolean DEFAULT false NOT NULL,
    cover_image_url text,
    status text DEFAULT 'DRAFT'::text NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: pay_rates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pay_rates (
    id text NOT NULL,
    business_id text NOT NULL,
    assignment_id text NOT NULL,
    amount numeric(12,2) NOT NULL,
    currency text DEFAULT 'TTD'::text NOT NULL,
    period_type text DEFAULT 'hourly'::text NOT NULL,
    effective_from timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: payroll_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payroll_items (
    id text NOT NULL,
    run_id text NOT NULL,
    business_id text NOT NULL,
    assignment_id text NOT NULL,
    hours_worked numeric(8,2),
    gross_pay numeric(12,2) NOT NULL,
    currency text DEFAULT 'TTD'::text NOT NULL,
    notes text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: payroll_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payroll_runs (
    id text NOT NULL,
    business_id text NOT NULL,
    period_start timestamp(3) without time zone NOT NULL,
    period_end timestamp(3) without time zone NOT NULL,
    status text DEFAULT 'DRAFT'::text NOT NULL,
    "totalGross" numeric(14,2) DEFAULT 0 NOT NULL,
    currency text DEFAULT 'TTD'::text NOT NULL,
    item_count integer DEFAULT 0 NOT NULL,
    approved_at timestamp(3) without time zone,
    approved_by_id text,
    paid_at timestamp(3) without time zone,
    notes text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Name: risc_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.risc_events (
    id text NOT NULL,
    jti text NOT NULL,
    event_type text NOT NULL,
    provider_subject text NOT NULL,
    user_id text,
    action_taken text NOT NULL,
    payload jsonb,
    received_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    processed_at timestamp(3) without time zone NOT NULL
);


--
-- Name: staff_performance_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staff_performance_snapshots (
    id text NOT NULL,
    business_id text NOT NULL,
    assignment_id text NOT NULL,
    period_start timestamp(3) without time zone NOT NULL,
    period_end timestamp(3) without time zone NOT NULL,
    tasks_assigned integer DEFAULT 0 NOT NULL,
    tasks_completed integer DEFAULT 0 NOT NULL,
    tasks_on_time integer DEFAULT 0 NOT NULL,
    tasks_overdue_open integer DEFAULT 0 NOT NULL,
    hours_worked numeric(8,2) DEFAULT 0 NOT NULL,
    expected_hours numeric(8,2) DEFAULT 0 NOT NULL,
    approvals_handled integer DEFAULT 0 NOT NULL,
    avg_approval_response_hours numeric(8,2),
    overall_score integer DEFAULT 0 NOT NULL,
    computed_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: support_ticket_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.support_ticket_messages (
    id text NOT NULL,
    business_id text NOT NULL,
    ticket_id text NOT NULL,
    direction text DEFAULT 'OUTBOUND'::text NOT NULL,
    channel text DEFAULT 'internal'::text NOT NULL,
    body text NOT NULL,
    author_id text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: user_identities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_identities (
    id text NOT NULL,
    user_id text NOT NULL,
    provider text NOT NULL,
    provider_subject text NOT NULL,
    email text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


--
-- Data for Name: event_attendees; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.event_attendees (id, event_id, ticket_type_id, business_id, email, name, phone, status, payment_id, checked_in_at, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: event_check_ins; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.event_check_ins (id, event_id, attendee_id, checked_in_at, checked_in_by, notes) FROM stdin;
\.


--
-- Data for Name: event_ticket_types; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.event_ticket_types (id, event_id, name, description, price, currency, quantity, quantity_sold, sales_start_at, sales_end_at, is_active, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: events; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.events (id, business_id, name, description, starts_at, ends_at, timezone, location, is_published, cover_image_url, status, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: pay_rates; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.pay_rates (id, business_id, assignment_id, amount, currency, period_type, effective_from, created_at, updated_at) FROM stdin;
cmrvdk4lr00059z9g7nlzzy71	cmrtnh5fv00h29zd4r4j3trte	cmrvdk4la00039z9gcby655qq	50.00	TTD	hourly	2026-07-22 00:59:18.733	2026-07-22 00:59:18.735	2026-07-22 00:59:18.735
\.


--
-- Data for Name: payroll_items; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.payroll_items (id, run_id, business_id, assignment_id, hours_worked, gross_pay, currency, notes, created_at) FROM stdin;
cmrvdk4n200099z9g5homucor	cmrvdk4n200079z9g6sd9bt57	cmrtnh5fv00h29zd4r4j3trte	cmrvdk4la00039z9gcby655qq	0.00	0.00	TTD	No logged hours	2026-07-22 00:59:18.782
\.


--
-- Data for Name: payroll_runs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.payroll_runs (id, business_id, period_start, period_end, status, "totalGross", currency, item_count, approved_at, approved_by_id, paid_at, notes, created_at, updated_at) FROM stdin;
cmrvdk4n200079z9g6sd9bt57	cmrtnh5fv00h29zd4r4j3trte	2026-07-08 00:59:18.758	2026-07-22 00:59:18.758	PAID	0.00	TTD	1	2026-07-22 00:59:18.839	\N	2026-07-22 00:59:18.862	verification run	2026-07-22 00:59:18.782	2026-07-22 00:59:18.864
\.


--
-- Data for Name: risc_events; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.risc_events (id, jti, event_type, provider_subject, user_id, action_taken, payload, received_at, processed_at) FROM stdin;
\.


--
-- Data for Name: staff_performance_snapshots; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.staff_performance_snapshots (id, business_id, assignment_id, period_start, period_end, tasks_assigned, tasks_completed, tasks_on_time, tasks_overdue_open, hours_worked, expected_hours, approvals_handled, avg_approval_response_hours, overall_score, computed_at) FROM stdin;
cmrvxhvez00019z9cpwr8h9oc	cmrtnh5fv00h29zd4r4j3trte	cmrvdk4la00039z9gcby655qq	2026-07-08 10:17:25.807	2026-07-22 10:17:25.807	0	0	0	0	0.00	80.00	0	\N	70	2026-07-22 10:17:25.833
\.


--
-- Data for Name: support_ticket_messages; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.support_ticket_messages (id, business_id, ticket_id, direction, channel, body, author_id, created_at) FROM stdin;
p11_msg_1	cmrtnh5fv00h29zd4r4j3trte	p11_ticket_a	INBOUND	email	Hi, my order #42 arrived with a cracked screen. I would like a refund please. - Maria	\N	2026-07-22 23:58:52.063
\.


--
-- Data for Name: user_identities; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.user_identities (id, user_id, provider, provider_subject, email, created_at, updated_at) FROM stdin;
\.


--
-- Name: event_attendees event_attendees_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_attendees
    ADD CONSTRAINT event_attendees_pkey PRIMARY KEY (id);


--
-- Name: event_check_ins event_check_ins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_check_ins
    ADD CONSTRAINT event_check_ins_pkey PRIMARY KEY (id);


--
-- Name: event_ticket_types event_ticket_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_ticket_types
    ADD CONSTRAINT event_ticket_types_pkey PRIMARY KEY (id);


--
-- Name: events events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_pkey PRIMARY KEY (id);


--
-- Name: pay_rates pay_rates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pay_rates
    ADD CONSTRAINT pay_rates_pkey PRIMARY KEY (id);


--
-- Name: payroll_items payroll_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_items
    ADD CONSTRAINT payroll_items_pkey PRIMARY KEY (id);


--
-- Name: payroll_runs payroll_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_runs
    ADD CONSTRAINT payroll_runs_pkey PRIMARY KEY (id);


--
-- Name: risc_events risc_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.risc_events
    ADD CONSTRAINT risc_events_pkey PRIMARY KEY (id);


--
-- Name: staff_performance_snapshots staff_performance_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_performance_snapshots
    ADD CONSTRAINT staff_performance_snapshots_pkey PRIMARY KEY (id);


--
-- Name: support_ticket_messages support_ticket_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_ticket_messages
    ADD CONSTRAINT support_ticket_messages_pkey PRIMARY KEY (id);


--
-- Name: user_identities user_identities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_identities
    ADD CONSTRAINT user_identities_pkey PRIMARY KEY (id);


--
-- Name: event_attendees_business_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX event_attendees_business_id_idx ON public.event_attendees USING btree (business_id);


--
-- Name: event_attendees_event_id_email_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX event_attendees_event_id_email_key ON public.event_attendees USING btree (event_id, email);


--
-- Name: event_attendees_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX event_attendees_status_idx ON public.event_attendees USING btree (status);


--
-- Name: event_check_ins_event_id_attendee_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX event_check_ins_event_id_attendee_id_key ON public.event_check_ins USING btree (event_id, attendee_id);


--
-- Name: event_check_ins_event_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX event_check_ins_event_id_idx ON public.event_check_ins USING btree (event_id);


--
-- Name: event_ticket_types_event_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX event_ticket_types_event_id_idx ON public.event_ticket_types USING btree (event_id);


--
-- Name: events_business_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX events_business_id_idx ON public.events USING btree (business_id);


--
-- Name: events_starts_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX events_starts_at_idx ON public.events USING btree (starts_at);


--
-- Name: events_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX events_status_idx ON public.events USING btree (status);


--
-- Name: pay_rates_business_id_assignment_id_effective_from_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX pay_rates_business_id_assignment_id_effective_from_key ON public.pay_rates USING btree (business_id, assignment_id, effective_from);


--
-- Name: pay_rates_business_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pay_rates_business_id_idx ON public.pay_rates USING btree (business_id);


--
-- Name: payroll_items_business_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payroll_items_business_id_idx ON public.payroll_items USING btree (business_id);


--
-- Name: payroll_items_run_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payroll_items_run_id_idx ON public.payroll_items USING btree (run_id);


--
-- Name: payroll_runs_business_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payroll_runs_business_id_status_idx ON public.payroll_runs USING btree (business_id, status);


--
-- Name: risc_events_jti_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX risc_events_jti_key ON public.risc_events USING btree (jti);


--
-- Name: risc_events_provider_subject_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX risc_events_provider_subject_idx ON public.risc_events USING btree (provider_subject);


--
-- Name: risc_events_received_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX risc_events_received_at_idx ON public.risc_events USING btree (received_at);


--
-- Name: staff_performance_snapshots_business_id_assignment_id_perio_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX staff_performance_snapshots_business_id_assignment_id_perio_key ON public.staff_performance_snapshots USING btree (business_id, assignment_id, period_start, period_end);


--
-- Name: staff_performance_snapshots_business_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX staff_performance_snapshots_business_id_idx ON public.staff_performance_snapshots USING btree (business_id);


--
-- Name: support_ticket_messages_business_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX support_ticket_messages_business_id_idx ON public.support_ticket_messages USING btree (business_id);


--
-- Name: support_ticket_messages_ticket_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX support_ticket_messages_ticket_id_created_at_idx ON public.support_ticket_messages USING btree (ticket_id, created_at);


--
-- Name: user_identities_provider_provider_subject_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX user_identities_provider_provider_subject_key ON public.user_identities USING btree (provider, provider_subject);


--
-- Name: user_identities_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_identities_user_id_idx ON public.user_identities USING btree (user_id);


--
-- Name: event_attendees event_attendees_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_attendees
    ADD CONSTRAINT event_attendees_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: event_attendees event_attendees_ticket_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_attendees
    ADD CONSTRAINT event_attendees_ticket_type_id_fkey FOREIGN KEY (ticket_type_id) REFERENCES public.event_ticket_types(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: event_check_ins event_check_ins_attendee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_check_ins
    ADD CONSTRAINT event_check_ins_attendee_id_fkey FOREIGN KEY (attendee_id) REFERENCES public.event_attendees(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: event_check_ins event_check_ins_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_check_ins
    ADD CONSTRAINT event_check_ins_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: event_ticket_types event_ticket_types_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_ticket_types
    ADD CONSTRAINT event_ticket_types_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: events events_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: pay_rates pay_rates_assignment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pay_rates
    ADD CONSTRAINT pay_rates_assignment_id_fkey FOREIGN KEY (assignment_id) REFERENCES public.org_assignments(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: pay_rates pay_rates_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pay_rates
    ADD CONSTRAINT pay_rates_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: payroll_items payroll_items_assignment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_items
    ADD CONSTRAINT payroll_items_assignment_id_fkey FOREIGN KEY (assignment_id) REFERENCES public.org_assignments(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: payroll_items payroll_items_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_items
    ADD CONSTRAINT payroll_items_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: payroll_items payroll_items_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_items
    ADD CONSTRAINT payroll_items_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.payroll_runs(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: payroll_runs payroll_runs_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_runs
    ADD CONSTRAINT payroll_runs_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: staff_performance_snapshots staff_performance_snapshots_assignment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_performance_snapshots
    ADD CONSTRAINT staff_performance_snapshots_assignment_id_fkey FOREIGN KEY (assignment_id) REFERENCES public.org_assignments(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: staff_performance_snapshots staff_performance_snapshots_business_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_performance_snapshots
    ADD CONSTRAINT staff_performance_snapshots_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: support_ticket_messages support_ticket_messages_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_ticket_messages
    ADD CONSTRAINT support_ticket_messages_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.helpdesk_tickets(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: user_identities user_identities_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_identities
    ADD CONSTRAINT user_identities_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict 0ZEORGuLyQeA4WJSNnvQkcQv8WwkFqNwXwSXTF4xEDqqgQypQKL01jZEAuBVCEO


--
-- Orphan COLUMN, dropped at the same time:
--
--   users.meta_data  jsonb NULL
--
-- Present in the local dev database, absent from schema.prisma. The single
-- existing user held the value '{}' — no information. Unreachable from code:
-- with no `metaData` field on the User model, the generated Prisma client has
-- no way to select or write it. To restore:
--
--   ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "meta_data" JSONB;
--

--
-- Orphan COLUMNS on live tables, dropped 2026-08-03, plus the one row that
-- depended on them. Same abandoned branch as the tables above: the
-- org_assignments row is named 'Test Payroll Clerk' and was created in the
-- same millisecond cluster (00:59:18.719) as the payroll rows that
-- referenced it.
--
-- These columns implemented 'contact-only assignments' — assigning work to
-- someone who is not a platform user, reachable over a preferred channel,
-- approving by reply. Nothing in apps/ or packages/ references
-- isContactOnly, autoApprovalViaReply, activeFlowSessionId,
-- approverAssignmentId, approverMethod or clauseAnalysis. The idea is worth
-- revisiting when KEY->human delegation is built; the columns are not.
--
-- They mattered because schema.prisma declares org_assignments.membership_id
-- and .user_id NOT NULL, while a contact-only row has BOTH null. That row
-- could not exist under the real schema, so the schema could never be
-- applied to this database while it was present.
--
-- To restore:
--
--   ALTER TABLE "org_assignments" ALTER COLUMN "membership_id" DROP NOT NULL, ALTER COLUMN "user_id" DROP NOT NULL;
--   ALTER TABLE "org_assignments" ADD COLUMN IF NOT EXISTS "is_contact_only" BOOLEAN DEFAULT false;
--   ALTER TABLE "org_assignments" ADD COLUMN IF NOT EXISTS "auto_approval_via_reply" BOOLEAN DEFAULT false;
--   ALTER TABLE "org_assignments" ADD COLUMN IF NOT EXISTS "active_flow_session_id" TEXT;
--   ALTER TABLE "org_assignments" ADD COLUMN IF NOT EXISTS "contact_phone" TEXT;
--   ALTER TABLE "org_assignments" ADD COLUMN IF NOT EXISTS "preferred_channel" TEXT DEFAULT 'whatsapp'::text;
--   ALTER TABLE "org_assignments" ADD COLUMN IF NOT EXISTS "contact_name" TEXT;
--   ALTER TABLE "org_assignments" ADD COLUMN IF NOT EXISTS "contact_email" TEXT;
--   ALTER TABLE "ai_approval_items" ADD COLUMN IF NOT EXISTS "approver_assignment_id" TEXT, ADD COLUMN IF NOT EXISTS "approver_method" TEXT, ADD COLUMN IF NOT EXISTS "notified_at" TIMESTAMP(3);
--   ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "clause_analysis" JSONB;
--
--
-- PostgreSQL database dump
--

\restrict cnyItrPcyuMaq6LFFEYXkxlIokQorSTonuZUrJJNliloqpr1rVShsiudsXoeheD

-- Dumped from database version 16.13
-- Dumped by pg_dump version 16.13

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
-- Data for Name: org_assignments; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.org_assignments (id, business_id, membership_id, user_id, org_unit_id, job_role_id, reports_to_id, is_primary, started_at, ended_at, created_at, updated_at, active_flow_session_id, auto_approval_via_reply, contact_email, contact_name, contact_phone, is_contact_only, preferred_channel) FROM stdin;
cmrvdk4la00039z9gcby655qq	cmrtnh5fv00h29zd4r4j3trte	\N	\N	cmrvdk4ko00019z9gcqafgpke	\N	\N	f	2026-07-22 00:59:18.719	\N	2026-07-22 00:59:18.719	2026-07-22 00:59:18.719	\N	f	\N	Test Payroll Clerk	\N	t	whatsapp
\.


--
-- PostgreSQL database dump complete
--

\unrestrict cnyItrPcyuMaq6LFFEYXkxlIokQorSTonuZUrJJNliloqpr1rVShsiudsXoeheD

