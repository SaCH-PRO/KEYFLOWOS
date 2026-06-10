import os, re

BASE = 'apps/web/src/app/app/'

route_meta = {
    'command-center': {'label': 'Cockpit'},
    'key': {'label': 'KEY'},
    'capture': {'label': 'Capture'},
    'finance': {'label': 'Books', 'parent': ['Financial Flow']},
    'financial-flow': {'label': 'Financial Flow'},
    'revenue': {'label': 'Revenue'},
    'expenses': {'label': 'Expenses', 'parent': ['Financial Flow']},
    'budgeting': {'label': 'Budgeting', 'parent': ['Financial Flow']},
    'reports': {'label': 'Reports', 'parent': ['Financial Flow']},
    'temporal': {'label': 'Temporal'},
    'temporal-flow': {'label': 'Temporal Flow'},
    'calendar': {'label': 'Calendar'},
    'bookings': {'label': 'Calendar'},
    'projects': {'label': 'Projects'},
    'tasks': {'label': 'Tasks'},
    'call-tasks': {'label': 'Calls'},
    'people': {'label': 'People'},
    'people-flow': {'label': 'People Flow'},
    'crm': {'label': 'Network'},
    'network': {'label': 'Network'},
    'contacts': {'label': 'Contacts'},
    'sequences': {'label': 'Sequences'},
    'intelligence': {'label': 'Intelligence'},
    'helpdesk': {'label': 'Service'},
    'commerce': {'label': 'Revenue', 'parent': ['Financial Flow']},
    'deals': {'label': 'Deals'},
    'marketing': {'label': 'Content'},
    'marketing-flow': {'label': 'Marketing Flow'},
    'lists': {'label': 'Lists'},
    'content-ops': {'label': 'Content'},
    'social': {'label': 'Social'},
    'operations': {'label': 'Operations'},
    'governance': {'label': 'Governance'},
    'governance-flow': {'label': 'Governance Flow'},
    'approvals': {'label': 'Approvals'},
    'compliance': {'label': 'Compliance'},
    'growth': {'label': 'Growth'},
    'store': {'label': 'Presence'},
    'storefront': {'label': 'Storefront'},
    'storefront-intelligence': {'label': 'Storefront Intelligence'},
    'documents': {'label': 'Documents'},
    'goals': {'label': 'Goals'},
    'blueprint': {'label': 'Blueprint'},
    'presence': {'label': 'Presence'},
    'templates': {'label': 'Templates'},
    'settings': {'label': 'Studio'},
    'profile': {'label': 'Profile'},
    'account': {'label': 'Account'},
    'business': {'label': 'Business'},
    'workspace': {'label': 'Workspace'},
    'team': {'label': 'Team'},
    'structure': {'label': 'Structure'},
    'connections': {'label': 'Connections'},
    'ai': {'label': 'AI'},
    'developers': {'label': 'Developers'},
    'connect': {'label': 'Connect'},
    'google': {'label': 'Google'},
    'microsoft': {'label': 'Microsoft'},
    'payments': {'label': 'Payments'},
    'accounting': {'label': 'Accounting'},
    'forms': {'label': 'Forms'},
    'whatsapp': {'label': 'WhatsApp'},
    'flows': {'label': 'Flows'},
    'workflows': {'label': 'Workflows'},
    'community': {'label': 'Community'},
    'learn': {'label': 'Learn'},
    'marketplace': {'label': 'Marketplace'},
    'procurement': {'label': 'Procurement'},
    'suppliers': {'label': 'Suppliers'},
    'build': {'label': 'Build'},
}

