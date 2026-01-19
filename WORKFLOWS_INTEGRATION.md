# Cloudflare Workflows Integration Guide

## Overview

This feedback dashboard now includes full support for **Cloudflare Workflows** with scheduled daily analysis, AI-powered insights, and Slack integration.

## Key Features

✅ **Daily Automated Analysis**
- Runs on a configurable schedule (default: 9 AM UTC daily)
- Processes all feedback from the past 24 hours
- Groups by priority, sentiment, and category

✅ **AI-Powered Insights**
- Uses Cloudflare Workers AI (Mistral 7B)
- Generates actionable recommendations
- Identifies top recurring issues
- Flags urgent items (P0/P1)

✅ **Slack Integration**
- Sends formatted daily reports to Slack
- Includes metrics, top issues, and recommendations
- Urgent items highlighted with emojis
- Direct link to dashboard for details

✅ **Analysis Tracking**
- Historical logs stored in D1 database
- Query past analysis results
- Track trends over time

## Quick Start

### 1. Get Slack Webhook

```bash
# Visit: https://api.slack.com/apps
# Create an app → Add "Incoming Webhooks" feature
# Create new webhook for your channel
# Copy the webhook URL
```

### 2. Update Configuration

**Option A: Using Environment Variables**

```bash
# Edit wrangler.jsonc
{
  "vars": {
    "SLACK_WEBHOOK_URL": "https://hooks.slack.com/services/YOUR/WEBHOOK/URL"
  }
}
```

**Option B: Using Secrets (Recommended for Production)**

```bash
wrangler secret put SLACK_WEBHOOK_URL
# Paste your webhook URL when prompted
```

### 3. Deploy

```bash
# Run migrations to create analysis_logs table
wrangler migrations apply --remote

# Deploy to Cloudflare
wrangler deploy
```

### 4. Test Locally

```bash
# Start development server
npm start

# In another terminal, trigger the scheduled event
curl -X POST http://localhost:8787/__scheduled -H "Content-Type: application/json"

# Check your Slack channel for the test report!
```

## File Structure

```
feedback-dashboard/
├── src/
│   ├── index.ts                          # Main worker
│   ├── scheduled-handler.ts              # ⭐ Daily workflow handler
│   ├── utils/
│   │   └── analysis.ts                   # Helper utilities
│   └── workflows/
│       ├── daily-analysis.ts             # Workflow definition (optional)
│       └── config.ts                     # Advanced workflow config
├── migrations/
│   ├── 0001_init.sql                     # Feedback table
│   └── 0002_add_analysis_logs.sql        # ⭐ Analysis logs table
├── wrangler.jsonc                        # ⭐ Cron trigger config
├── WORKFLOWS_SETUP.md                    # Detailed setup guide
└── .env.example                          # Environment template
```

## Architecture

```
┌─────────────────────────────────────┐
│     Scheduled Trigger (Cron)        │  ← Configurable schedule
│          Every 24 hours             │
└────────────┬────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│  1. Fetch Recent Feedback           │  ← D1 Query (24 hours)
│     - All new feedback items        │
│     - Parse timestamps              │
└────────────┬────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│  2. Analyze with Workers AI         │  ← Mistral 7B
│     - Group by priority             │
│     - Group by sentiment            │
│     - Identify top issues           │
│     - Generate recommendations      │
└────────────┬────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│  3. Generate Insights               │  ← Format results
│     - Calculate percentages         │
│     - Build action items            │
│     - Flag urgent items             │
└────────────┬────────────────────────┘
             │
             ├──────────────┬──────────────┐
             ▼              ▼              ▼
    ┌──────────────┐  ┌──────────┐  ┌─────────────┐
    │ Send Slack   │  │ Log DB   │  │ Send Email  │
    │ Notification │  │ Results  │  │ (Optional)  │
    └──────────────┘  └──────────┘  └─────────────┘
```

## Workflow Stages

### Stage 1: Fetch Feedback

```typescript
// Query last 24 hours of feedback
const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
const feedback = await db
  .prepare(`SELECT * FROM feedback WHERE datetime(created_at) >= datetime(?)`)
  .bind(yesterday.toISOString())
  .all();
```

### Stage 2: Analyze

```typescript
// Group and analyze
const stats = {
  byPriority: { P0: 2, P1: 5, P2: 18, P3: 100 },
  bySentiment: { negative: 30, neutral: 50, positive: 45 },
  byCategory: { bug: 35, feature_request: 60, ... },
  urgentCount: 7,
};

// Get AI insights
const response = await AI.run("@cf/mistral/mistral-7b-instruct-v0.1", {
  prompt: "Based on these issues...", // See analysis.ts for full prompt
});
```

### Stage 3: Build Slack Message

```typescript
// Create formatted blocks for Slack
const blocks = [
  createHeaderBlock("📊 Daily Feedback Analysis"),
  createMetricsBlock(stats),
  createTopIssuesBlock(analysis.topIssues),
  createRecommendationsBlock(analysis.recommendedActions),
  createUrgentItemsBlock(analysis.urgentItems),
];

// Send to Slack webhook
await fetch(webhookUrl, {
  method: "POST",
  body: JSON.stringify({ blocks }),
});
```

### Stage 4: Log Results

```typescript
// Store in analysis_logs table
await db
  .prepare(
    `INSERT INTO analysis_logs 
     (timestamp, total_feedback, negative_count, p0_count, p1_count, data)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
  .bind(
    now.toISOString(),
    totalFeedback,
    negativeCount,
    p0Count,
    p1Count,
    JSON.stringify(analysis)
  )
  .run();
