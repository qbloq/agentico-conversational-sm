# Conversational Sales Engine

AI-powered conversational sales bot for WhatsApp, Instagram, and Messenger.

## Architecture

```
conversational-sales-engine/
├── packages/
│   └── sales-engine/           # @parallelo/sales-engine (domain library)
├── supabase/
│   ├── functions/              # Edge Functions (webhooks, admin API)
│   └── migrations/             # Database migrations
├── clients/                    # Client configuration files
└── scripts/                    # Utility scripts
```

## Quick Start

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test:run
```

## Packages

### @parallelo/sales-engine

Domain library containing the conversation engine, state machine, and LLM providers.

```bash
cd packages/sales-engine
pnpm build
pnpm test
```

See [packages/sales-engine/README.md](./packages/sales-engine/README.md) for details.

## Development

### Prerequisites

- Node.js >= 18
- pnpm >= 8
- Supabase CLI (for local development)

### Environment Variables

Create a `.env.local` file:

```bash
# Supabase
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
SUPABASE_DB_URL=postgresql://postgres:xxx@db.xxx.supabase.co:5432/postgres

# LLM Providers (at least one required)
GOOGLE_API_KEY=xxx
ANTHROPIC_API_KEY=xxx
OPENAI_API_KEY=xxx

# WhatsApp (for webhook)
WHATSAPP_ACCESS_TOKEN=EAA...
WHATSAPP_APP_SECRET=xxx
WHATSAPP_PHONE_NUMBER_ID=xxx
```

## Roadmap

- [x] **Week 1**: Domain library foundation
  - [x] Monorepo setup
  - [x] Core types and interfaces
  - [x] LLM providers (Gemini, Anthropic, OpenAI)
  - [x] State machine
  - [x] Conversation engine
  - [x] Unit tests

- [ ] **Week 2**: Supabase setup
  - [ ] Database migrations
  - [ ] Supabase adapters (ContactStore, SessionStore, etc.)
  - [ ] Knowledge base seeding

- [ ] **Week 3**: Integration
  - [ ] WhatsApp Edge Function
  - [ ] End-to-end testing
  - [ ] First client deployment

## License

MIT
