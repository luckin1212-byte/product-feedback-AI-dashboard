# Feedback Dashboard + Cloudflare Workflows Integration

This guide explains how to set up and use the daily feedback analysis workflow with Slack notifications.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Scheduled Trigger (9 AM UTC)             │
│                   (Configurable Cron Schedule)              │
└──────────────────────┬──────────────────────────────────────┘
                       │
        ┌──────────────▼──────────────┐
        │  Fetch Recent Feedback      │
        │  (Last 24 hours)            │
        └──────────────┬──────────────┘
                       │
        ┌──────────────▼──────────────┐
        │  Analyze with Workers AI    │
        │  • Sentiment Detection      │
        │  • Priority Classification  │
        │  • Issue Categorization     │
        └──────────────┬──────────────┘
                       │
        ┌──────────────▼──────────────┐
        │  Generate AI Insights       │
        │  • Top Issues               │
        │  • Recommendations          │
        │  • Urgent Items             │
        └──────────────┬──────────────┘
                       │
        ┌──────────────▼──────────────┐
        │   Send to Slack             │
        │   (Formatted Blocks)        │
        └──────────────┬──────────────┘
                       │
        ┌──────────────▼──────────────┐
        │  Log Analysis Results       │
        │  (D1 Database)              │
        └─────────────────────────────┘
```

## Setup Instructions

### 1. Configure Slack Webhook

1. Go to your Slack workspace
2. Create a new Incoming Webhook at: https://api.slack.com/messaging/webhooks
3. Choose the channel where you want daily analysis reports
4. Copy the webhook URL

### 2. Set Environment Variables

Update `wrangler.jsonc` with your Slack webhook:

```jsonc
{
  "vars": {
    "SLACK_WEBHOOK_URL": "https://hooks.slack.com/services/YOUR/WEBHOOK/URL"
  },
  "env": {
    "production": {
      "vars": {
        "SLACK_WEBHOOK_URL": "https://hooks.slack.com/services/YOUR/WEBHOOK/URL"
      }
    }
  }
}
```

Or set as a secret:

```bash
wrangler secret put SLACK_WEBHOOK_URL
# Then paste your webhook URL
```

### 3. Adjust Cron Schedule

Modify the cron expression in `wrangler.jsonc`:

```jsonc
"triggers": {
  "crons": [
    "0 9 * * *"  // Every day at 9 AM UTC
  ]
}
```

**Common cron patterns:**
- `0 9 * * *` - Daily at 9 AM UTC
- `0 9 * * MON` - Every Monday at 9 AM UTC
- `0 9,14 * * *` - Daily at 9 AM and 2 PM UTC
- `*/6 * * * *` - Every 6 hours

### 4. Deploy Migrations

```bash
wrangler migrations apply --remote
```

This creates the `analysis_logs` table for tracking analysis results.

### 5. Deploy to Cloudflare

```bash
wrangler deploy
```

## File Structure

```
src/
├── index.ts                    # Main worker (HTTP routes + AI analysis)
├── scheduled-handler.ts        # Scheduled trigger handler
└── workflows/
    └── daily-analysis.ts       # Workflow definition (optional alternative)

migrations/
├── 0001_init.sql              # Initial feedback table schema
└── 0002_add_analysis_logs.sql # Analysis logs table
```

## API Endpoints

### POST /ingest

Ingest new feedback.

**Request:**
```json
{
  "source": "email",
  "raw_text": "Your product is down! Not working since 2 hours.",
  "sentiment": "negative",    // optional
  "priority": "P0",           // optional
  "category": "bug"           // optional
}
```

**Response:**
```json
{
  "id": "uuid",
  "created_at": "2024-01-19T15:30:00Z",
  "message": "Feedback ingested"
}
```

### GET /dashboard

Get all feedback with filtering.

**Query Parameters:**
- `sentiment` - Filter by: `negative`, `neutral`, `positive`
- `priority` - Filter by: `P0`, `P1`, `P2`, `P3`
- `category` - Filter by category
- `source` - Filter by source (email, twitter, support, etc.)
- `limit` - Number of results (1-200, default: 50)
- `format` - Response format: `html` or `json`

**Examples:**

```bash
# Get all P0 and P1 issues
GET /dashboard?priority=P0&limit=200

# Get negative feedback
GET /dashboard?sentiment=negative&limit=50

# Get JSON format
GET /dashboard?sentiment=negative&format=json

