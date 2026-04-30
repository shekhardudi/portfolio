/**
 * Example queries — port from agentic_hr/ui/pages/chat.py EXAMPLE_QUERIES.
 */

export interface ExampleCategory {
  category: string;
  icon: string;
  queries: string[];
}

export const EXAMPLE_QUERIES: ExampleCategory[] = [
  {
    category: 'Leave Balance',
    icon: '📋',
    queries: [
      'How many annual leave days do I have?',
      'Show me all my leave balances',
      'What is my sick leave balance?',
    ],
  },
  {
    category: 'Apply for Leave',
    icon: '✈️',
    queries: [
      'I want to apply for 3 days of annual leave',
      'I need to take 2 days of sick leave',
      'Can I take 8 hours of personal leave?',
    ],
  },
  {
    category: 'Policy Questions',
    icon: '📖',
    queries: [
      'What is the travel expense reimbursement limit?',
      'How does the notice period work?',
      'What are the office timings?',
    ],
  },
  {
    category: 'Software Access',
    icon: '🔧',
    queries: [
      'I need access to Gitea',
      'Can I get Mattermost access?',
      'I want access to Gitea and Mattermost',
    ],
  },
  {
    category: 'Access Request Status',
    icon: '📦',
    queries: [
      "What's the status of my access requests?",
      'Did my Gitea request get approved?',
      'Did my Mattermost request get approved?',
    ],
  },
];
