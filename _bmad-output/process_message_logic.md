# Engine Process Message Logic (Mermaid)

This diagram details the logic flow within the `ConversationEngine.processMessage` method, which serves as the core entry point for handling inbound messages.

```mermaid
graph TD
    Start([Inbound Message: EngineInput]) --> MediaProc[Media Processing: Audio/Image/Video]
    MediaProc --> ContactLookup[Get or Create Contact]
    ContactLookup --> SessionLookup[Get or Create Session]
    
    SessionLookup --> SMInit[Load State Machine Config & Init StateMachine]
    SMInit --> SysCmd{System Command: /reset?}
    
    SysCmd -- Yes --> ResetData[Delete Contact & Clear History]
    ResetData --> ResetResp([Return Reset Response])
    
    SysCmd -- No --> EscalationCheck{Is Session Escalated?}
    
    EscalationCheck -- Yes --> SilentCheck{Silent > 1h?}
    SilentCheck -- No --> SaveOnly[Save Msg to History & Stop]
    SaveOnly --> EmptyResp([Return Empty Response])
    
    SilentCheck -- Yes --> ResumeSM[Resume: Set status = 'active']
    ResumeSM --> SaveInbound[Save Inbound Message]
    
    EscalationCheck -- No --> SaveInbound
    
    SaveInbound --> PrepContext[Prepare Context: History, Examples, State Context]
    PrepContext --> BuildPrompt[Build System Prompt]
    
    BuildPrompt --> LLMLoop{LLM Retry Loop: Max 5 attempts}
    
    LLMLoop --> KBCheck{Knowledge Base Configured?}
    KBCheck -- Yes --> FileSearch[LLM generateResponseWithFileSearch]
    KBCheck -- No --> RegularChat[LLM generateResponse]
    
    FileSearch --> ParseJSON[Parse Structured JSON Response]
    RegularChat --> ParseJSON
    
    ParseJSON -- Success --> EscalationDecide{LLM Decided Escalation?}
    ParseJSON -- Failure --> LLMLoop
    
    EscalationDecide -- Yes --> NotifyAgent[Notify Human Agent & Set Session Escalated]
    NotifyAgent --> EscalationResp([Return Escalation Response])
    
    EscalationDecide -- No --> TransitionDecide{Evaluate State Transition}
    TransitionDecide -- Confidence >= 0.6 --> MoveState[Transition to Target State]
    TransitionDecide -- Confidence < 0.6 --> KeepState[Stay in Current State]
    
    MoveState --> GetEntryResp[Generate State Entry Response]
    KeepState --> FinalizeUpdates[Merge Extracted Data into Context]
    GetEntryResp --> FinalizeUpdates
    
    FinalizeUpdates --> SaveOutbound[Save Outbound Responses]
    SaveOutbound --> CommitSession[Commit Session Updates to Store]
    CommitSession --> Finish([Return EngineOutput])
    
    %% Error Handling
    LLMLoop -- Failures Exhausted --> FallbackMsg[Send Generic Error Message]
    FallbackMsg --> Finish
```

## Core Execution Steps

1.  **Media Processing**: Handles asynchronous operations for audio transcription (AssemblyAI/Gemini) and image analysis.
2.  **Stateful Isolation**: Each message is processed within the context of a `Session` and a `StateMachine` config specific to the client.
3.  **Self-Correction (Retry Loop)**: The engine attempts to get a valid JSON response from the LLM up to 5 times, increasing temperature on subsequent attempts to break stalemates.
4.  **Knowledge Base Integration**: If the client has a knowledge base configured, the LLM uses RAG (Retrieval-Augmented Generation) with file search to inform its response.
5.  **Autonomous Escalation**: The LLM can explicitly recommend escalating to a human agent, which triggers internal notifications and locks the session.
6.  **State Consistency**: State transitions only occur if LLM confidence exceeds 60%, ensuring stability in the conversation flow.
