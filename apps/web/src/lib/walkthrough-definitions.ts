import {
  FileText,
  CreditCard,
  DollarSign,
  Users,
  Brain,
  Calendar,
  Clock,
  UserPlus,
  Mail,
  FormInput,
  BarChart3,
  Receipt,
  PieChart,
  FolderKanban,
  Zap,
  ShoppingBag,
  BookOpen,
  GraduationCap,
  Play,
  Palette,
  Share2,
  Target,
  Sparkles,
} from "lucide-react";
export interface WalkthroughStep {
  target?: string;
  title: string;
  description: string;
  icon?: React.ElementType;
}

export const COMMERCE_WALKTHROUGH: WalkthroughStep[] = [
  {
    target: "[data-walkthrough='commerce-tabs']",
    title: "Your Revenue Workspace",
    description: "Commerce has four tabs: Invoices, Quotes, Payments, and Recurring billing. Each handles a key part of your billing workflow.",
    icon: CreditCard,
  },
  {
    target: "[data-walkthrough='commerce-new']",
    title: "Create Invoices & Quotes",
    description: "Hit '+ New' to create an invoice or quote. Add line items, tax, discounts, and send it to your client — all in one flow.",
    icon: FileText,
  },
  {
    target: "[data-walkthrough='commerce-kpi']",
    title: "Financial Snapshot",
    description: "These cards show your outstanding balance, overdue amount, and this month's collections at a glance. Tap any card to learn what it means.",
    icon: DollarSign,
  },
  {
    target: "[data-walkthrough='commerce-help']",
    title: "Help & AI Assistant",
    description: "Open the help drawer for guided tutorials, or use the AI search bar to ask questions like 'Show invoices over $5000' in plain English.",
    icon: Brain,
  },
];

export const CRM_WALKTHROUGH: WalkthroughStep[] = [
  {
    target: "[data-walkthrough='crm-tabs']",
    title: "Your Contact Hub",
    description: "CRM has three views: Contacts for your pipeline, Insights for analytics, and Studio for bulk data management.",
    icon: Users,
  },
  {
    target: "[data-walkthrough='crm-add']",
    title: "Add Contacts Easily",
    description: "Add contacts manually, import from CSV/Excel, scan business cards, or sync from Google Contacts. Your contacts are the foundation of everything.",
    icon: UserPlus,
  },
  {
    target: "[data-walkthrough='crm-segments']",
    title: "Smart Segments",
    description: "One-tap filters like 'High Value', 'At Risk', and 'New This Week' help you focus on who matters most right now.",
    icon: Target,
  },
  {
    target: "[data-walkthrough='crm-ai']",
    title: "AI-Powered Intelligence",
    description: "The AI copilot scores leads, detects churn risk, drafts follow-ups, and finds revenue opportunities — all automatically.",
    icon: Brain,
  },
];

export const BOOKINGS_WALKTHROUGH: WalkthroughStep[] = [
  {
    target: "[data-walkthrough='bookings-calendar']",
    title: "Your Schedule at a Glance",
    description: "View your bookings in Month, Week, or Day mode. Click any time slot to create a new appointment instantly.",
    icon: Calendar,
  },
  {
    target: "[data-walkthrough='bookings-catalog']",
    title: "Services & Staff",
    description: "Set up your bookable services, assign staff members, and configure availability hours in the Catalog & Capacity tab.",
    icon: Clock,
  },
  {
    target: "[data-walkthrough='bookings-share']",
    title: "Share Your Booking Page",
    description: "Share your public booking link via WhatsApp, email, or social media so clients can book appointments 24/7.",
    icon: Share2,
  },
];

export const MARKETING_WALKTHROUGH: WalkthroughStep[] = [
  {
    target: "[data-walkthrough='marketing-tabs']",
    title: "Your Marketing Hub",
    description: "Create email campaigns, manage social media, build lead capture forms, and track performance — all from one place.",
    icon: Mail,
  },
  {
    target: "[data-walkthrough='marketing-create']",
    title: "Create Campaigns",
    description: "Build email campaigns with AI-generated content, schedule them, and track opens, clicks, and engagement automatically.",
    icon: Sparkles,
  },
  {
    target: "[data-walkthrough='marketing-forms']",
    title: "Capture Leads",
    description: "Build custom forms, embed them on your website, and every submission automatically creates a contact in your CRM.",
    icon: FormInput,
  },
];

