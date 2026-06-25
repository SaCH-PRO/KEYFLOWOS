import { type ReactNode } from 'react';
import { Metadata } from 'next';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  Plug,
  RefreshCw,
  HeartPulse,
  ClipboardList,
  Bot,
} from 'lucide-react';

export const metadata: Metadata = {
  title: 'Key Connector — KeyFlowOS',
  description: 'Universal Integration Hub for KeyFlowOS',
};

interface NavItem {
  label: string;
  href: string;
  icon: typeof LayoutDashboard;
}

const navItems: NavItem[] = [
  { label: 'Dashboard', href: '/key-connector', icon: LayoutDashboard },
  { label: 'Providers', href: '/key-connector/providers', icon: Plug },
  { label: 'Sync Monitor', href: '/key-connector/sync', icon: RefreshCw },
  { label: 'Health', href: '/key-connector/health', icon: HeartPulse },
  { label: 'Audit Log', href: '/key-connector/audit', icon: ClipboardList },
  { label: 'AI Gateway', href: '/key-connector/ai-gateway', icon: Bot },
];

export default function KeyConnectorLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="flex h-screen w-full bg-slate-50">
      {/* Sidebar */}
      <aside className="hidden lg:flex flex-col w-60 bg-[#0f172a] text-slate-300 flex-shrink-0">
        {/* Logo */}
        <div className="flex items-center gap-3 px-5 py-5 border-b border-slate-700/50">
          <div className="h-8 w-8 rounded-lg bg-blue-500 flex items-center justify-center text-white font-bold text-sm shadow-lg shadow-blue-500/20">
            KC
          </div>
          <div>
            <h1 className="text-sm font-bold text-white tracking-tight">Key Connector</h1>
            <p className="text-[10px] text-slate-400">Universal Integration Hub</p>
          </div>
        </div>

        {/* Nav items */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map((item) => (
            <NavLink key={item.href} item={item} />
          ))}
        </nav>

        {/* Footer */}
        <div className="px-4 py-4 border-t border-slate-700/50">
          <div className="flex items-center gap-2 px-2 py-2 rounded-md bg-slate-800/50">
            <div className="h-6 w-6 rounded-full bg-emerald-500/20 flex items-center justify-center">
              <div className="h-2 w-2 rounded-full bg-emerald-400" />
            </div>
            <div>
              <p className="text-[10px] font-medium text-slate-300">System Online</p>
              <p className="text-[9px] text-slate-500">v2.4.0</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Mobile sidebar — bottom nav */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-[#0f172a] border-t border-slate-700/50">
        <div className="flex items-center justify-around py-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex flex-col items-center gap-0.5 px-2 py-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-700/50 transition-colors"
              >
                <Icon className="h-4 w-4" />
                <span className="text-[9px]">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Content */}
      <main className="flex-1 overflow-y-auto pb-20 lg:pb-0">
        <div className="min-h-full">{children}</div>
      </main>
    </div>
  );
}

function NavLink({ item }: { item: NavItem }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className={cn(
        'flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-200',
        'text-slate-400 hover:text-white hover:bg-slate-700/50',
        'active:bg-slate-700',
      )}
    >
      <Icon className="h-4 w-4" />
      {item.label}
    </Link>
  );
}
