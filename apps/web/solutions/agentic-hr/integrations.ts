/**
 * Integration tile metadata — ported from agentic_hr/ui/pages/chat.py TOOLS.
 * URLs use the prod nginx subpath layout (/agentic-hr/<tool>/), and fall back
 * to localhost for local dev.
 */

const API_BASE =
  process.env.NEXT_PUBLIC_AGENTIC_HR_API ?? 'http://localhost:8002';

export interface Integration {
  name: string;
  icon: string;
  category: string;
  description: string;
  url: string;
}

export const INTEGRATIONS: Integration[] = [
  {
    name: 'NocoDB',
    icon: '🗄️',
    category: 'HR Data Platform',
    description: 'No-code database powering employee records & leave tracking.',
    url: `${API_BASE.replace(/\/$/, '')}/nocodb/`,
  },
  {
    name: 'Gitea',
    icon: '🔀',
    category: 'Version Control',
    description: 'Git service hosting policy docs & HR workflow configs.',
    url: `${API_BASE.replace(/\/$/, '')}/gitea/`,
  },
  {
    name: 'Mattermost',
    icon: '💬',
    category: 'Team Collaboration',
    description: 'Messaging hub for approvals, notifications & team comms.',
    url: `${API_BASE.replace(/\/$/, '')}/mattermost/`,
  },
];