# Get performance issues
GET /dashboard?category=performance&limit=50
```

### GET /api/stats

Get overall statistics about feedback.

**Response:**
```json
{
  "total": 125,
  "byPriority": {
    "P0": 2,
    "P1": 5,
    "P2": 18,
    "P3": 100
  },
  "bySentiment": {
    "negative": 30,
    "neutral": 50,
    "positive": 45
  },
  "byCategory": {
    "bug": 35,
    "feature_request": 60,
    "performance": 15,
    "other": 15
  },
  "last7Days": 45,
  "topWords": [
    { "word": "crash", "count": 12 },
    { "word": "slow", "count": 10 }
  ]
}
```

## Daily Workflow Process

Every day at 9 AM UTC (or your configured time):

1. **Fetch**: Queries all feedback from the past 24 hours
2. **Analyze**: 
   - Groups by priority, sentiment, and category
   - Uses Workers AI (Mistral 7B) to generate insights
   - Identifies top recurring issues
3. **Generate Insights**:
   - Lists top 5 issues
   - Generates 3-4 actionable recommendations
   - Flags urgent (P0/P1) items
4. **Send to Slack**:
   - Daily summary with metrics
   - Top issues and recommendations
   - Urgent items needing attention
   - Link to dashboard for details
5. **Log**: Stores analysis results in `analysis_logs` table

## Slack Message Format

The daily report includes:

- **Header**: "📊 Daily Feedback Analysis"
- **Metrics**: Total feedback, negative count, P0/P1 items
- **Top Issues**: Top 3 recurring issues with frequency
- **Recommendations**: AI-generated actionable recommendations
- **Urgent Items**: List of P0/P1 priority items (if any)
- **Action Button**: Link to dashboard for full details

## Database Schema

### feedback table
```sql
id TEXT PRIMARY KEY
source TEXT NOT NULL
raw_text TEXT NOT NULL
sentiment TEXT                 -- negative, neutral, positive
priority TEXT                  -- P0, P1, P2, P3
category TEXT                  -- bug, feature_request, performance, etc.
summary TEXT                   -- 120 char summary
priority_reason TEXT           -- Why this priority
created_at TEXT NOT NULL       -- ISO timestamp
```

### analysis_logs table
```sql
id INTEGER PRIMARY KEY
timestamp TEXT NOT NULL        -- When analysis ran
total_feedback INTEGER         -- Total items analyzed
negative_count INTEGER         -- Negative sentiment count
p0_count INTEGER              -- P0 priority count
p1_count INTEGER              -- P1 priority count
data TEXT                      -- Full analysis JSON
created_at TIMESTAMP           -- Log timestamp
```

## Testing Locally

Test the scheduled handler locally:

```bash
# Start dev server with scheduled event support
npm start

# Trigger scheduled event in another terminal
curl -X POST http://localhost:8787/__scheduled -H "Content-Type: application/json"
```

## Environment Configuration

### Development
```bash
npm run dev
# Runs with test-scheduled mode to test cron triggers
```

### Production
```bash
npm run deploy
# Deploys to Cloudflare Workers
# Cron triggers run on schedule
```

## Monitoring

Check logs and analytics:

```bash
# View recent logs
wrangler tail

# Get deployment history
wrangler deployments list

# Monitor performance in Cloudflare Dashboard
# https://dash.cloudflare.com
```

## Troubleshooting

### Webhook not sending
1. Verify `SLACK_WEBHOOK_URL` is set in environment
2. Check the URL is valid and accessible
3. View logs: `wrangler tail`

### No feedback data
1. Ensure feedback has been ingested: `POST /ingest`
2. Check database connection: `wrangler d1 query "SELECT COUNT(*) FROM feedback"`
3. Verify timestamp format (should be ISO 8601)

### AI analysis not working
1. Ensure Workers AI is enabled in Cloudflare account
2. Check AI binding in `wrangler.jsonc`
3. View error logs: `wrangler tail`

### Missing analysis logs
1. Run migration: `wrangler migrations apply --remote`
2. Verify `analysis_logs` table exists

## Customization

### Change Analysis Frequency
Edit cron in `wrangler.jsonc`:
```jsonc
"triggers": {
  "crons": ["0 9 * * *"]  // Change schedule here
}
```

### Modify Slack Report Format
Edit `sendToSlack()` in `scheduled-handler.ts` to customize the message blocks.

### Add Custom AI Prompts
Modify the AI prompt in `analyzeFeedback()` function.

### Add More Metrics
Extend the analysis logic in `analyzeFeedback()` to compute additional metrics.

## Cost Considerations

- **D1 Database**: Queries are free tier friendly
- **Workers AI**: Included with Workers (within limits)
- **Slack Webhooks**: Free
- **Scheduled events**: Included with Workers

Estimated cost for daily workflow: **~$0.01-0.05/day** depending on feedback volume.

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Review Cloudflare documentation: https://developers.cloudflare.com/workers/
3. Check Slack API docs: https://api.slack.com/

---

**Last Updated**: January 2025