targets = [
  ('/app/command-center', 'command-center/page.tsx'),
  ('/app/key', 'key/page.tsx'),
  ('/app/capture', 'capture/page.tsx'),
  ('/app/finance', 'finance/page.tsx'),
  ('/app/financial-flow', 'financial-flow/page.tsx'),
  ('/app/finance/revenue', 'finance/revenue/page.tsx'),
  ('/app/expenses', 'expenses/page.tsx'),
  ('/app/finance/expenses', 'finance/expenses/page.tsx'),
  ('/app/budgeting', 'budgeting/page.tsx'),
  ('/app/reports', 'reports/page.tsx'),
  ('/app/finance/reports', 'finance/reports/page.tsx'),
  ('/app/temporal-flow', 'temporal-flow/page.tsx'),
  ('/app/calendar', 'calendar/page.tsx'),
  ('/app/bookings', 'bookings/page.tsx'),
  ('/app/projects', 'projects/page.tsx'),
  ('/app/call-tasks', 'call-tasks/page.tsx'),
  ('/app/people-flow', 'people-flow/page.tsx'),
  ('/app/crm', 'crm/page.tsx'),
  ('/app/network/contacts', 'network/contacts/page.tsx'),
  ('/app/connect/contacts', 'connect/contacts/page.tsx'),
  ('/app/crm/sequences', 'crm/sequences/page.tsx'),
  ('/app/intelligence', 'intelligence/page.tsx'),
  ('/app/helpdesk', 'helpdesk/page.tsx'),
  ('/app/commerce', 'commerce/page.tsx'),
  ('/app/crm/deals', 'crm/deals/page.tsx'),
  ('/app/marketing', 'marketing/page.tsx'),
  ('/app/marketing-flow', 'marketing-flow/page.tsx'),
  ('/app/marketing/lists', 'marketing/lists/page.tsx'),
  ('/app/content-ops', 'content-ops/page.tsx'),
  ('/app/social', 'social/page.tsx'),
  ('/app/operations', 'operations/page.tsx'),
  ('/app/governance-flow', 'governance-flow/page.tsx'),
  ('/app/approvals', 'approvals/page.tsx'),
  ('/app/settings/compliance', 'settings/compliance/page.tsx'),
  ('/app/build/system/compliance', 'build/system/compliance/page.tsx'),
  ('/app/intelligence/compliance', 'intelligence/compliance/page.tsx'),
  ('/app/growth', 'growth/page.tsx'),
  ('/app/store', 'store/page.tsx'),
  ('/app/storefront-intelligence', 'storefront-intelligence/page.tsx'),
  ('/app/documents', 'documents/page.tsx'),
  ('/app/goals', 'goals/page.tsx'),
  ('/app/blueprint', 'blueprint/page.tsx'),
  ('/app/build/business/blueprint', 'build/business/blueprint/page.tsx'),
  ('/app/presence', 'presence/page.tsx'),
  ('/app/build/business/presence', 'build/business/presence/page.tsx'),
  ('/app/templates', 'templates/page.tsx'),
  ('/app/build/business/templates', 'build/business/templates/page.tsx'),
  ('/app/settings/profile', 'settings/profile/page.tsx'),
  ('/app/build/system/account', 'build/system/account/page.tsx'),
  ('/app/settings/business', 'settings/business/page.tsx'),
  ('/app/build/system/workspace', 'build/system/workspace/page.tsx'),
  ('/app/settings/team', 'settings/team/page.tsx'),
  ('/app/structure', 'structure/page.tsx'),
  ('/app/settings/connections', 'settings/connections/page.tsx'),
  ('/app/build/system/connections', 'build/system/connections/page.tsx'),
  ('/app/settings/ai', 'settings/ai/page.tsx'),
  ('/app/build/system/ai', 'build/system/ai/page.tsx'),
  ('/app/settings/developers', 'settings/developers/page.tsx'),
  ('/app/build/system/developers', 'build/system/developers/page.tsx'),
  ('/app/connect', 'connect/page.tsx'),
  ('/app/build/connect', 'build/connect/page.tsx'),
  ('/app/build/connect/google', 'build/connect/google/page.tsx'),
  ('/app/build/connect/microsoft', 'build/connect/microsoft/page.tsx'),
  ('/app/build/connect/payments', 'build/connect/payments/page.tsx'),
  ('/app/accounting', 'accounting/page.tsx'),
  ('/app/build/connect/accounting', 'build/connect/accounting/page.tsx'),
  ('/app/build/connect/marketing', 'build/connect/marketing/page.tsx'),
  ('/app/build/connect/social', 'build/connect/social/page.tsx'),
  ('/app/connect/forms', 'connect/forms/page.tsx'),
  ('/app/build/connect/forms', 'build/connect/forms/page.tsx'),
  ('/app/build/connect/whatsapp', 'build/connect/whatsapp/page.tsx'),
  ('/app/flows', 'flows/page.tsx'),
  ('/app/build/automate/flows', 'build/automate/flows/page.tsx'),
  ('/app/workflows', 'workflows/page.tsx'),
  ('/app/build/automate/workflows', 'build/automate/workflows/page.tsx'),
  ('/app/community', 'community/page.tsx'),
  ('/app/learn', 'learn/page.tsx'),
  ('/app/marketplace', 'marketplace/page.tsx'),
  ('/app/procurement/suppliers', 'procurement/suppliers/page.tsx'),
]

def label_for_segment(s):
    if s in route_meta:
        return route_meta[s]['label']
    return s.replace('-', ' ').title()

def compute_breadcrumb(route):
    segs = [x for x in route.split('/') if x]
    try:
        idx = segs.index('app')
    except ValueError:
        return []
    crumbs = segs[idx+1:]
    items = ['Home']
    if crumbs:
        parent = route_meta.get(crumbs[0], {}).get('parent')
        if parent:
            items.extend(parent)
    for s in crumbs:
        items.append(label_for_segment(s))
    return items

def extract_heading(content):
    if re.search(r'redirect\s*\(', content) and len(content) < 400:
        return '(redirect page)'
    m = re.search(r'<(?:UnifiedPageShell|ModuleShell|PageHeader)[^>]*\s+title=["\']([^"\']+)["\']', content)
    if m:
        return m.group(1)
    m = re.search(r'<PageHeader[^>]*\s+heading=["\']([^"\']+)["\']', content)
