/**
 * API Client for Human Agent App
 * 
 * Handles all communication with Edge Functions
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://your-project.supabase.co/functions/v1';

let onUnauthorizedCallback: (() => void) | null = null;

/**
 * Register a callback for 401 Unauthorized responses
 */
export function onUnauthorized(callback: () => void) {
  onUnauthorizedCallback = callback;
}

/**
 * Get stored auth token
 */
function getToken(): string | null {
  return localStorage.getItem('agent_token');
}

/**
 * Make authenticated request
 */
async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();
  
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    if (response.status === 401 && onUnauthorizedCallback) {
      onUnauthorizedCallback();
    }
    throw new Error(data.error || 'Request failed');
  }

  return data;
}

// =============================================================================
// Auth API
// =============================================================================

export interface RequestOtpResponse {
  success: boolean;
  message: string;
  isFirstLogin: boolean;
}

export interface AvailableClient {
  client_id: string;
  business_name: string;
  channel_type: string | null;
  channel_id: string | null;
}

export type AgentLevel = 'agent' | 'manager' | 'admin';

export interface VerifyOtpResponse {
  success: boolean;
  token: string;
  agent: {
    id: string;
    phone: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    level: AgentLevel;
  };
  isFirstLogin: boolean;
  availableClients?: AvailableClient[];
}

export async function fetchAvailableClients(): Promise<{ availableClients: AvailableClient[] }> {
  return request('/agent-auth/available-clients');
}

export async function requestOtp(phone: string, clientSchema: string): Promise<RequestOtpResponse> {
  return request('/agent-auth/request-otp', {
    method: 'POST',
    body: JSON.stringify({ phone, clientSchema }),
  });
}

export async function verifyOtp(
  phone: string,
  otp: string,
  clientSchema: string
): Promise<VerifyOtpResponse> {
  return request('/agent-auth/verify-otp', {
    method: 'POST',
    body: JSON.stringify({ phone, otp, clientSchema }),
  });
}

export async function completeProfile(
  firstName: string,
  lastName?: string,
  email?: string
): Promise<{ success: boolean }> {
  return request('/agent-auth/complete-profile', {
    method: 'POST',
    body: JSON.stringify({ firstName, lastName, email }),
  });
}

// =============================================================================
// Escalations API
// =============================================================================

export interface Escalation {
  id: string;
  reason: string;
  ai_summary: string | null;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'open' | 'assigned' | 'in_progress' | 'resolved' | 'cancelled';
  created_at: string;
  assigned_to: string | null;
  assigned_at: string | null;
  session: {
    id: string;
    channel_user_id: string;
    current_state: string;
    context?: Record<string, unknown>;
    contact: {
      full_name: string | null;
      phone: string | null;
      email: string | null;
    } | null;
  };
}

export interface Message {
  id: string;
  session_id: string;
  direction: 'inbound' | 'outbound';
  type: string;
  content: string | null;
  media_url?: string | null;
  reply_to_message_id?: string | null;
  created_at: string;
  sent_by_agent_id?: string | null; // FK to human_agents - indicates message sent by human agent
}

export interface EscalationDetail extends Escalation {
  session: Escalation['session'] & {
    channel_type: string;
    channel_id: string;
    contact: {
      id: string;
      full_name: string | null;
      phone: string | null;
      email: string | null;
      country: string | null;
      language: string | null;
    } | null;
  };
  assigned_agent?: {
    id: string;
    first_name: string | null;
    last_name: string | null;
  };
}

export async function listEscalations(clientId?: string | null): Promise<{ escalations: Escalation[] }> {
  const params = clientId ? `?clientId=${encodeURIComponent(clientId)}` : '';
  return request(`/manage-escalations/escalations${params}`);
}

export async function getEscalation(id: string): Promise<{
  escalation: EscalationDetail;
  messages: Message[];
}> {
  return request(`/manage-escalations/escalations/${id}`);
}

export async function assignEscalation(id: string): Promise<{ success: boolean }> {
  return request(`/manage-escalations/escalations/${id}/assign`, {
    method: 'PATCH',
  });
}