export const EXPENSES_WALKTHROUGH: WalkthroughStep[] = [
  {
    target: "[data-walkthrough='expenses-tabs']",
    title: "Track Every Dollar",
    description: "Log expenses, set budgets with alerts, and view spending analytics by category, vendor, and payment method.",
    icon: Receipt,
  },
  {
    target: "[data-walkthrough='expenses-add']",
    title: "Add Expenses Quickly",
    description: "Log expenses with categories, vendors, amounts, and optional receipt attachments. AI can auto-categorize for you.",
    icon: DollarSign,
  },
  {
    target: "[data-walkthrough='expenses-budgets']",
    title: "Budget Alerts",
    description: "Set monthly spending limits by category and get warned when you're approaching or exceeding your budget.",
    icon: PieChart,
  },
];

export const REPORTS_WALKTHROUGH: WalkthroughStep[] = [
  {
    target: "[data-walkthrough='reports-tabs']",
    title: "Business Intelligence",
    description: "Reports pulls data from every module — revenue, expenses, bookings, marketing — into one analytics dashboard.",
    icon: BarChart3,
  },
  {
    target: "[data-walkthrough='reports-period']",
    title: "Flexible Date Ranges",
    description: "Select different time periods to analyze trends. Compare this month to last month, this quarter to last quarter.",
    icon: Calendar,
  },
  {
    target: "[data-walkthrough='reports-ai']",
    title: "AI Narrative Analysis",
    description: "Each report includes an AI explanation that tells you what the numbers mean and what actions to take.",
    icon: Brain,
  },
];

export const PROJECTS_WALKTHROUGH: WalkthroughStep[] = [
  {
    target: "[data-walkthrough='projects-board']",
    title: "Getting Started with Projects",
    description: "Your delivery execution workspace. Projects flow through six stages — Not Started, In Progress, Waiting on Client, Review, Blocked, and Completed — giving you full visibility into every engagement.",
    icon: FolderKanban,
  },
  {
    target: "[data-walkthrough='projects-tasks']",
    title: "Task & Milestone Tracking",
    description: "Each project has tasks, milestones, notes, and deliverables. Click a project card to open its 10-tab detail workspace with risk detection and recommended actions.",
    icon: Target,
  },
];

export const AUTOMATIONS_WALKTHROUGH: WalkthroughStep[] = [
  {
    target: "[data-walkthrough='automations-list']",
    title: "Your Flows Dashboard",
    description: "See the health of every automation, coverage across your modules, and intelligent recommendations for what to automate next.",
    icon: Zap,
  },
  {
    target: "[data-walkthrough='automations-templates']",
    title: "Strategic Templates",
    description: "Browse flow recipes by business problem, module, and complexity. Activate instantly or customize before creating.",
    icon: Sparkles,
  },
];

export const STORE_WALKTHROUGH: WalkthroughStep[] = [
  {
    target: "[data-walkthrough='store-setup']",
    title: "Your Online Storefront",
    description: "Configure your public store with products, branding, business hours, and a shareable URL for customers.",
    icon: ShoppingBag,
  },
  {
    target: "[data-walkthrough='store-customize']",
    title: "Customize Appearance",
    description: "Choose a theme, set brand colors, upload a hero image, and add testimonials to build trust with customers.",
    icon: Palette,
  },
  {
    target: "[data-walkthrough='store-analytics']",
    title: "Track Performance",
    description: "Monitor page views, popular items, and how many visitors convert into customers.",
    icon: BarChart3,
  },
];

export const TODAY_WALKTHROUGH: WalkthroughStep[] = [
  {
    target: "[data-walkthrough='today-briefing']",
    title: "Your Daily Briefing",
    description: "The Today view shows what needs attention right now — priority tasks, financial pulse, and AI-recommended actions.",
    icon: Target,
  },
  {
    target: "[data-walkthrough='today-ai']",
    title: "AI Command Bar",
    description: "Type or speak natural language commands to get instant insights, create items, or navigate anywhere in your business.",
    icon: Brain,
  },
  {
    target: "[data-walkthrough='today-actions']",
    title: "Next Best Actions",
    description: "AI analyzes your entire business and suggests the most impactful actions you should take today.",
    icon: Sparkles,
  },
];

