# Escalation to Human Agent — Implementation Review

**Author**: BMad Master  
**Date**: 2026-02-09  
**Status**: Reviewed & Fixed  
**Scope**: Full pipeline — LLM detection → Engine processing → Database → Edge Functions → Human Agent WebApp

---

## 1. Architecture Overview

The escalation system is a **5-layer pipeline**:

```
User Message → LLM Detection → Engine Processing → Database (Supabase) → Edge Functions API → Human Agent WebApp (Vue 3 PWA)
```

### 1.1 LLM Detection Layer

**File**: `packages/sales-engine/src/llm/schemas.ts`

The Gemini/OpenAI model evaluates every user message and can output an optional `escalation` object in its structured JSON response:

```typescript
escalation: z.object({
  shouldEscalate: z.boolean(),
  reason: z.enum([
    "explicit_request", "frustration", "high_value", "technical_issue",
    "ai_uncertainty", "complex_issue", "legal_regulatory"
  ]),
  confidence: z.number().min(0).max(1),
  summary: z.string().optional()
}).optional()
```

The LLM is instructed about escalation signals in the system prompt (`packages/sales-engine/src/prompts/templates.ts`):

- **explicit_request**: User explicitly asks for a human ("hablar con agente", "persona real")
- **frustration**: Significant anger or frustration ("estafa", "fraude", threatening language)
- **high_value**: Large investment amounts or VIP-level needs
- **technical_issue**: Technical problems the AI cannot resolve (account issues, platform bugs)
- **ai_uncertainty**: AI cannot adequately answer the question
- **complex_issue**: Requires human judgment (refunds, disputes, account deletion)
- **legal_regulatory**: User mentions legal action ("abogado", "demanda", "denuncia")

Additionally, the LLM can set `isUncertain: true` as a separate flag. The engine uses this as a **safety net** — if `isUncertain` is true but no explicit escalation block was provided, the engine auto-escalates with reason `ai_uncertainty`.

### 1.2 Engine Processing Layer

**File**: `packages/sales-engine/src/engine/conversation.ts`

The `processMessage` function handles escalation in several steps:

#### Step 3: Escalation Guard & Resume Logic
```
if (session.isEscalated) {
  - Check hours since last message
  - Check if agent is still actively working (escalationStore.hasActive)
  - Resume ONLY if: hoursSinceLastMessage >= 1 AND no active escalation
  - Otherwise: save inbound message (for history) but return empty responses
}
```

#### Step 11: LLM-Recommended Escalation
```
if (structuredResponse.escalation?.shouldEscalate) {
  1. Send WhatsApp notification to configured number
  2. Set session: isEscalated=true, status='paused', currentState='escalated'
  3. Save escalation response message to DB
  4. Create escalation record via escalationStore
  5. Cancel all pending follow-ups via followupStore.cancelPending
  6. Return escalation result to caller
}
```

#### Step 11b: isUncertain Safety Net
```
if (structuredResponse.isUncertain && !structuredResponse.escalation?.shouldEscalate) {
  - Same flow as Step 11 but with:
    - reason: 'ai_uncertainty'
    - priority: 'medium' (vs 'high' for explicit)
    - confidence: 0.5
}
```

#### Escalation Response Messages
`createEscalationResponse()` maps each reason to a user-facing Spanish message:

| Reason | Message |
|--------|---------|
| explicit_request | ¡Por supuesto! Te conecto con uno de nuestros asesores. Un momento por favor. 🙋‍♂️ |
| frustration | Entiendo tu frustración y quiero ayudarte. Te conecto con un asesor... |
| high_value | Para brindarte la mejor atención personalizada, te conecto con uno de nuestros asesores senior. |
| technical_issue | Veo que tienes un problema técnico. Te conecto con soporte especializado. |
| complex_issue | Tu caso requiere atención especializada. Te conecto con uno de nuestros expertos. |
| ai_uncertainty | Para darte la mejor respuesta, te conecto con uno de nuestros expertos. |
| legal_regulatory | Este tema requiere atención de nuestro equipo especializado. Te conecto ahora mismo. |

### 1.3 Database Layer

**Migration**: `supabase/migrations/00018_escalation_management.sql`