export async function resolveEscalation(
  id: string,
  notes?: string
): Promise<{ success: boolean }> {
  return request(`/manage-escalations/escalations/${id}/resolve`, {
    method: 'PATCH',
    body: JSON.stringify({ notes }),
  });
}

// =============================================================================
// Messaging API
// =============================================================================

export async function sendMessage(
  escalationId: string,
  message: string,
  replyToMessageId?: string
): Promise<{ success: boolean; messageId: string }> {
  return request('/send-human-message', {
    method: 'POST',
    body: JSON.stringify({ escalationId, message, replyToMessageId }),
  });
}

export async function sendImageMessage(
  escalationId: string,
  imageFile: File,
  caption?: string,
  replyToMessageId?: string
): Promise<{ success: boolean; messageId: string }> {
  const formData = new FormData();
  formData.append('escalationId', escalationId);
  formData.append('image', imageFile);
  if (caption) {
    formData.append('caption', caption);
  }
  if (replyToMessageId) {
    formData.append('replyToMessageId', replyToMessageId);
  }

  const token = getToken();
  
  const response = await fetch(`${API_BASE_URL}/send-human-message`, {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: formData,
  });

  const data = await response.json();

  if (!response.ok) {
    if (response.status === 401 && onUnauthorizedCallback) {
      onUnauthorizedCallback();
    }
    throw new Error(data.error || 'Request failed');
  }

  return data;
}

export async function sendVideoMessage(
  escalationId: string,
  videoFile: File,
  caption?: string,
  replyToMessageId?: string
): Promise<{ success: boolean; messageId: string; mediaUrl: string }> {
  const formData = new FormData();
  formData.append('escalationId', escalationId);
  formData.append('video', videoFile);
  if (caption) {
    formData.append('caption', caption);
  }
  if (replyToMessageId) {
    formData.append('replyToMessageId', replyToMessageId);
  }

  const token = getToken();
  
  const response = await fetch(`${API_BASE_URL}/send-human-message`, {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: formData,
  });

  const data = await response.json();

  if (!response.ok) {
    if (response.status === 401 && onUnauthorizedCallback) {
      onUnauthorizedCallback();
    }
    throw new Error(data.error || 'Request failed');
  }

  return data;
}

export async function sendTemplateMessage(
  escalationId: string,
  templateName: string,
  languageCode: string = 'es_CO',
  replyToMessageId?: string
): Promise<{ success: boolean; messageId: string }> {
  return request('/send-human-message', {
    method: 'POST',
    body: JSON.stringify({ escalationId, templateName, languageCode, replyToMessageId }),
  });
}

// =============================================================================
// Templates API
// =============================================================================

export interface WhatsAppTemplate {
  name: string;
  status: string;
  category: string;
  language: string;
  components: any[];
}

export async function listTemplates(): Promise<{ templates: WhatsAppTemplate[] }> {
  return request('/manage-whatsapp-templates/templates');
}

// =============================================================================
// Sessions API
// =============================================================================

export interface SessionSummary {
  id: string;
  channel_type: string;
  channel_id: string;
  channel_user_id: string;
  current_state: string;
  is_escalated: boolean;
  last_message_at: string | null;
  created_at: string;
  contact: {
    id: string;
    full_name: string | null;
    phone: string | null;
  } | null;
  last_message?: {
    content: string | null;
    direction: 'inbound' | 'outbound';
    type: string;
    media_url?: string | null;
  } | null;
}

export interface SessionDetail extends SessionSummary {
  previous_state: string | null;
  context: Record<string, unknown>;
  contact: {
    id: string;
    full_name: string | null;
    phone: string | null;
    email: string | null;
    country: string | null;
    language: string | null;
  } | null;
}

export async function listSessions(params: {
  clientId?: string | null;
  cursor?: string | null;
  limit?: number;
  search?: string | null;
} = {}): Promise<{ sessions: SessionSummary[]; hasMore: boolean }> {
  const qp = new URLSearchParams();
  if (params.clientId) qp.set('clientId', params.clientId);
  if (params.cursor) qp.set('cursor', params.cursor);
  if (params.limit) qp.set('limit', String(params.limit));
  if (params.search) qp.set('search', params.search);
  const qs = qp.toString();
  return request(`/manage-escalations/sessions${qs ? '?' + qs : ''}`);
}

