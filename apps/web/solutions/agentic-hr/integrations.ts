/**
 * Integration tile metadata — links target the live UIs for each local service.
 * You can override each target via env vars if needed.
 */

const NOCO_URL = process.env.NEXT_PUBLIC_NOCO_URL ?? 'http://localhost:8080';
const GITEA_URL = process.env.NEXT_PUBLIC_GITEA_URL ?? 'http://localhost:3001';
const MATTERMOST_URL = process.env.NEXT_PUBLIC_MATTERMOST_URL ?? 'http://localhost:8065';

export interface Integration {
  name: string;
  icon: string;
  /** Short role label shown beneath the name in the chip (e.g. "HRIS"). */
  role: string;
  category: string;
  description: string;
  url: string;
}

export const INTEGRATIONS: Integration[] = [
  {
    name: 'NocoDB',
    icon: '🗄️',
    role: 'HRIS',
    category: 'HR Data Platform',
    description: 'No-code database powering employee records & leave tracking.',
    url: NOCO_URL,
  },
  {
    name: 'Gitea',
    icon: '🔀',
    role: 'Source control',
    category: 'Version Control',
    description: 'Git service hosting policy docs & HR workflow configs.',
    url: GITEA_URL,
  },
  {
    name: 'Mattermost',
    icon: '💬',
    role: 'Team chat',
    category: 'Team Collaboration',
    description: 'Messaging hub for approvals, notifications & team comms.',
    url: MATTERMOST_URL,
  },
];