#### Tables (in client template schema)

**`human_agents`**
- `id` UUID PK
- `phone`, `full_name`, `email`
- `is_active`, `created_at`

**`agent_otp_sessions`**
- `id` UUID PK
- `agent_id` FK → human_agents
- `otp_code`, `expires_at`, `verified`
- Used for OTP-based agent authentication

**`escalations`**
- `id` UUID PK
- `session_id` FK → sessions
- `reason` TEXT NOT NULL
- `ai_summary`, `ai_confidence`
- `priority` ('low' | 'medium' | 'high' | 'urgent')
- `status` ('open' | 'assigned' | 'in_progress' | 'resolved' | 'cancelled')
- `assigned_to` FK → human_agents
- `assigned_at`, `resolved_at`
- `resolution_notes`
- Indexes on `session_id`, `status`, `assigned_to`

#### Status Lifecycle
```
open → assigned → in_progress → resolved
                              → cancelled
```

### 1.4 Edge Functions Layer

#### `manage-escalations/index.ts`
Full CRUD API for the Human Agent WebApp:
- `GET /escalations` — List all open/assigned escalations
- `GET /escalations/:id` — Get escalation with session details and messages
- `POST /escalations/:id/assign` — Assign to agent
- `POST /escalations/:id/resolve` — Resolve with notes
- `GET /sessions` — List all sessions (for "All Chats" view)
- `GET /sessions/:id` — Get session with full conversation history
- `POST /sessions/:id/escalate` — Manual "Take Over" (creates escalation, sets session status='paused')

All endpoints require JWT agent authentication.

#### `send-human-message/index.ts`
Sends messages from human agents to customers via WhatsApp Cloud API:
- Supports: text, image, video, template messages
- Reply-to (WhatsApp context quoting)
- Auto-assigns escalation if not yet assigned
- Updates escalation status to `in_progress`
- Saves message to DB with `sent_by_agent_id`
- Uploads media to Supabase Storage (dynamic bucket from `client_configs`)
- Resolves WhatsApp access token from `client_secrets` (fallback to env var)

#### `notify-agent/index.ts`
Web Push notifications via VAPID:
- Triggers on: `new_escalation`, `new_message` (for assigned agents), `new_deposit`
- Fetches push subscriptions from `push_subscriptions` table
- Broadcasts to ALL agents for new escalations
- Sends to assigned agent only for new messages
- Cleans up invalid subscriptions automatically

### 1.5 Human Agent WebApp

**Location**: `apps/human-agent-app/`  
**Stack**: Vue 3 + Pinia + TailwindCSS + Supabase Realtime  
**Type**: PWA (installable, push notifications)

#### Authentication (`stores/auth.ts`)
- OTP-based: agent enters phone → receives OTP → verifies → gets JWT
- JWT stored in localStorage with agent data and client schema
- Profile completion flow for new agents

#### Escalation Queue (`views/QueueView.vue`, `stores/escalations.ts`)
- Displays open and assigned escalations sorted by priority/time
- Shows: contact name, reason label, priority badge, time since creation
- Tap to open chat view

#### Chat View (`views/ChatView.vue`)
- Full WhatsApp-style chat interface
- Message types: text, image, video, sticker
- Date separators, timestamps, sender labels (You/AI/Customer)
- **24-hour window awareness**: Shows countdown timer, disables free-form input when expired
- **Template sending**: When window expired, shows "Send Template to Resume" button
- **Reply-to**: Long-press/right-click context menu to quote messages
- **Media upload**: Image and video with preview and optional caption
- **Resolve modal**: Notes field + confirm button → redirects to queue
- **Realtime**: Supabase Realtime subscription for live inbound messages
- **Optimistic updates**: Agent messages appear immediately before server confirmation

#### All Chats View (`views/ConversationView.vue`, `stores/sessions.ts`)
- Read-only view of any conversation (not just escalated)
- "Take Over" button for non-escalated sessions → creates escalation → redirects to chat
- Shows AI vs Agent vs Customer message differentiation