export async function getSession(id: string): Promise<{
  session: SessionDetail;
  messages: Message[];
}> {
  return request(`/manage-escalations/sessions/${id}`);
}

export async function escalateSession(id: string): Promise<{ 
  success: boolean; 
  escalationId: string 
}> {
  return request(`/manage-escalations/sessions/${id}/escalate`, {
    method: 'POST',
  });
}
// =============================================================================
// Push Subscriptions API
// =============================================================================

export async function savePushSubscription(
  subscription: PushSubscription,
  deviceName?: string
): Promise<{ success: boolean }> {
  return request('/manage-push-subscriptions', {
    method: 'POST',
    body: JSON.stringify({ subscription, deviceName }),
  });
}

export async function deletePushSubscription(
  subscription?: PushSubscription
): Promise<{ success: boolean }> {
  return request('/manage-push-subscriptions', {
    method: 'DELETE',
    body: JSON.stringify({ subscription }),
  });
}

// =============================================================================
// Followup Configs API
// =============================================================================

export interface FollowupVariableConfig {
  key: string;
  type: 'literal' | 'llm' | 'context';
  value?: string;
  prompt?: string;
  field?: string;
}

export interface FollowupConfig {
  name: string;
  type: 'text' | 'template';
  content: string;
  variables_config: FollowupVariableConfig[];
  created_at?: string;
  updated_at?: string;
}

export async function listFollowupConfigs(): Promise<FollowupConfig[]> {
  return request('/manage-followup-configs');
}

export async function getFollowupConfig(name: string): Promise<FollowupConfig> {
  return request(`/manage-followup-configs?name=${encodeURIComponent(name)}`);
}

export async function upsertFollowupConfig(
  config: Omit<FollowupConfig, 'created_at' | 'updated_at'>
): Promise<FollowupConfig> {
  return request('/manage-followup-configs', {
    method: 'POST',
    body: JSON.stringify(config),
  });
}

export async function deleteFollowupConfig(name: string): Promise<{ success: boolean }> {
  return request(`/manage-followup-configs?name=${encodeURIComponent(name)}`, {
    method: 'DELETE',
  });
}

// =============================================================================
// Followup Queue API
// =============================================================================

export interface FollowupQueueItem {
  id: string;
  session_id: string;
  scheduled_at: string;
  followup_type: string | null;
  template_name: string | null;
  template_params: Record<string, unknown> | null;
  status: 'pending' | 'sent' | 'cancelled' | 'failed';
  sent_at: string | null;
  error_message: string | null;
  created_at: string;
  sessions: {
    contact_id: string;
    current_state: string;
    contacts: {
      phone: string;
      full_name: string | null;
    };
  };
}

export async function listFollowupQueue(
  options?: { status?: string; sessionId?: string }
): Promise<FollowupQueueItem[]> {
  const params = new URLSearchParams({ resource: 'queue' });
  if (options?.status) params.set('status', options.status);
  if (options?.sessionId) params.set('sessionId', options.sessionId);
  return request(`/manage-followup-configs?${params.toString()}`);
}

export async function cancelFollowupQueueItem(id: string): Promise<FollowupQueueItem> {
  return request(`/manage-followup-configs?resource=queue&id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function cancelSessionFollowups(sessionId: string): Promise<{ cancelled: number }> {
  return request(`/manage-followup-configs?resource=queue&sessionId=${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
  });
}

// =============================================================================
// State Machines API
// =============================================================================

export interface FollowupSequenceItem {
  interval: string;
  configName: string;
}

export interface StateConfig {
  state: string;
  objective: string;
  description: string;
  completionSignals: string[];
  ragCategories: string[];
  allowedTransitions: string[];
  transitionGuidance: Record<string, string>;
  maxMessages?: number;
  followupSequence?: FollowupSequenceItem[];
}