export const LEARN_WALKTHROUGH: WalkthroughStep[] = [
  {
    target: "[data-walkthrough='learn-catalog']",
    title: "Course Catalog",
    description: "Browse available courses and masterclasses to level up your business skills.",
    icon: BookOpen,
  },
  {
    target: "[data-walkthrough='learn-progress']",
    title: "My Learning",
    description: "Track your enrolled courses, completion progress, and pick up where you left off.",
    icon: Play,
  },
  {
    target: "[data-walkthrough='learn-certificates']",
    title: "Certificates",
    description: "Earn certificates as you complete courses — share them to build credibility.",
    icon: GraduationCap,
  },
];

export const METRIC_DEFINITIONS: Record<string, { label: string; explanation: string; formula?: string; goodValue?: string }> = {
  outstanding: {
    label: "Outstanding",
    explanation: "Total amount on all unpaid invoices — Draft, Sent, Partially Paid, and Overdue combined.",
    formula: "Sum of all non-Paid, non-Void invoice totals",
    goodValue: "Lower is better. Aim to keep this under 2× your monthly revenue.",
  },
  overdue: {
    label: "Overdue",
    explanation: "Money owed to you past the due date. These invoices need urgent follow-up to maintain cash flow.",
    formula: "Sum of invoices where due date < today",
    goodValue: "Keep under 10% of total outstanding. Zero is ideal.",
  },
  collected_this_month: {
    label: "Collected This Month",
    explanation: "Total payments received during the current calendar month from all paid invoices.",
    formula: "Sum of invoice totals paid this month",
    goodValue: "Should trend upward month over month.",
  },
  conversion_rate: {
    label: "Conversion Rate",
    explanation: "Percentage of leads or prospects that become paying clients.",
    formula: "Clients ÷ Total Contacts × 100",
    goodValue: "Above 20% is strong for service businesses.",
  },
  lead_score: {
    label: "Lead Score",
    explanation: "AI-calculated score (0-100) based on engagement level, profile completeness, and interaction history. Higher scores indicate more qualified leads.",
    goodValue: "Above 70 = hot lead worth prioritizing.",
  },
  momentum_score: {
    label: "Momentum Score",
    explanation: "Measures the trend of a contact's engagement over time. Rising scores mean increasing activity; falling scores signal potential churn.",
    formula: "Weighted sum of recent interactions, bookings, and payments",
    goodValue: "Positive momentum means the relationship is growing.",
  },
  utilization_rate: {
    label: "Utilization Rate",
    explanation: "Percentage of available booking slots that are filled. Shows how efficiently your calendar is being used.",
    formula: "Booked Slots ÷ Available Slots × 100",
    goodValue: "70-85% is ideal. Above 90% means you may need more capacity.",
  },
  schedule_health: {
    label: "Schedule Health",
    explanation: "Overall score of your booking calendar efficiency, factoring in fill rate, gap distribution, and client diversity.",
    goodValue: "Above 75% indicates a healthy, well-distributed schedule.",
  },
  open_rate: {
    label: "Open Rate",
    explanation: "Percentage of delivered emails that recipients opened. Reflects subject line effectiveness and audience engagement.",
    formula: "Opens ÷ Delivered × 100",
    goodValue: "Above 20% is industry average. Above 30% is excellent.",
  },
  click_rate: {
    label: "Click Rate",
    explanation: "Percentage of opened emails where recipients clicked a link. Shows how compelling your content and CTAs are.",
    formula: "Clicks ÷ Opens × 100",
    goodValue: "Above 2.5% is good. Above 5% is excellent.",
  },
  budget_utilization: {
    label: "Budget Utilization",
    explanation: "Percentage of your set budget that has been spent. Helps you stay within planned spending limits.",
    formula: "Spent ÷ Budget Limit × 100",
    goodValue: "Stay under 80% to maintain a safety buffer.",
  },
  cash_flow_forecast: {
    label: "Cash Flow Forecast",
    explanation: "AI projection of your expected cash position over the next 90 days, based on historical revenue and expense patterns.",
    goodValue: "A positive trend line means your business is growing sustainably.",
  },
  completion_rate: {
    label: "Completion Rate",
    explanation: "Percentage of bookings that were completed (not cancelled or no-show). Indicates appointment reliability.",
    formula: "Completed Bookings ÷ Total Bookings × 100",
    goodValue: "Above 85% is strong. Below 70% indicates a no-show problem.",
  },
  net_profit: {
    label: "Net Profit",
    explanation: "Revenue minus all expenses. The bottom line of your business performance.",
    formula: "Total Revenue − Total Expenses",
    goodValue: "Positive and growing. A 15-25% margin is healthy for service businesses.",
  },
  customer_lifetime_value: {
    label: "Customer Lifetime Value",
    explanation: "Average total revenue a single client generates over their entire relationship with your business.",
    formula: "Total Revenue ÷ Number of Clients",
    goodValue: "Higher is better. Aim to increase this through repeat services and upselling.",
  },
};

