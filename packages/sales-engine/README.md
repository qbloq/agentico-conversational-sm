# @parallelo/sales-engine

Domain library for conversational AI sales engine. Framework-agnostic, designed for use with Supabase Edge Functions.

## Installation

```bash
pnpm add @parallelo/sales-engine
```

### LLM Providers (Optional Peer Dependencies)

Install the provider(s) you plan to use:

```bash
# Gemini (Primary - Recommended)
pnpm add @google/generative-ai

# Anthropic (Secondary)
pnpm add @anthropic-ai/sdk

# OpenAI (Tertiary + Embeddings)
pnpm add openai
```

## Quick Start

```typescript
import { createConversationEngine } from '@parallelo/sales-engine';
import { createGeminiProvider, createOpenAIEmbeddingProvider } from '@parallelo/sales-engine/llm';

// Create the engine
const engine = createConversationEngine();

// Process a message
const result = await engine.processMessage({
  sessionKey: {
    channelType: 'whatsapp',
    channelId: 'phone-number-id',
    channelUserId: 'wa-user-id',
  },
  message: {
    id: 'msg-123',
    timestamp: new Date(),
    type: 'text',
    content: 'Hola, quiero información sobre trading',
  },
  deps: {
    contactStore: yourContactStoreImplementation,
    sessionStore: yourSessionStoreImplementation,
    messageStore: yourMessageStoreImplementation,
    llmProvider: createGeminiProvider({ apiKey: process.env.GOOGLE_API_KEY!, model: 'gemini-2.0-flash' }),
    embeddingProvider: createOpenAIEmbeddingProvider({ apiKey: process.env.OPENAI_API_KEY! }),
    knowledgeStore: yourKnowledgeStoreImplementation,
    clientConfig: yourClientConfig,
  },
});

// Send responses
for (const response of result.responses) {
  await sendWhatsAppMessage(response.content);
}
```

## Architecture

This library follows a **ports and adapters** (hexagonal) architecture:

```
┌─────────────────────────────────────────────────────────────────┐
│                    @parallelo/sales-engine                       │
│                      (Domain Library)                            │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │   Engine    │  │    State    │  │     LLM     │              │
│  │             │──│   Machine   │──│  Providers  │              │
│  └─────────────┘  └─────────────┘  └─────────────┘              │
│         │                                                        │
│         ▼                                                        │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                    Port Interfaces                          ││
│  │  ContactStore │ SessionStore │ MessageStore │ KnowledgeStore││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Application Layer                             │
│              (Supabase Edge Functions)                           │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                    Adapters                                 ││
│  │  SupabaseContactStore │ SupabaseSessionStore │ etc.         ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

## Core Concepts

### Session Key

Every conversation is identified by a unique key:

```typescript
interface SessionKey {
  channelType: 'whatsapp' | 'instagram' | 'messenger';
  channelId: string;       // WhatsApp phone_number_id, Instagram page_id
  channelUserId: string;   // User's ID within that channel
}
```

### State Machine

The conversation follows a state machine:

- `initial` → Greeting, identify experience
- `qualifying` → Assess needs
- `diagnosing` → Understand pain points
- `pitching` → Present offering
- `handling_objection` → Address concerns
- `closing` → Guide to registration
- `post_registration` → Confirm, guide to deposit
- `deposit_support` → Help with deposits
- `escalated` → Human has taken over
- `completed` → Conversation concluded

### LLM Providers

Priority order:
1. **Gemini** (primary) - `gemini-2.0-flash`
2. **Anthropic** (secondary) - `claude-sonnet-4-20250514`
3. **OpenAI** (tertiary) - `gpt-4o`

```typescript
import { createLLMProvider } from '@parallelo/sales-engine/llm';

// With automatic fallback
const provider = createLLMProvider({
  provider: 'gemini',
  apiKey: process.env.GOOGLE_API_KEY!,
  fallbackProvider: 'anthropic',
  fallbackApiKey: process.env.ANTHROPIC_API_KEY!,
});
```

## Port Interfaces

You must implement these interfaces for your persistence layer:

### ContactStore

```typescript
interface ContactStore {
  findOrCreateByChannelUser(channelType: ChannelType, channelUserId: string): Promise<Contact>;
  findById(id: string): Promise<Contact | null>;
  update(id: string, updates: Partial<Contact>): Promise<Contact>;
}
```

### SessionStore

```typescript
interface SessionStore {
  findByKey(key: SessionKey): Promise<Session | null>;
  findById(id: string): Promise<Session | null>;
  create(key: SessionKey, contactId: string): Promise<Session>;
  update(id: string, updates: Partial<Session>): Promise<Session>;
}
```

### MessageStore

```typescript
interface MessageStore {
  getRecent(sessionId: string, limit: number): Promise<Message[]>;
  save(sessionId: string, message: Omit<Message, 'id' | 'sessionId' | 'createdAt'>): Promise<Message>;
}
```

### KnowledgeStore

```typescript
interface KnowledgeStore {
  findSimilar(embedding: number[], limit: number): Promise<KnowledgeEntry[]>;
  findByCategory(category: string, limit: number): Promise<KnowledgeEntry[]>;
  findByTags(tags: string[], limit: number): Promise<KnowledgeEntry[]>;
}
```

## Development

```bash
# Install dependencies
pnpm install

# Build
pnpm run build

# Run tests
pnpm run test

# Type check
pnpm run typecheck
```

## License

MIT
