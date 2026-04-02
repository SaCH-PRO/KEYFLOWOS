import {
  FileText,
  CreditCard,
  DollarSign,
  RefreshCw,
  Users,
  LayoutGrid,
  TrendingUp,
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
  Palette,
  Share2,
  Target,
  Sparkles,
} from "lucide-react";
import type { WalkthroughStep } from "@/components/ui/module-walkthrough";

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
    title: "Kanban Project Board",
    description: "Organize projects in columns: Active, In Progress, Completed, and On Hold. Drag cards between columns to update status.",
    icon: FolderKanban,
  },
  {
    target: "[data-walkthrough='projects-tasks']",
    title: "Task Management",
    description: "Each project contains a task list. Check off tasks as you complete them and track progress with the progress bar.",
    icon: Target,
  },
];

export const AUTOMATIONS_WALKTHROUGH: WalkthroughStep[] = [
  {
    target: "[data-walkthrough='automations-list']",
    title: "Automate Your Business",
    description: "Create playbooks that trigger actions automatically — like sending a reminder when an invoice is overdue.",
    icon: Zap,
  },
  {
    target: "[data-walkthrough='automations-templates']",
    title: "Start with Templates",
    description: "Browse pre-built automation recipes for Commerce, Bookings, CRM, and Marketing. Activate them with one click.",
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