#### Realtime Integration
Both `escalations.ts` and `sessions.ts` stores subscribe to Supabase Realtime:
```typescript
supabase.channel(`escalation-messages:${sessionId}`)
  .on('postgres_changes', { event: 'INSERT', schema: CLIENT_SCHEMA, table: 'messages', filter: `session_id=eq.${sessionId}` })
```
- Skips outbound agent messages (added optimistically)
- Deduplicates by message ID

---

## 2. Key Flows

### 2.1 AI-Triggered Escalation
```
1. User sends message via WhatsApp
2. webhook-whatsapp receives → routes to sales-engine
3. Engine calls LLM → LLM returns escalation.shouldEscalate=true
4. Engine:
   a. Sends WhatsApp notification to configured number
   b. Creates escalation record (status: 'open')
   c. Sets session: isEscalated=true, status='paused', currentState='escalated'
   d. Cancels pending follow-ups
   e. Sends user-facing escalation message
5. notify-agent Edge Function triggers (via DB trigger/webhook)
   → Sends Web Push to all agents
6. Agent opens app → sees escalation in queue → taps to open chat
7. Agent sends message → send-human-message:
   a. Auto-assigns escalation to agent
   b. Updates status to 'in_progress'
   c. Saves message to DB
   d. Sends via WhatsApp Cloud API
8. Agent resolves → manage-escalations:
   a. Sets escalation status='resolved'
   b. Sets session: isEscalated=false, status='active'
   c. LLM determines next state via buildEscalationResolutionPrompt
```

### 2.2 Manual Takeover
```
1. Agent browses "All Chats" → sees active conversation
2. Clicks "Take Over" → POST /sessions/:id/escalate
3. Edge Function:
   a. Checks session not already escalated
   b. Creates escalation record (status: 'open', reason: 'agent_initiated')
   c. Sets session: is_escalated=true, status='paused'
4. Redirects to chat view with new escalation ID
```

### 2.3 Auto-Resume After Silence
```
1. User sends message to escalated session
2. Engine checks:
   a. Is session escalated? → Yes
   b. Hours since last message >= 1? → Check
   c. Is agent still actively working? (escalationStore.hasActive) → Check
3. If 1h passed AND no active escalation → Resume:
   - isEscalated=false, status='active'
   - Process message normally with LLM
4. If agent still active OR < 1h → Save message to history, return empty responses
```

---

## 3. Bugs Found & Fixed

### 3.1 Critical

| # | Bug | Fix | Files |
|---|-----|-----|-------|
| 1 | Zod schema missing `high_value` and `technical_issue` escalation reasons — LLM could never produce them | Added to enum | `llm/schemas.ts` |
| 2 | `StructuredLLMResponse` interface out of sync with `EscalationReason` type | Synced union type | `llm/types.ts` |
| 3 | `isUncertain=true` without explicit escalation was silently ignored — uncertain responses went to users without safety net | Added auto-escalation safety net (step 11b) | `engine/conversation.ts` |
| 12 | LLM retry loop: `llmResponse` not reset between iterations — retries re-parsed stale response instead of calling LLM again | Added `llmResponse = null` at top of loop | `engine/conversation.ts` |

### 3.2 Medium

| # | Bug | Fix | Files |
|---|-----|-----|-------|
| 4 | Pending follow-ups not cancelled on escalation — could fire during human agent conversation | Added `followupStore.cancelPending()` call | `engine/conversation.ts` |
| 5 | Resume race condition: 1h timer didn't check if agent was still actively working | Added `escalationStore.hasActive()` check | `engine/conversation.ts`, `engine/types.ts`, `adapters/escalation-store.ts` |
| 6 | AI-triggered escalation didn't set `status='paused'` (only manual takeover did) | Added `status: 'paused'` to escalation updates | `engine/conversation.ts` |
| 7 | Storage bucket hardcoded to `'media-tag-markets'` — breaks multi-tenancy | Dynamic lookup from `client_configs` | `send-human-message/index.ts` |
| 8 | WhatsApp access token hardcoded to `TAG_WHATSAPP_ACCESS_TOKEN` env var | Dynamic lookup from `client_secrets` with env fallback | `send-human-message/index.ts` |

### 3.3 Low