export interface StateMachineSummary {
  id: string;
  name: string;
  version: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface StateMachine extends StateMachineSummary {
  initial_state: string;
  states: Record<string, StateConfig>;
  visualization?: string;
  knowledgeBaseIds?: string[];
}

export async function listStateMachines(): Promise<StateMachineSummary[]> {
  return request('/manage-state-machines');
}

export async function getStateMachine(id: string): Promise<StateMachine> {
  return request(`/manage-state-machines?id=${encodeURIComponent(id)}`);
}

export async function saveStateMachine(
  machine: Pick<StateMachine, 'name' | 'version' | 'initial_state' | 'states' | 'visualization'> & { id?: string }
): Promise<StateMachine> {
  return request('/manage-state-machines', {
    method: 'POST',
    body: JSON.stringify(machine),
  });
}

// =============================================================================
// Clients API
// =============================================================================

export interface ClientConfigSummary {
  id: string;
  client_id: string;
  schema_name: string;
  channel_type: string | null;
  channel_id: string | null;
  state_machine_name: string;
  storage_bucket: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  config: {
    business?: { name?: string; language?: string };
    [key: string]: unknown;
  };
}

export interface ClientSecretInfo {
  channel_type: string;
  has_secrets: boolean;
  phoneNumberId?: string | null;
  wabaId?: string | null;
}

export interface ClientConfigDetail extends ClientConfigSummary {
  secrets: ClientSecretInfo[];
}

export interface StorageBucket {
  id: string;
  name: string;
  public: boolean;
  created_at: string;
}

export interface StateMachineOption {
  id: string;
  name: string;
  version: string;
  is_active: boolean;
}

export async function listClients(): Promise<ClientConfigSummary[]> {
  return request('/manage-clients');
}

export async function getClient(id: string): Promise<ClientConfigDetail> {
  return request(`/manage-clients?id=${encodeURIComponent(id)}`);
}

export async function createClient(data: Record<string, unknown>): Promise<ClientConfigDetail> {
  return request('/manage-clients', {
    method: 'POST',
    body: JSON.stringify({ action: 'create', ...data }),
  });
}

export async function updateClient(id: string, data: Record<string, unknown>): Promise<ClientConfigDetail> {
  return request('/manage-clients', {
    method: 'POST',
    body: JSON.stringify({ action: 'update', id, ...data }),
  });
}

export async function toggleClientActive(id: string): Promise<{ success: boolean; is_active: boolean }> {
  return request('/manage-clients', {
    method: 'POST',
    body: JSON.stringify({ action: 'toggle-active', id }),
  });
}

export async function listBuckets(): Promise<StorageBucket[]> {
  return request('/manage-clients?action=buckets');
}

export async function createBucket(name: string): Promise<StorageBucket> {
  return request('/manage-clients', {
    method: 'POST',
    body: JSON.stringify({ action: 'create-bucket', name }),
  });
}

export async function listTenantStateMachines(schema: string): Promise<StateMachineOption[]> {
  return request(`/manage-clients?action=state-machines&schema=${encodeURIComponent(schema)}`);
}

// =============================================================================
// Agents API (for admin management of agent-client access)
// =============================================================================

export interface HumanAgent {
  id: string;
  phone: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  is_active: boolean;
  level: AgentLevel;
  allowed_client_ids: string[] | null;
  created_at: string;
}

export async function listAgents(schema: string): Promise<HumanAgent[]> {
  return request(`/manage-clients?action=agents&schema=${encodeURIComponent(schema)}`);
}

export async function updateAgentClients(
  schema: string,
  agentId: string,
  allowedClientIds: string[] | null
): Promise<{ success: boolean; agent: HumanAgent }> {
  return request('/manage-clients', {
    method: 'POST',
    body: JSON.stringify({
      action: 'update-agent-clients',
      schema,
      agentId,
      allowedClientIds,
    }),
  });
}

export async function updateAgentLevel(
  schema: string,
  agentId: string,
  level: AgentLevel,
): Promise<{ success: boolean; agent: HumanAgent }> {
  return request('/manage-clients', {
    method: 'POST',
    body: JSON.stringify({
      action: 'update-agent-level',
      schema,
      agentId,
      level,
    }),
  });
}
