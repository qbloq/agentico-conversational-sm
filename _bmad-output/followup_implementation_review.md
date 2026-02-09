# Technical Review: Follow-up Sequence Implementation

BMad Master has completed a thorough technical review of the follow-up implementation. This system is designed to re-engage users who stop responding, using a state-based sequence of messages.

## 1. System Components
The architecture consists of four main layers:

*   **Database Schema**: 
    *   `followup_configs`: A centralized registry for reusable follow-up definitions (text or WhatsApp templates).
    *   `followup_queue`: Tracks individual follow-up events, including `sequence_index` and `followup_config_name`.
*   **Scheduling Store**: `createSupabaseFollowupStore` handles state transitions and cancellations.
    *   `cancelPending`: Hard-stops all future follow-ups when the user sends a message (now executed early in the pipeline).
    *   `scheduleNext`: Calculates the next interval based on the `followupSequence` defined in the current state's configuration.
*   **Core Engine**: `ConversationEngine` and `StateMachineStore`.
    *   `getFollowupConfig`: Retrieves definitions from the registry.
    *   `generateFollowupVariable`: Dynamically generates LLM-powered variables for templates or text based on specific prompts.
*   **Execution Worker**: `process-followups` Edge Function.
    *   Triggered periodically (via pg_cron).
    *   Orchestrates **Variable Resolution** (Literal vs. Context vs. LLM).
    *   Enforces the **24h Mandate**: Automatically falls back to WhatsApp templates if the customer interaction window has closed.
*   **Management API**: `manage-followup-configs` Edge Function.
    *   Provides full CRUD interface for the `followup_configs` registry.
    *   Supports multi-tenancy via `schema` parameter.

## 2. Triggering Mechanism: Temporal Polling
The system does not "push" follow-ups in real-time. Instead, it uses a **Temporal Polling** pattern:

1.  **The Beat (`pg_cron`)**: A Supabase cron job is configured to ping the `process-followups` Edge Function at a fixed interval (typically every **1 minute**).
2.  **The Fetch**: The worker queries the `followup_queue` across all active client schemas for any row where:
    ```sql
    status = 'pending' AND scheduled_at <= NOW()
    ```
3.  **The Limit**: It processes items in batches (e.g., 50 at a time) to ensure the Edge Function execution time stays within limits and respects the WhatsApp API rate limits.
4.  **The State Check**: For each item, it re-verifies the session state to ensure no "late" messages arrived in the milliseconds between the polling beat and the execution.

## 3. Follow-up Lifecycle
1.  **Inbound Message**: User sends a message -> `webhook-whatsapp` IMMEDIATELY calls `cancelPending` to fix the race condition, then schedules the next sequence.
2.  **Scheduling**: The system reads the state's `followupSequence` (e.g., `[{ "interval": "15m", "configName": "greet_back" }]`).
3.  **Resolution**: The `process-followups` worker lookup the `configName`, resolves any dynamic variables (e.g., "personalized_name"), and checks the 24h window.
4.  **Execution**: The worker sends the message (Text or Template) via WhatsApp Cloud API.
5.  **Chaining**: The worker schedules the *next* configuration in the sequence until completion or user interruption.

## 3. Critical Fixes & Enhancements (V3)
*   **Race Condition Fixed**: `cancelPending` moved to the entry point of the WhatsApp webhook. Pending follow-ups are now neutralized before the message is even buffered/debounced.
*   **Decoupled Registry**: Follow-up content is no longer hardcoded or tied to a single state. The `followup_configs` table allows global management of templates and variables.
*   **Context Variable Type**: Introduced `context` type in `variables_config` to pull data directly from `session.context` or `contact` metadata (e.g., `{{userName}}`, `{{interest}}`) without LLM calls.
*   **Granular Variable Resolution**: Hybrid approach where some template variables are static (Literal), some are dynamic (Context), and others are generatively created (LLM).
*   **Template Mandate**: Full compliance with WhatsApp's 24-hour window by forcing template usage for messages after long periods of inactivity.

## 4. State Configuration Example
In the `state_machines` table, each state's JSON configuration now includes the `followupSequence` array:

```json
{
  "state": "qualifying",
  "objective": "Determine if the lead is interested in a demo",
  "followupSequence": [
    {
      "interval": "1h",
      "configName": "friendly_nudge"
    },
    {
      "interval": "1d",
      "configName": "reengagement_template_01"
    },
    {
      "interval": "3d",
      "configName": "last_attempt_template"
    }
  ],
  "allowedTransitions": ["scheduling", "disqualified"]
}
```

This sequence tells the system:
1.  **1 hour** after the lead stops responding: Fire the `friendly_nudge` text follow-up.
2.  **1 day** later: Fire the `reengagement_template_01` WhatsApp template.
3.  **3 days** later: Fire the `last_attempt_template`.

## 5. Registry Configuration Examples (followup_configs)
The `followup_configs` table stores the actual content and variable logic. Here are two common patterns:

### A. Simple Text Follow-up (with Literal Variables)
Used for short-term re-engagement within the 24h window.
```json
{
  "name": "friendly_nudge",
  "type": "text",
  "content": "Hola {{name}}! Sigues por ahí? Me comentaste que te interesaba {{product}}.",
  "variables_config": [
    { "key": "name", "type": "literal", "value": "Santiago" },
    { "key": "product", "type": "literal", "value": "Premium Academy" }
  ]
}
```

### B. WhatsApp Template (with LLM Variables)
Used for re-engagement after >24h of inactivity.
```json
{
  "name": "reengagement_template_01",
  "type": "template",
  "content": "sales_reengagement_v1",
  "variables_config": [
    { 
      "key": "personalized_greeting", 
      "type": "llm", 
      "prompt": "Generate a warm, professional greeting for a lead who hasn't responded in 24 hours. Keep it under 10 words." 
    }
  ]
}
```

### C. Context-Based Follow-up (High Accuracy, No Cost)
Used to personalize messages using existing data points.
```json
{
  "name": "booking_reminder",
  "type": "text",
  "content": "Hola {{firstName}}! ¿Seguimos agendando tu cita para {{requestedService}}?",
  "variables_config": [
    { "key": "firstName", "type": "context", "field": "firstName" },
    { "key": "requestedService", "type": "context", "field": "context.service_name" }
  ]
}
```

## 6. Verification & Quality Assurance
The system has been verified through a multi-layered testing approach:

*   **Automated Logic Verification**: 
    - `followup-v3.test.ts`: Unit tests for interval parsing ('15m', '2h', etc.), scheduled time calculation, and variable resolution logic.
    - `followup.test.ts`: Integration-style mocks ensuring the Conversation Engine correctly identifies and generates follow-ups in a multi-tenant setup.
*   **Multi-tenant Isolation**: Verified that the registry can be targeted via the `schema` parameter in both workers and management APIs.

## 7. Migration & Deployment
The final schema is unified in **[`00036_followup_system_v3.sql`](file:///home/santiago/Projects/Parallelo/conversational-sales-engine/supabase/migrations/00036_followup_system_v3.sql)**.
- **Critical Fix**: Added `sequence_index` to the `followup_queue` table definition to correctly track position in multi-message sequences.
- **Global Rollout**: The migration uses a `DO` block to automatically apply the registry and queue tables to all active client schemas listed in `public.client_configs`.

---
*Last updated: 2026-02-06 by Antigravity (Advanced AI Engineer).*