```

## Configuration Examples

### Daily at 9 AM UTC

```jsonc
{
  "triggers": {
    "crons": ["0 9 * * *"]
  }
}
```

### Twice Daily (9 AM & 5 PM UTC)

```jsonc
{
  "triggers": {
    "crons": ["0 9,17 * * *"]
  }
}
```

### Every 4 Hours

```jsonc
{
  "triggers": {
    "crons": ["0 */4 * * *"]
  }
}
```

### Every Monday at 9 AM

```jsonc
{
  "triggers": {
    "crons": ["0 9 * * MON"]
  }
}
```

### Multiple Schedules (Advanced)

```jsonc
{
  "triggers": {
    "crons": [
      "0 9 * * *",        // Daily
      "0 9 * * MON",      // Monday digest
      "30 * * * *"        // Urgent alerts
    ]
  }
}
```

## Slack Message Format

The daily report includes:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 DAILY FEEDBACK ANALYSIS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 Key Metrics:
  • Total Feedback: 125
  • Negative Sentiment: 30 (24%)
  • P0 Priority: 2
  • P1 Priority: 5

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔥 Top Issues:
  1. App crashes on startup (12 occurrences)
  2. Performance degradation (10 occurrences)
  3. Missing feature X (8 occurrences)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 Recommended Actions:
  1. Fix app startup crash - investigate logs
  2. Profile performance bottlenecks
  3. Schedule feature X development

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ Urgent Items (2):
  [P0] App crashes on startup - iOS
      email@example.com • 2 hours ago
  
  [P1] Critical performance issue
      twitter@user • 1 hour ago

[View Dashboard] button
```

## Querying Analysis Logs

```sql
-- Get yesterday's analysis
SELECT * FROM analysis_logs 
WHERE date(timestamp) = date('now', '-1 day');

-- Get trends
SELECT 
  DATE(timestamp) as date,
  AVG(negative_count) as avg_negative,
  SUM(p0_count) as total_p0,
  COUNT(*) as analysis_count
FROM analysis_logs
GROUP BY DATE(timestamp)
ORDER BY date DESC
LIMIT 7;

-- Find when issues spiked
SELECT * FROM analysis_logs
WHERE negative_count > 20 OR p0_count > 0
ORDER BY timestamp DESC;
```

## Advanced Features

### Multiple Slack Channels

```typescript
// In scheduled-handler.ts, modify sendToSlack()
const channels = [
  { webhook: env.SLACK_WEBHOOK_GENERAL, name: "#general" },
  { webhook: env.SLACK_WEBHOOK_URGENT, filter: (item) => item.priority === "P0" },
];

for (const channel of channels) {
  if (channel.filter) {
    analysis = filterAnalysis(analysis, channel.filter);
  }
  await sendToSlack(analysis, channel.webhook);
}
```

### Email Notifications

```typescript
// Add email support
if (env.SENDGRID_API_KEY) {
  await sendEmailNotification(analysis, env.SENDGRID_API_KEY);
}
```

### Custom AI Prompts

```typescript
// Modify analysis.ts generateAnalysisPrompt()
export function generateAnalysisPrompt(issues: any[], customContext?: string) {
  const context = customContext || "customer feedback";
  return `As a product manager analyzing ${context}...`;
}
```

### Conditional Notifications

```typescript
// Only send if urgent items exist
if (analysis.urgentCount > 0) {
  await sendUrgentAlert(analysis, env);
}

// Only send if negative feedback increased
if (analysis.bySentiment.negative > lastAnalysis.bySentiment.negative) {
  await notifyTeam("Negative sentiment increased");
}
```

## Troubleshooting

### Webhook Not Sending

```bash
# Check webhook URL
curl -X POST "YOUR_WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d '{"text":"Test message"}'

# Check logs
wrangler tail
```

### No Feedback Data

```sql
-- Verify feedback exists
SELECT COUNT(*) FROM feedback;

-- Check recent entries
SELECT * FROM feedback 
WHERE datetime(created_at) >= datetime('now', '-1 day');
```

### AI Analysis Failing

```bash
# Verify AI binding is enabled
wrangler deploy --env production

# Check AI model availability
# Some models may not be available in all regions
```

### Database Permissions

```bash
# Verify D1 permissions
wrangler d1 execute feedback_db --remote "SELECT 1"

# Check migrations
wrangler migrations list --remote
```

## Monitoring

```bash
# View real-time logs
wrangler tail --env production

# Check past deployments
wrangler deployments list

# Monitor analytics
# https://dash.cloudflare.com → Workers → Tail
```

## Performance Tips

1. **Optimize Queries**: Use indexes on `created_at`, `priority`, `sentiment`
2. **Batch Processing**: Group similar feedback before AI analysis
3. **Cache Results**: Store recent analysis to avoid duplicate processing
4. **Limit History**: Archive old feedback to keep queries fast

## Cost Estimate

- **D1 Database**: ~$0.01 per 1M queries
- **Workers AI**: Included in Workers (up to 10k requests/month)
- **Scheduled Events**: Included in Workers
- **Slack Webhooks**: Free
- **Total**: ~$0.02-0.05 per day depending on feedback volume

## Next Steps

1. ✅ Configure Slack webhook
2. ✅ Deploy to Cloudflare
3. ✅ Ingest test feedback
4. ✅ Run first manual analysis
5. ✅ Wait for scheduled trigger (or test with curl)
6. 📈 Monitor trends over time
7. 🔧 Customize analysis and filters

## Resources

- [Cloudflare Workers](https://developers.cloudflare.com/workers/)
- [Cloudflare D1](https://developers.cloudflare.com/d1/)
- [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/)
- [Slack Webhooks](https://api.slack.com/messaging/webhooks)
- [Cron Expression Help](https://crontab.guru/)

---

**Need help?** Check [WORKFLOWS_SETUP.md](./WORKFLOWS_SETUP.md) for detailed setup instructions.
