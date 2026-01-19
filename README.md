# product-feedback-AI-dashboard
A lightweight product feedback dashboard built on **Cloudflare Workers**, using **Workers AI**, **D1**, and **Workflows** to ingest, analyze, and summarize user feedback across multiple channels.

Live demo and architecture are fully deployed on Cloudflare.

---

## Project Links

- **Live Demo (Cloudflare Workers)**  
  https://feedback-dashboard-production.luckin1212.workers.dev/dashboard


## What This Prototype Does

- Ingests raw user feedback via a simple HTTP API (`/ingest`)
- Automatically labels feedback using **Workers AI (Llama 3)**:
  - sentiment
  - priority (P0–P3)
  - category (bug, performance, UX, etc.)
- Stores structured feedback in **Cloudflare D1**
- Displays a real-time dashboard hosted on **Cloudflare Workers**
- Filters for **product feedback only**
- Prepares daily AI insights via **Cloudflare Workflows**
- Includes a Slack integration entry point for daily summaries

---

## Architecture Overview

### Core Cloudflare Products Used

| Cloudflare Product | How It’s Used | Why |
|-------------------|---------------|-----|
| **Cloudflare Workers** | API + dashboard rendering | Serverless, low-latency, edge-native |
| **Workers AI** | AI labeling & summarization (Llama 3) | Native AI inference without external APIs |
| **D1 Database** | Persistent storage for feedback | Simple SQL + tight Workers integration |
| **Workflows** | Daily analysis / summary pipeline | Reliable background processing |
| **Bindings** | AI, D1, Workflow bindings | Secure, declarative resource access |

> See `Bindings` graph in Cloudflare Dashboard (used as architecture screenshot in submission).

---

## Data Flow

1. Feedback is sent to `/ingest` with `source` and `raw_text`
2. Workers AI (Llama 3) classifies the feedback
3. Results are stored in D1 (`feedback_db`)
4. Dashboard queries D1 and renders insights
5. Daily workflow aggregates feedback for AI summaries (optional Slack delivery)

---

## Workers AI Details

- **Model used**: `@cf/meta/llama-3.1-8b-instruct`
- **Prompt-driven labeling**, no fine-tuning
- AI output is **not trusted blindly**:
  - user input can override AI labels
  - dashboard exposes raw user comments for transparency
- Includes debug metadata to validate AI behavior during development

---

## Product Feedback Filtering

To ensure signal over noise, the system supports **“Product feedback only”** filtering.

Product feedback is defined as categories in:

