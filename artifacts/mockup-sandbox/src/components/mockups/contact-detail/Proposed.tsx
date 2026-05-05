import {
  Mail, Phone, MessageCircle, MoreHorizontal, Star, ChevronDown,
  Sparkles, Zap, TrendingUp, AlertTriangle, CheckCircle2,
  Clock, Users, FileText, Calendar, Building2, MapPin, Globe,
  ArrowRight, Plus, Wand2,
} from "lucide-react";

function Tile({ label, value, sub, tone = "default" }: { label: string; value: string; sub?: string; tone?: "default" | "good" | "warn" | "muted" }) {
  const toneClass = {
    default: "text-zinc-900",
    good: "text-emerald-600",
    warn: "text-amber-600",
    muted: "text-zinc-400",
  }[tone];
  return (
    <div className="flex flex-col gap-1 px-4 py-3 border-r border-zinc-200/70 last:border-r-0 min-w-0">
      <div className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium truncate">{label}</div>
      <div className={`text-xl font-semibold tabular-nums leading-none ${toneClass}`}>{value}</div>
      {sub && <div className="text-[11px] text-zinc-500 truncate">{sub}</div>}
    </div>
  );
}

function StatusPill({ active, label }: { active?: boolean; label: string }) {
  return (
    <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${active ? "bg-emerald-100 text-emerald-700" : "bg-zinc-100 text-zinc-500"}`}>{label}</span>
  );
}

function IconBtn({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <button className="inline-flex items-center justify-center h-7 w-7 rounded-md text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 transition" title={label} aria-label={label}>
      {children}
    </button>
  );
}

function Tab({ children, active, count }: { children: React.ReactNode; active?: boolean; count?: number }) {
  return (
    <button className={`relative px-3 py-2 text-sm font-medium transition ${active ? "text-zinc-900" : "text-zinc-500 hover:text-zinc-800"}`}>
      <span className="inline-flex items-center gap-1.5">
        {children}
        {count !== undefined && (
          <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-zinc-100 text-zinc-600 tabular-nums">{count}</span>
        )}
      </span>
      {active && <span className="absolute left-2 right-2 -bottom-px h-0.5 bg-orange-500 rounded-full" />}
    </button>
  );
}

function TimelineItem({ icon, title, meta, when, badge }: { icon: React.ReactNode; title: string; meta?: string; when: string; badge?: string }) {
  return (
    <div className="flex items-start gap-3 py-2.5">
      <div className="mt-0.5 h-7 w-7 rounded-full bg-zinc-100 text-zinc-500 flex items-center justify-center shrink-0">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium text-zinc-900 truncate">{title}</span>
          {badge && <span className="px-1.5 py-0.5 text-[10px] rounded bg-zinc-100 text-zinc-600">{badge}</span>}
        </div>
        {meta && <div className="text-xs text-zinc-500 truncate">{meta}</div>}
      </div>
      <div className="text-xs text-zinc-400 tabular-nums shrink-0">{when}</div>
    </div>
  );
}

export function Proposed() {
  return (
    <div className="min-h-screen bg-zinc-50 font-sans text-zinc-900">
      <div className="max-w-[1240px] mx-auto p-6 space-y-4">

        {/* Breadcrumb / page chrome */}
        <div className="flex items-center justify-between text-xs text-zinc-500">
          <div className="flex items-center gap-1.5">
            <span>Home</span><span>/</span>
            <span>CRM</span><span>/</span>
            <span className="text-zinc-700">Clients</span>
          </div>
          <div className="text-[11px]">Last synced 2 min ago</div>
        </div>

        {/* HEADER — name, status dropdown, channel icons, overflow */}
        <div className="bg-white border border-zinc-200 rounded-xl p-4 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="h-12 w-12 rounded-full bg-emerald-500 text-white text-lg font-semibold flex items-center justify-center shrink-0">SD</div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-semibold text-zinc-900">Sachin Dookie</h1>
                <button className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-xs font-medium hover:bg-emerald-200 transition">
                  Client <ChevronDown className="w-3 h-3" />
                </button>
                <Star className="w-4 h-4 text-zinc-300 hover:text-amber-400 cursor-pointer" />
                <span className="text-xs text-zinc-400">· 85% complete</span>
              </div>
              <div className="mt-1 flex items-center gap-3 text-sm text-zinc-600 flex-wrap">
                <span className="text-zinc-500">Owner at KEYFLOWOS</span>
                <span className="text-zinc-300">·</span>
                <a className="hover:text-orange-600 inline-flex items-center gap-1 group" href="#">
                  <Mail className="w-3.5 h-3.5 text-zinc-400 group-hover:text-orange-500" />
                  sachdookie@gmail.com
                </a>
                <a className="hover:text-orange-600 inline-flex items-center gap-1 group" href="#">
                  <Phone className="w-3.5 h-3.5 text-zinc-400 group-hover:text-orange-500" />
                  1 868 460 7195
                </a>
                <a className="hover:text-orange-600 inline-flex items-center gap-1 group" href="#">
                  <MessageCircle className="w-3.5 h-3.5 text-zinc-400 group-hover:text-orange-500" />
                  WhatsApp
                </a>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button className="px-3 py-1.5 text-sm font-medium text-zinc-700 bg-white border border-zinc-200 rounded-md hover:bg-zinc-50">Edit</button>
              <IconBtn label="More"><MoreHorizontal className="w-4 h-4" /></IconBtn>
            </div>
          </div>
        </div>

        {/* SINGLE KPI STRIP — replaces 4 separate KPI surfaces */}
        <div className="bg-white border border-zinc-200 rounded-xl shadow-sm overflow-hidden">
          <div className="grid grid-cols-6">
            <Tile label="Lifetime" value="TTD 0" sub="—" tone="muted" />
            <Tile label="Open deals" value="0" sub="TTD 0" tone="muted" />
            <Tile label="Bookings" value="6" sub="last May 4" />
            <Tile label="Churn risk" value="10" sub="Healthy" tone="good" />
            <Tile label="Momentum" value="80" sub="of 100 · Moderate" tone="warn" />
            <Tile label="Health" value="70%" sub="Engagement 100%" tone="good" />
          </div>
        </div>

        {/* SINGLE NEXT-BEST-ACTION — merged from Suggested Next Step + Recommended Next Action */}
        <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-xl p-4 flex items-center gap-4 shadow-sm">
          <div className="h-9 w-9 rounded-full bg-amber-200 text-amber-700 flex items-center justify-center shrink-0">
            <Zap className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-zinc-900">Follow up after stage change</div>
            <div className="text-xs text-zinc-600">An overdue task is blocking momentum. Close it to keep the relationship moving.</div>
          </div>
          <button className="px-3 py-1.5 text-sm font-medium bg-white text-amber-700 border border-amber-300 rounded-md hover:bg-amber-100">Snooze</button>
          <button className="px-3 py-1.5 text-sm font-medium bg-amber-500 text-white rounded-md hover:bg-amber-600 inline-flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5" /> Do it
          </button>
        </div>

        {/* AI PANEL — single home for all AI actions, replaces right-rail + inline buttons */}
        <div className="bg-white border border-zinc-200 rounded-xl shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100">
            <div className="flex items-center gap-2">
              <div className="h-6 w-6 rounded-md bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white flex items-center justify-center">
                <Sparkles className="w-3.5 h-3.5" />
              </div>
              <span className="text-sm font-semibold">AI Intelligence</span>
              <span className="text-[11px] text-zinc-400">· last refreshed just now</span>
            </div>
            <div className="flex items-center gap-1">
              <button className="px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 rounded-md inline-flex items-center gap-1">
                <Wand2 className="w-3.5 h-3.5" /> Briefing <span className="text-[10px] text-zinc-400 ml-1">1 cr</span>
              </button>
              <button className="px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 rounded-md inline-flex items-center gap-1">
                <Phone className="w-3.5 h-3.5" /> Prep call
              </button>
              <button className="px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 rounded-md inline-flex items-center gap-1">
                <Plus className="w-3.5 h-3.5" /> Tag
              </button>
            </div>
          </div>
          <div className="px-4 py-3 text-sm text-zinc-700 leading-relaxed">
            <span className="text-zinc-900 font-medium">Relationship insight.</span>{" "}
            No active engagement, no open deals, and TTD 0 lifetime value. Last activity was May 5, 2026. Churn risk is high in the absence of meaningful interactions — proactive outreach is recommended to re-establish engagement.
          </div>
          <div className="px-4 pb-3 flex items-center gap-2">
            <span className="px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 text-[11px] font-medium">Re-engage</span>
            <span className="px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 text-[11px] font-medium">Loyalty offer</span>
            <span className="px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 text-[11px] font-medium">Booking nudge</span>
            <button className="ml-auto text-xs text-violet-600 hover:text-violet-800 font-medium inline-flex items-center gap-1">
              View all suggestions <ArrowRight className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* TWO-COLUMN: Tabs (left) + Contact details (right) */}
        <div className="grid grid-cols-12 gap-4">
          {/* TABS — single unified strip */}
          <div className="col-span-8 bg-white border border-zinc-200 rounded-xl shadow-sm">
            <div className="border-b border-zinc-100 px-2 flex items-center gap-1 overflow-x-auto">
              <Tab active>Timeline</Tab>
              <Tab count={4}>Conversations</Tab>
              <Tab count={1}>Notes</Tab>
              <Tab count={6}>Tasks</Tab>
              <Tab count={0}>Deals</Tab>
              <Tab count={2}>Network</Tab>
              <Tab>Audit</Tab>
            </div>
            <div className="px-4 py-2 divide-y divide-zinc-100">
              <TimelineItem icon={<FileText className="w-3.5 h-3.5" />} title="Contact updated" meta="Owner reassigned to KEYFLOWOS" when="May 4" badge="CRM" />
              <TimelineItem icon={<FileText className="w-3.5 h-3.5" />} title="Contact updated" meta="Health score recalculated · 70%" when="May 4" badge="CRM" />
              <TimelineItem icon={<CheckCircle2 className="w-3.5 h-3.5" />} title="Task created" meta="Follow up after stage change" when="May 4" badge="CRM" />
              <TimelineItem icon={<TrendingUp className="w-3.5 h-3.5" />} title="Status changed" meta="LOST → CLIENT" when="May 4" badge="CRM" />
              <TimelineItem icon={<Calendar className="w-3.5 h-3.5" />} title="Booking confirmed" meta="Hair by Jill · 9 May, 11:00" when="May 3" badge="Bookings" />
              <TimelineItem icon={<MessageCircle className="w-3.5 h-3.5" />} title="WhatsApp sent" meta="Welcome back message · delivered" when="May 2" badge="WhatsApp" />
              <TimelineItem icon={<AlertTriangle className="w-3.5 h-3.5" />} title="Churn risk increased" meta="No engagement for 14d" when="Apr 28" badge="AI" />
              <TimelineItem icon={<FileText className="w-3.5 h-3.5" />} title="Contact updated" meta="+58 more events" when="Apr 27" />
            </div>
            <div className="px-4 py-2.5 border-t border-zinc-100 text-center">
              <button className="text-xs text-zinc-500 hover:text-zinc-800 font-medium">Load older activity</button>
            </div>
          </div>

          {/* CONTACT DETAILS — clean 2-col key/value grid */}
          <div className="col-span-4 space-y-4">
            <div className="bg-white border border-zinc-200 rounded-xl shadow-sm p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-zinc-900">Details</h3>
                <button className="text-xs text-zinc-500 hover:text-zinc-800">Edit</button>
              </div>
              <dl className="space-y-2.5 text-sm">
                <div className="grid grid-cols-3 gap-2">
                  <dt className="col-span-1 text-zinc-500 inline-flex items-center gap-1.5"><Building2 className="w-3.5 h-3.5" />Owner</dt>
                  <dd className="col-span-2 text-zinc-800">KEYFLOWOS</dd>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <dt className="col-span-1 text-zinc-500 inline-flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" />Location</dt>
                  <dd className="col-span-2 text-zinc-800">Mcbean, Couva, Trinidad &amp; Tobago</dd>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <dt className="col-span-1 text-zinc-500 inline-flex items-center gap-1.5"><Globe className="w-3.5 h-3.5" />Language</dt>
                  <dd className="col-span-2 text-zinc-800">English</dd>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <dt className="col-span-1 text-zinc-500 inline-flex items-center gap-1.5"><MessageCircle className="w-3.5 h-3.5" />Preferred</dt>
                  <dd className="col-span-2 text-zinc-800">WhatsApp</dd>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <dt className="col-span-1 text-zinc-500 inline-flex items-center gap-1.5"><Users className="w-3.5 h-3.5" />Segment</dt>
                  <dd className="col-span-2"><span className="px-1.5 py-0.5 rounded bg-orange-50 text-orange-700 text-[11px] font-medium">SMB</span></dd>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <dt className="col-span-1 text-zinc-500 inline-flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" />Added</dt>
                  <dd className="col-span-2 text-zinc-800">2 Apr 2026</dd>
                </div>
              </dl>
              <div className="mt-3 pt-3 border-t border-zinc-100 flex items-center gap-2 flex-wrap">
                <StatusPill active label="Marketing opt-in" />
                <StatusPill active label="Contactable" />
              </div>
            </div>

            {/* Network mini-card (was buried in secondary tab) */}
            <div className="bg-white border border-zinc-200 rounded-xl shadow-sm p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-zinc-900 inline-flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-zinc-400" /> Network
                </h3>
                <button className="text-xs text-orange-600 hover:text-orange-800 font-medium">+ Link</button>
              </div>
              <div className="text-xs text-zinc-500 mb-2">2 direct · 0 second-degree</div>
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <div className="h-7 w-7 rounded-full bg-amber-400 text-white text-xs font-semibold flex items-center justify-center">SO</div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-zinc-900 truncate">Sarah Olivieri</div>
                    <div className="text-[11px] text-zinc-500 truncate">Colleague of</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <div className="h-7 w-7 rounded-full bg-amber-500 text-white text-xs font-semibold flex items-center justify-center">DH</div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-zinc-900 truncate">Darius Henry</div>
                    <div className="text-[11px] text-zinc-500 truncate">Colleague of</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer caption */}
        <div className="text-[11px] text-zinc-400 text-center pt-2">
          Proposed contact detail · 1 KPI strip · 1 next-action · 1 AI panel · 1 tab strip · 2-col details + network
        </div>

      </div>
    </div>
  );
}
