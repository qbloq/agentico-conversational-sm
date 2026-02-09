# WhatsApp Webhook Logic (Mermaid)

This diagram details the logic flow of the `webhook-whatsapp` Supabase Edge Function, which serves as the primary ingestion point for all WhatsApp interactions.

```mermaid
graph TD
    Start([HTTP Request]) --> Method{Request Method?}
    
    Method -- GET --> Verify[Handle Verification: hub.mode & hub.verify_token]
    Verify --> VerifyCheck{Match?}
    VerifyCheck -- Yes --> Challenge[Return hub.challenge]
    VerifyCheck -- No --> Forbidden[Return 403 Forbidden]
    
    Method -- POST --> ParseBody[Parse JSON Payload & Extract Signature]
    ParseBody --> ObjCheck{object == 'whatsapp_business_account'?}
    
    ObjCheck -- No --> Ignore[Return 200 'Not a WhatsApp event']
    ObjCheck -- Yes --> EntryLoop{For Each Entry & Change...}
    
    EntryLoop --> FieldCheck{field == 'messages'?}
    FieldCheck -- No --> EntryLoop
    FieldCheck -- Yes --> GetRoute[Route by phone_number_id via public.client_configs]
    
    GetRoute --> RouteCheck{Found?}
    RouteCheck -- No --> DispatchPremium[Dispatch to Premium Academy Proxy]
    RouteCheck -- Yes --> SignatureCheck{Verify HMAC-SHA256 Signature}
    
    SignatureCheck -- Fail --> EntryLoop
    SignatureCheck -- Pass --> MsgLoop{For Each Message...}
    
    MsgLoop --> InitStores[Initialize Adapters & Services @schemaName]
    InitStores --> MediaProc[Normalize & Upload Media to Supabase Storage]
    
    MediaProc --> CSRaceFix[Cancel Pending Follow-ups for Session]
    CSRaceFix --> CmdCheck{Message starts with '/'?}
    
    CmdCheck -- Yes --> Immediate[Process Immediately: engine.processMessage]
    CmdCheck -- No --> DebounceCheck{Debounce Enabled?}
    
    DebounceCheck -- No --> Immediate
    DebounceCheck -- Yes --> Ingest[Ingest to Buffer: engine.ingestMessage]
    
    Ingest --> BufferCheck{Buffered?}
    BufferCheck -- Yes --> Ack[Acknowledge Receipt to Meta]
    BufferCheck -- No --> Immediate
    
    Immediate --> ResultCheck{Process Result: sessionId exists?}
    ResultCheck -- Yes --> ScheduleFirst[Schedule FIRST follow-up in sequence]
    ResultCheck -- No --> SendResp[Send Outbound Responses: Text/Template]
    
    ScheduleFirst --> SendResp
    SendResp --> MsgLoop
    
    MsgLoop -- Done --> EntryLoop
    EntryLoop -- Done --> Ack
```

## Core Execution Steps

1.  **Multi-Tenant Routing**: Dynamically routes the request to the target schema by mapping the incoming `phone_number_id` to a `client_id` in the shared `public.client_configs` table.
2.  **Signature Verification**: Uses the client-specific `appSecret` to verify that the request originated from Meta.
3.  **Race Condition Protection**: Immediately cancels any pending follow-ups for the session as soon as a new message is received, preventing a follow-up from firing while the user is actively typing.
4.  **Media Lifecycle**: Downloads media (images, audio, video) from Meta's servers, uploads it to the client's Supabase bucket, and provides public URLs for logic processing.
5.  **Hybrid Processing**:
    *   **Debounced**: Standard messages are buffered. A separate worker (`process-pending`) processes them after a period of silence.
    *   **Immediate**: Commands (e.g., `/reset`) and fallback messages are processed in-line for instant responsiveness.
6.  **Follow-up Initialization**: For new states reached during immediate processing, the first item in the state's follow-up sequence is automatically scheduled.
