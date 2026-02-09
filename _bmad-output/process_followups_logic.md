# Follow-up Processing Logic (Mermaid)

This diagram details the execution flow of the `process-followups` Supabase Edge Function, including client routing, queue management, variable resolution, and the WhatsApp 24-hour window compliance logic.

```mermaid
graph TD
    Start([Periodic Trigger: pg_cron]) --> GetAllClients[Get All Active Client Configs]
    GetAllClients --> ClientLoop{For Each Client...}
    
    ClientLoop -- Next Client --> ProcessSchema[Process Client Schema]
    ProcessSchema --> FetchQueue[Fetch 'pending' items: scheduled_at <= now, limit 50]
    
    FetchQueue --> QueueCheck{Items Found?}
    QueueCheck -- No --> ClientLoop
    
    QueueCheck -- Yes --> ItemLoop{For Each Item...}
    
    ItemLoop -- Process Item --> GetSession[Fetch Session Data]
    GetSession --> ResolveContent{Resolve Content}
    
    ResolveContent -- Registry Config --> VarLoop{Resolve Variables}
    VarLoop -- Literal --> SetLiteral[Use Literal Value]
    VarLoop -- LLM --> GenVar[Generate via LLM: engine.generateFollowupVariable]
    SetLiteral --> FormatMsg[Format Message: Text/Template]
    GenVar --> FormatMsg
    
    ResolveContent -- Fallback --> GenDynamic[Dynamic Generation: engine.generateFollowup]
    FormatMsg --> WindowCheck{> 24h since last msg?}
    GenDynamic --> WindowCheck
    
    WindowCheck -- Yes --> ForceTpl[Force Standard Template Fallback]
    WindowCheck -- No --> UseConfig[Use Configured Message/Template]
    
    ForceTpl --> SendMsg[Send WhatsApp Message via API]
    UseConfig --> SendMsg
    
    SendMsg --> LogHistory[Save Outbound Msg to History]
    LogHistory --> UpdateQueue[Update status to 'sent']
    UpdateQueue --> ScheduleNext[Schedule NEXT follow-up in sequence]
    ScheduleNext --> ItemLoop
    
    ItemLoop -- All items done --> ClientLoop
    ClientLoop -- All clients done --> Finish([Worker Finish])

    %% Error Handling
    GetSession -- Fail --> MarkFailed[Mark as 'failed' + log error]
    SendMsg -- Fail --> MarkFailed
    MarkFailed --> ItemLoop
```

## Key Logic Components

- **Client Routing**: Uses the unified router to fetch configurations for all active clients across multiple schemas.
- **Variable Resolution**: Supports both static (literal) and dynamic (LLM-generated) variables within a follow-up.
- **24h Window Rule**: Automatically detects when the WhatsApp session window has closed and upgrades plain text follow-ups to templates to ensure delivery.
- **Sequence Management**: Triggers the scheduling of the next item in the state-defined follow-up sequence after each successful delivery.