| # | Bug | Fix | Files |
|---|-----|-----|-------|
| 9 | QueueView missing labels for `high_value` and `technical_issue` reasons | Added labels | `QueueView.vue` |
| 10 | Dead code: `examples.length < 0` (always false) | Changed to `> 0` | `prompts/templates.ts` |
| 11 | Prompt templates missing `high_value` and `technical_issue` escalation signal descriptions | Added to both prompt builders | `prompts/templates.ts` |

### 3.4 Known Issues (Not Fixed)

- **CORS wildcard `*`**: All edge functions use `Access-Control-Allow-Origin: '*'`. Should be restricted to the human-agent-app domain in production via environment variable.
- **No queue polling/Realtime**: `QueueView.vue` only fetches escalations on mount. No Realtime subscription or polling for the queue list itself — agents must manually refresh or rely on push notifications.

---

## 4. Test Coverage

**File**: `packages/sales-engine/tests/engine.test.ts` (12 tests)  
**File**: `packages/sales-engine/tests/engine_retry.test.ts` (2 tests)  
**Result**: 24/24 passing

### Escalation-Specific Tests
| Test | What It Verifies |
|------|-----------------|
| should escalate when user explicitly requests human | LLM escalation detection, result shape |
| should not process messages for escalated sessions | Guard blocks LLM calls for recent escalations |
| should resume escalated session after 1 hour of silence | Time-based resume when no agent active |
| should send notification on escalation | `notificationService.sendEscalationAlert` called |
| should set status to paused and cancel follow-ups on escalation | `status='paused'`, `cancelPending` called, escalation record created |
| should auto-escalate when isUncertain is true | Safety net: escalation, notification, follow-up cancellation, medium priority |
| should NOT auto-escalate when isUncertain is false | No false positives |
| should NOT resume escalated session when agent is still active | `hasActive()=true` blocks resume even after 1h |
| should resume escalated session when agent is NOT active and 1h passed | `hasActive()=false` + 1h → resumes normally |

---

## 5. File Reference

### Sales Engine Package
| File | Purpose |
|------|---------|
| `packages/sales-engine/src/llm/schemas.ts` | Zod schema for LLM structured output (incl. escalation) |
| `packages/sales-engine/src/llm/types.ts` | TypeScript interfaces for LLM response |
| `packages/sales-engine/src/engine/conversation.ts` | Core engine: escalation detection, guard, resume, safety net |
| `packages/sales-engine/src/engine/types.ts` | Session, EscalationReason, EscalationStore, EscalationResult interfaces |
| `packages/sales-engine/src/escalation/types.ts` | NotificationService interface |
| `packages/sales-engine/src/escalation/whatsapp-notification.ts` | WhatsApp template notification sender |
| `packages/sales-engine/src/prompts/templates.ts` | System prompts with escalation signal instructions |

### Supabase
| File | Purpose |
|------|---------|
| `supabase/migrations/00018_escalation_management.sql` | DB schema: escalations, human_agents, agent_otp_sessions |
| `supabase/functions/_shared/adapters/escalation-store.ts` | Supabase adapter for EscalationStore (create + hasActive) |
| `supabase/functions/manage-escalations/index.ts` | CRUD API for escalations and sessions |
| `supabase/functions/send-human-message/index.ts` | Agent → Customer messaging via WhatsApp |
| `supabase/functions/notify-agent/index.ts` | Web Push notifications to agents |

### Human Agent WebApp
| File | Purpose |
|------|---------|
| `apps/human-agent-app/src/api/client.ts` | API client for Edge Functions |
| `apps/human-agent-app/src/api/supabase.ts` | Supabase client + Realtime setup |
| `apps/human-agent-app/src/stores/auth.ts` | Agent authentication (OTP + JWT) |
| `apps/human-agent-app/src/stores/escalations.ts` | Escalation queue state, messaging, Realtime |
| `apps/human-agent-app/src/stores/sessions.ts` | All sessions state, manual takeover |
| `apps/human-agent-app/src/views/QueueView.vue` | Escalation queue UI |
| `apps/human-agent-app/src/views/ChatView.vue` | Chat interface with 24h window, templates, media |
| `apps/human-agent-app/src/views/ConversationView.vue` | Read-only conversation view + Take Over |
| `apps/human-agent-app/src/router.ts` | Routes + auth guard |