export interface PageOverview {
  title: string;
  description: string;
  concepts: { step: string; title: string; desc: string }[];
}

export const PAGE_OVERVIEWS: Record<string, PageOverview> = {
  today: {
    title: "Welcome to Your Command Center",
    description: "Your daily briefing, AI-powered insights, and priority actions — all in one place.",
    concepts: [
      { step: "1", title: "Daily Briefing", desc: "See what needs attention right now — priority tasks, financial pulse, and AI-recommended actions." },
      { step: "2", title: "AI Command Bar", desc: "Type natural language commands to get instant insights, create items, or navigate anywhere." },
      { step: "3", title: "Next Best Actions", desc: "AI analyzes your entire business and suggests the most impactful actions to take today." },
    ],
  },
  expenses: {
    title: "Getting Started with Expenses",
    description: "Track spending, set budgets, and manage vendors.",
    concepts: [
      { step: "1", title: "Add Expenses", desc: "Record business expenses with amount, vendor, date, and payment method." },
      { step: "2", title: "Set Budgets", desc: "Create monthly spending budgets per category and get alerts when approaching limits." },
      { step: "3", title: "Track Vendors", desc: "See analytics on your top vendors and spending distribution." },
      { step: "4", title: "Categorize Spending", desc: "Create custom categories with colors to organize and visualize your expenses." },
      { step: "5", title: "Export Reports", desc: "Download your expense data as CSV for accounting and tax purposes." },
      { step: "6", title: "Upload Receipts", desc: "Attach receipt images to expenses for record-keeping and compliance." },
    ],
  },
  crm: {
    title: "Getting Started with Clients",
    description: "Triage relationships, track health, and take action on what matters.",
    concepts: [
      { step: "1", title: "Add Clients", desc: "Create manually, scan business cards, import CSV/VCF, or sync from Google Contacts." },
      { step: "2", title: "Smart Segments", desc: "Filter with one-tap segments like High Value, New This Week, and At Risk." },
      { step: "3", title: "Communicate", desc: "Reach out via WhatsApp, email, or phone directly from any client card." },
      { step: "4", title: "Bulk Actions", desc: "Select multiple clients for broadcast messages, tagging, or status updates." },
      { step: "5", title: "Insights & AI", desc: "Track pipeline health, revenue data, and use AI tools for summaries and scoring." },
      { step: "6", title: "Action Queue", desc: "See who needs attention and why — sorted by urgency and value." },
    ],
  },
  commerce: {
    title: "Getting Started with Revenue",
    description: "Create invoices, quotes, and manage payments — all in one place.",
    concepts: [
      { step: "1", title: "Revenue Workspace", desc: "Commerce has four tabs: Invoices, Quotes, Payments, and Recurring billing." },
      { step: "2", title: "Create Invoices & Quotes", desc: "Hit '+ New' to create an invoice or quote. Add line items, tax, and send to your client." },
      { step: "3", title: "Financial Snapshot", desc: "Overview cards show outstanding balance, overdue amount, and monthly collections." },
      { step: "4", title: "Help & AI Assistant", desc: "Use the AI search bar to ask questions like 'Show invoices over $5000' in plain English." },
    ],
  },
  bookings: {
    title: "Getting Started with Bookings",
    description: "Set up your schedule, services, and staff to start accepting bookings.",
    concepts: [
      { step: "1", title: "Add Services", desc: "Define your bookable services with pricing and duration." },
      { step: "2", title: "Add Staff", desc: "Add team members who can be assigned to bookings." },
      { step: "3", title: "Manage Schedule", desc: "View bookings on the calendar, confirm or cancel appointments." },
      { step: "4", title: "Connect Google Calendar", desc: "Sync bookings to your Google Calendar from Catalog & Capacity." },
      { step: "5", title: "Track Performance", desc: "Monitor volume, revenue, and schedule health." },
    ],
  },
  marketing: {
    title: "Getting Started with Marketing",
    description: "Create campaigns, capture leads, and grow your audience.",
    concepts: [
      { step: "1", title: "Create & Schedule", desc: "Build email campaigns, compose social posts, and schedule content from one surface." },
      { step: "2", title: "Calendar", desc: "View all scheduled campaigns and posts on a unified content calendar." },
      { step: "3", title: "Audiences & Forms", desc: "Manage lead forms and audience segments for targeted outreach." },
      { step: "4", title: "Performance", desc: "Track campaign performance, open rates, leads, and conversion funnels." },
    ],
  },
  reports: {
    title: "Getting Started with Reports",
    description: "Generate intelligent business reports with AI-powered insights.",
    concepts: [
      { step: "1", title: "Choose Report Type", desc: "Select from Executive, P&L, Revenue, Expenses, or Clients report views." },
      { step: "2", title: "Set Date Range", desc: "Pick a preset period or set custom start and end dates for your report." },
      { step: "3", title: "Generate Report", desc: "AI analyzes your business data and generates comprehensive insights." },
      { step: "4", title: "View AI Insights", desc: "Get intelligent summaries, trends, and actionable recommendations." },
      { step: "5", title: "Export Data", desc: "Download reports as PDF for sharing with partners or accountants." },
      { step: "6", title: "Schedule Reports", desc: "Set up recurring report generation to stay on top of your metrics." },
    ],
  },
  automations: {
    title: "Getting Started with Flows",
    description: "Automate, orchestrate, and monitor how your business reacts across every module.",
    concepts: [
      { step: "1", title: "Check Flow Health", desc: "See how many flows are active, paused, or need attention at a glance." },
      { step: "2", title: "Review Coverage", desc: "See which modules are automated and where gaps exist in your business." },
      { step: "3", title: "Create a Flow", desc: "Click 'New Flow' or use a strategic template to build trigger → condition → action chains." },
      { step: "4", title: "Pick Triggers & Actions", desc: "Choose from events across Clients, Revenue, Bookings, Content, and more." },
      { step: "5", title: "Monitor Diagnostics", desc: "Check the Activity Log for execution traces, failures, skipped conditions, and results." },
    ],
  },
  projects: {
    title: "Getting Started with Projects",
    description: "Organize work with kanban boards and task tracking.",
    concepts: [
      { step: "1", title: "Create Projects", desc: "Click '+ New Project' to set up a project with a name and color for organizing work." },
      { step: "2", title: "Add Tasks", desc: "Expand a project and add tasks — check them off as you complete each action item." },
      { step: "3", title: "Use Kanban Board", desc: "Projects are displayed in columns by status: Active, In Progress, Completed, and On Hold." },
      { step: "4", title: "Track Progress", desc: "Monitor task completion with progress bars and move projects between statuses." },
    ],
  },
  learn: {
    title: "Getting Started with MasterClass",
    description: "Level up your business skills with guided courses and earn certificates.",
    concepts: [
      { step: "1", title: "Browse Courses", desc: "Explore courses by difficulty level (Beginner, Intermediate, Advanced)." },
      { step: "2", title: "Enroll", desc: "Click any course to see the curriculum, then enroll to start learning." },
      { step: "3", title: "Complete Lessons", desc: "Work through lessons at your own pace. Your progress is saved automatically." },
      { step: "4", title: "Earn Certificates", desc: "Complete all lessons in a course to unlock a downloadable certificate." },
    ],
  },
  store: {
    title: "Getting Started with Store",
    description: "Configure your online storefront, showcase your services, and attract customers.",
    concepts: [
      { step: "1", title: "Your Online Storefront", desc: "Configure your public store with products, branding, business hours, and a shareable URL." },
      { step: "2", title: "Customize Appearance", desc: "Choose a theme, set brand colors, upload a hero image, and add testimonials to build trust." },
      { step: "3", title: "Track Performance", desc: "Monitor page views, popular items, and how many visitors convert into customers." },
    ],
  },
};
