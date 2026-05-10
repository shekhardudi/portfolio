import { ApiError, apiFetch } from '@/lib/api';

const BASE = process.env.NEXT_PUBLIC_AGENTIC_HR_API ?? '/agentic-hr';

export interface ChatRequest {
  session_id: string;
  message: string;
  employee_email?: string;
  /** Client-supplied UUID for this chat round-trip. The backend caches the
   *  terminal response under this id for ~10 min so a client that navigates
   *  away mid-call can reattach via getChatResult(request_id). */
  request_id?: string;
}

export interface Citation {
  document: string;
  section?: string;
}

export type ChatStatus = 'complete' | 'pending_approval' | 'needs_clarification' | string;

export interface ChatResponse {
  session_id: string;
  reply: string;
  status?: ChatStatus;
  request_id?: string | null;
  citations: Citation[];
  pending_approvals?: ApprovalItem[];
  tool_calls?: { name: string; arguments: unknown }[];
}

export interface ApprovalItem {
  id: string;
  session_id: string;
  tool: string;
  arguments: Record<string, unknown>;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
}

export interface ApprovalDecision {
  id: string;
  decision: 'approve' | 'reject';
  reason?: string;
}

interface BackendChatResponse {
  response: string;
  status?: ChatStatus;
  request_id?: string | null;
  citations?: Citation[];
}

interface BackendPendingApproval {
  request_id: string;
  requester_email: string;
  requester_name?: string;
  packages: string[];
  status: string;
  created_ts: string;
}

function mapStatus(status: string): ApprovalItem['status'] {
  if (status === 'approved') return 'approved';
  if (status === 'denied' || status === 'rejected') return 'rejected';
  return 'pending';
}

function mapPendingApproval(item: BackendPendingApproval): ApprovalItem {
  return {
    id: item.request_id,
    session_id: '',
    tool: item.packages.join(', ') || 'access_request',
    arguments: {
      requester_email: item.requester_email,
      requester_name: item.requester_name ?? '',
      packages: item.packages,
    },
    status: mapStatus(item.status),
    created_at: item.created_ts,
  };
}

export function chat(req: ChatRequest, signal?: AbortSignal): Promise<ChatResponse> {
  return apiFetch<BackendChatResponse>(`${BASE}/chat`, {
    method: 'POST',
    body: JSON.stringify({
      session_id: req.session_id,
      message: req.message,
      employee_email: req.employee_email ?? 'demo@example.com',
      request_id: req.request_id,
    }),
    signal,
    timeoutMs: 90_000,
  }).then((res) => ({
    session_id: req.session_id,
    reply: res.response,
    status: res.status,
    request_id: res.request_id ?? null,
    citations: res.citations ?? [],
    pending_approvals: [],
    tool_calls: [],
  }));
}

/**
 * Poll the result endpoint for a detached chat invocation. Returns the
 * cached terminal payload, a "still running" sentinel, or null if the
 * server has forgotten the request (expired / restart).
 *
 * Used by Demo.tsx on remount to reattach to a chat that was in flight
 * when the user navigated away.
 */
export type ChatResultPoll =
  | { status: 'running' }
  | { status: 'completed'; response: ChatResponse }
  | { status: 'error'; error: string }
  | { status: 'unknown' };

interface BackendChatResultPoll {
  status: 'running' | 'completed' | 'error';
  response?: BackendChatResponse;
  error?: string;
}

export async function getChatResult(
  requestId: string,
  sessionId: string,
): Promise<ChatResultPoll> {
  try {
    const res = await apiFetch<BackendChatResultPoll>(
      `${BASE}/chat/result/${encodeURIComponent(requestId)}`,
      { method: 'GET', timeoutMs: 10_000 },
    );
    if (res.status === 'running') return { status: 'running' };
    if (res.status === 'error') {
      return { status: 'error', error: res.error ?? 'Unknown error' };
    }
    if (res.status === 'completed' && res.response) {
      return {
        status: 'completed',
        response: {
          session_id: sessionId,
          reply: res.response.response,
          status: res.response.status,
          request_id: res.response.request_id ?? null,
          citations: res.response.citations ?? [],
          pending_approvals: [],
          tool_calls: [],
        },
      };
    }
    return { status: 'unknown' };
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return { status: 'unknown' };
    throw e;
  }
}

/**
 * Best-effort cancel for an in-flight chat. Frees the LangGraph worker slot
 * in real time. Errors are swallowed by the caller — the version guard on
 * the response side already protects the UI from late replies.
 */
export async function cancelChat(sessionId: string): Promise<void> {
  if (!sessionId) return;
  try {
    await apiFetch<unknown>(`${BASE}/chat/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
      timeoutMs: 10_000,
    });
  } catch {
    /* best-effort */
  }
}

export function listApprovals(session_id?: string) {
  void session_id;
  return apiFetch<BackendPendingApproval[]>(`${BASE}/approvals`).then((items) =>
    items.map(mapPendingApproval),
  );
}

export function decideApproval(
  decision: ApprovalDecision,
  approverEmail: string,
) {
  return apiFetch<{ request_id: string; status: string }>(
    `${BASE}/approvals/${encodeURIComponent(decision.id)}`,
    {
      method: 'POST',
      body: JSON.stringify({
        decision: decision.decision === 'approve' ? 'approved' : 'denied',
        approver_email: approverEmail,
        reason: decision.reason,
      }),
    },
  ).then((res) => ({
    id: res.request_id,
    session_id: '',
    tool: 'access_request',
    arguments: {},
    status: mapStatus(res.status),
    created_at: new Date().toISOString(),
  }));
}
