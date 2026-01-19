/**
 * Cloudflare Workers + D1 + Workers AI
 * Routes:
 *  - POST /ingest  (JSON: {source, raw_text, ...optional overrides...})
 *  - GET  /dashboard?sentiment=negative&priority=P1&limit=50
 *  - GET  /dashboard?format=json
 */

import { Ai } from "@cloudflare/ai";

interface Env {
  feedback_db: D1Database; // wrangler.jsonc -> d1_databases[].binding
  AI?: any; // wrangler.jsonc -> ai.binding = "AI"
  INGEST_TOKEN?: string; // optional
  USE_MOCK_AI?: string; // set to "true" for local development
  SLACK_WEBHOOK_URL?: string; // for Slack notifications
  DAILY_ANALYSIS_WORKFLOW: Workflow;
}

interface FeedbackRecord {
  id: string;
  source: string;
  raw_text: string;
  sentiment: string | null;
  priority: string | null;
  category: string | null;
  summary: string | null;
  priority_reason: string | null;
  created_at: string;
}

type FeedbackFilters = {
  sentiment?: string | null;
  priority?: string | null;
  category?: string | null;
  source?: string | null;
  productOnly?: boolean;
  limit?: number;
};

type AiAutoLabels = {
  sentiment?: string;
  priority?: string;
  category?: string;
  summary?: string;
  priority_reason?: string;
  reason?: string; // fallback key some models may use
};

const PRIORITIES = ["P0", "P1", "P2", "P3"] as const;
const SENTIMENTS = ["negative", "neutral", "positive"] as const;
const MAX_LIMIT = 200;
const PRODUCT_CATEGORIES = [
  "bug",
  "performance",
  "feature_request",
  "docs",
  "ux",
  "security",
  "billing",
];

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return new Response(`OK. POST feedback to /ingest and visit /dashboard`, {
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    // -------------------------
    // GET /api/stats
    // -------------------------
    if (url.pathname === "/api/stats") {
      const productOnly = resolveProductOnly(url.searchParams.get("product_only"));
      const allFeedback = await listFeedback(env, { limit: 1000, productOnly });
      
      const stats = {
        total: allFeedback.length,
        byPriority: {} as Record<string, number>,
        bySentiment: {} as Record<string, number>,
        byCategory: {} as Record<string, number>,
        last7Days: 0,
        topWords: [] as { word: string; count: number }[],
      };

      const now = Date.now();
      const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

      const wordFreq = new Map<string, number>();

      allFeedback.forEach((feedback) => {
        // Count by priority
        const p = feedback.priority || "unknown";
        stats.byPriority[p] = (stats.byPriority[p] || 0) + 1;

        // Count by sentiment
        const s = feedback.sentiment || "unknown";
        stats.bySentiment[s] = (stats.bySentiment[s] || 0) + 1;

        // Count by category
        const c = feedback.category || "other";
        stats.byCategory[c] = (stats.byCategory[c] || 0) + 1;

        // Count last 7 days
        if (new Date(feedback.created_at).getTime() > sevenDaysAgo) {
          stats.last7Days++;
        }

        // Extract words from summary/raw_text
        const text = (feedback.summary || feedback.raw_text || "").toLowerCase();
        const words = text.match(/\b[a-z]{3,}\b/g) || [];
        const stopwords = new Set([
          "the", "and", "for", "with", "that", "this", "from", "are", "but", "can", "has", "have", "been", "one", "like", "when", "where", "what", "which", "who", "why", "how",
        ]);
        words.forEach((word) => {
          if (!stopwords.has(word)) {
            wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
          }
        });
      });

      stats.topWords = Array.from(wordFreq)
        .map(([word, count]) => ({ word, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 50);

      return Response.json(stats);
    }

    // -------------------------
    // POST /api/generate-sample-data
    // -------------------------
    if (url.pathname === "/api/generate-sample-data" && request.method === "POST") {
      let payload: Record<string, unknown> = {};
      try {
        payload = await request.json();
      } catch {
        payload = {};
      }

      const sampleFeedbacks = [
        { source: "github", text: "App crashes on login page after update" },
        { source: "twitter", text: "Love the new UI design!" },
        { source: "email", text: "Dashboard is too slow with large datasets" },
        { source: "slack", text: "Payment processing failed for multiple users" },
        { source: "discord", text: "Feature request: dark mode support" },
        { source: "github", text: "Database connection timeout errors" },
        { source: "email", text: "Documentation is outdated and confusing" },
        { source: "twitter", text: "Great customer support experience!" },
        { source: "slack", text: "Mobile app crashes on iOS 17" },
        { source: "github", text: "Security vulnerability in auth flow" },
        { source: "discord", text: "New feature is amazing, well done!" },
        { source: "email", text: "Export feature not working" },
        { source: "twitter", text: "Subscription billing issue" },
        { source: "slack", text: "API response time degradation" },
        { source: "github", text: "Cache invalidation bug" },
      ];

      const productFeedbacks = [
        { source: "github", text: "Search results take 8+ seconds to load on mobile" },
        { source: "slack", text: "Export to CSV fails when dataset exceeds 10k rows" },
        { source: "email", text: "Please add bulk edit for tags in the dashboard" },
        { source: "twitter", text: "Notifications are too noisy, need per-project settings" },
        { source: "discord", text: "Dark mode is missing and the white UI is harsh at night" },
        { source: "github", text: "Webhook retries stop after one failure" },
        { source: "email", text: "Inline comments are hard to find; add @mention search" },
        { source: "slack", text: "Billing page crashes when switching plans" },
        { source: "twitter", text: "Filtering by date range resets after refresh" },
        { source: "github", text: "CSV import silently drops rows with empty fields" },
        { source: "discord", text: "Please add keyboard shortcuts for navigation" },
        { source: "email", text: "Mobile layout overlaps the chart titles" },
        { source: "slack", text: "Audit log misses updates from API integrations" },
        { source: "github", text: "Invite flow fails for users with SSO enabled" },
        { source: "twitter", text: "Need a way to pin important feedback to the top" },
        { source: "email", text: "Performance drops noticeably after enabling AI summary" },
        { source: "discord", text: "Tag colors are too similar and hard to distinguish" },
        { source: "github", text: "Dashboard export shows wrong timezone for timestamps" },
        { source: "slack", text: "Rate limit errors appear when loading analytics" },
        { source: "twitter", text: "Would love a weekly digest instead of daily only" },
        { source: "email", text: "Search should support quoted phrases" },
        { source: "github", text: "The API returns 500 when filtering by category=docs" },
        { source: "discord", text: "Add a summary badge for unresolved P0 items" },
        { source: "email", text: "Docs need an example for the /ingest payload" },
        { source: "slack", text: "User mentions in Slack summary are not linked" },
        { source: "twitter", text: "Sorting by priority resets when changing filters" },
        { source: "github", text: "Security: allowlist IPs for ingest endpoint" },
        { source: "discord", text: "UI should remember last used filters" },
        { source: "email", text: "Please support multi-select categories in filters" },
        { source: "slack", text: "Some summaries are too long; add max length setting" },
        { source: "twitter", text: "Need a quick way to mark feedback as resolved" },
        { source: "github", text: "PDF export loses table borders" },
        { source: "discord", text: "The word cloud overlaps on small screens" },
        { source: "email", text: "Add SLA alerts for P0 issues" },
        { source: "slack", text: "Dashboard tabs load slowly on first open" },
      ];

      const productOnly = resolveBoolean(payload.product_only) ?? resolveBoolean(url.searchParams.get("product_only")) ?? false;
      const targetCount = normalizeLimit(String(payload.count ?? url.searchParams.get("count"))) ?? sampleFeedbacks.length;
      const sourceList = productOnly ? productFeedbacks : sampleFeedbacks.concat(productFeedbacks);

      for (let i = 0; i < targetCount; i += 1) {
        const feedback = sourceList[i % sourceList.length];
        const randomDaysAgo = Math.floor(Math.random() * 30);
        const createdAt = new Date(Date.now() - randomDaysAgo * 24 * 60 * 60 * 1000).toISOString();
        
        const aiDebug = { ai_available: !!env.AI, ai_called: false, ai_response: null as any, ai_error: null as any, ai_labels: null as any };
        const aiLabels = await inferFeedbackMetadata(env, { source: feedback.source, text: feedback.text }, aiDebug);

        const sentiment = sanitizeChoice(aiLabels?.sentiment, SENTIMENTS);
        const priority = sanitizeChoice(aiLabels?.priority, PRIORITIES);
        const category = sanitizeNullable(aiLabels?.category);
        const summary = sanitizeNullable(aiLabels?.summary) || feedback.text.slice(0, 120);

        const record: FeedbackRecord = {
          id: crypto.randomUUID(),
          source: feedback.source,
          raw_text: feedback.text,
          sentiment,
          priority,
          category,
          summary,
          priority_reason: sanitizeNullable(aiLabels?.priority_reason),
          created_at: createdAt,
        };

        await env.feedback_db
          .prepare(
            `INSERT INTO feedback
              (id, source, raw_text, sentiment, priority, category, summary, priority_reason, created_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`
          )
          .bind(
            record.id,
            record.source,
            record.raw_text,
            record.sentiment,
            record.priority,
            record.category,
            record.summary,
            record.priority_reason,
            record.created_at
          )
          .run();
      }

      return Response.json({ status: "ok", count: targetCount, message: "Sample data generated" });
    }

    // -------------------------
    // POST /ingest
    // -------------------------
    if (url.pathname === "/ingest") {
      if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
      }

      const authError = ensureAuthorized(request, env, url);
      if (authError) return authError;

      let payload: Record<string, unknown>;
      try {
        payload = await request.json();
      } catch {
        return new Response("Invalid JSON payload", { status: 400 });
      }

      const source = String(payload.source ?? "").trim();
      const rawText = String(payload.raw_text ?? "").trim();
      if (!source || !rawText) {
        return new Response("Both `source` and `raw_text` are required", { status: 400 });
      }

      // Workers AI auto-labels (if AI binding exists)
      const aiDebug = { ai_available: !!env.AI, ai_called: false, ai_response: null as any, ai_error: null as any, ai_labels: null as any };
      const aiLabels = await inferFeedbackMetadata(env, { source, text: rawText }, aiDebug);
      aiDebug.ai_labels = aiLabels;

      // Allow user payload to override AI output (useful for manual correction)
      const sentiment = sanitizeChoice(payload.sentiment ?? aiLabels?.sentiment, SENTIMENTS);
      const priority = sanitizeChoice(payload.priority ?? aiLabels?.priority, PRIORITIES);
      const category = sanitizeNullable(payload.category ?? aiLabels?.category);
      const summary =
        sanitizeNullable(payload.summary ?? aiLabels?.summary) || rawText.slice(0, 120);

      const priorityReason = sanitizeNullable(
        payload.priority_reason ?? aiLabels?.priority_reason ?? aiLabels?.reason
      );

      const createdAt = sanitizeNullable(payload.created_at) ?? new Date().toISOString();

      const record: FeedbackRecord = {
        id: crypto.randomUUID(),
        source,
        raw_text: rawText,
        sentiment,
        priority,
        category,
        summary,
        priority_reason: priorityReason,
        created_at: createdAt,
      };

      await env.feedback_db
        .prepare(
          `INSERT INTO feedback
            (id, source, raw_text, sentiment, priority, category, summary, priority_reason, created_at)
          VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`
        )
        .bind(
          record.id,
          record.source,
          record.raw_text,
          record.sentiment,
          record.priority,
          record.category,
          record.summary,
          record.priority_reason,
          record.created_at
        )
        .run();

      return Response.json({ status: "ok", record, _debug: aiDebug });
    }

    // -------------------------
    // GET /dashboard
    // -------------------------
    if (url.pathname === "/dashboard") {
      // Auto-generate sample data if database is empty
      let allItems = await listFeedback(env, { limit: 1 });
      if (allItems.length === 0) {
        const sampleFeedbacks = [
          { source: "github", text: "App crashes on login page after update" },
          { source: "twitter", text: "Love the new UI design!" },
          { source: "email", text: "Dashboard is too slow with large datasets" },
          { source: "slack", text: "Payment processing failed for multiple users" },
          { source: "discord", text: "Feature request: dark mode support" },
          { source: "github", text: "Database connection timeout errors" },
          { source: "email", text: "Documentation is outdated and confusing" },
          { source: "twitter", text: "Great customer support experience!" },
          { source: "slack", text: "Mobile app crashes on iOS 17" },
          { source: "github", text: "Security vulnerability in auth flow" },
          { source: "discord", text: "New feature is amazing, well done!" },
          { source: "email", text: "Export feature not working" },
          { source: "twitter", text: "Subscription billing issue" },
          { source: "slack", text: "API response time degradation" },
          { source: "github", text: "Cache invalidation bug" },
        ];

        for (const feedback of sampleFeedbacks) {
          const randomDaysAgo = Math.floor(Math.random() * 30);
          const createdAt = new Date(Date.now() - randomDaysAgo * 24 * 60 * 60 * 1000).toISOString();
          
          const aiDebug = { ai_available: !!env.AI, ai_called: false, ai_response: null as any, ai_error: null as any, ai_labels: null as any };
          const aiLabels = await inferFeedbackMetadata(env, { source: feedback.source, text: feedback.text }, aiDebug);

          const sentiment = sanitizeChoice(aiLabels?.sentiment, SENTIMENTS);
          const priority = sanitizeChoice(aiLabels?.priority, PRIORITIES);
          const category = sanitizeNullable(aiLabels?.category);
          const summary = sanitizeNullable(aiLabels?.summary) || feedback.text.slice(0, 120);

          const record: FeedbackRecord = {
            id: crypto.randomUUID(),
            source: feedback.source,
            raw_text: feedback.text,
            sentiment,
            priority,
            category,
            summary,
            priority_reason: sanitizeNullable(aiLabels?.priority_reason),
            created_at: createdAt,
          };

          await env.feedback_db
            .prepare(
              `INSERT INTO feedback
                (id, source, raw_text, sentiment, priority, category, summary, priority_reason, created_at)
              VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`
            )
            .bind(
              record.id,
              record.source,
              record.raw_text,
              record.sentiment,
              record.priority,
              record.category,
              record.summary,
              record.priority_reason,
              record.created_at
            )
            .run();
        }
      }

      const productOnly = resolveProductOnly(url.searchParams.get("product_only"));
      const list = await listFeedback(env, {
        sentiment: sanitizeChoice(url.searchParams.get("sentiment"), SENTIMENTS),
        priority: sanitizeChoice(url.searchParams.get("priority"), PRIORITIES),
        category: sanitizeNullable(url.searchParams.get("category")),
        source: sanitizeNullable(url.searchParams.get("source")),
        productOnly,
        limit: normalizeLimit(url.searchParams.get("limit")),
      });

      if (url.searchParams.get("format") === "json") {
        return Response.json({ records: list });
      }

      const highPriority = list.filter(
        (r) => r.sentiment === "negative" && (r.priority === "P0" || r.priority === "P1")
      );

      // Generate AI Summary
      let aiSummary = "";
      try {
        const allFeedback = await listFeedback(env, { limit: 1000, productOnly });
        
        const stats = {
          total: allFeedback.length,
          byPriority: {} as Record<string, number>,
          bySentiment: {} as Record<string, number>,
          byCategory: {} as Record<string, number>,
        };

        const now = Date.now();
        const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
        let last7Days = 0;

        allFeedback.forEach((feedback) => {
          const p = feedback.priority || "unknown";
          stats.byPriority[p] = (stats.byPriority[p] || 0) + 1;

          const s = feedback.sentiment || "unknown";
          stats.bySentiment[s] = (stats.bySentiment[s] || 0) + 1;

          const c = feedback.category || "other";
          stats.byCategory[c] = (stats.byCategory[c] || 0) + 1;

          if (new Date(feedback.created_at).getTime() > sevenDaysAgo) {
            last7Days++;
          }
        });

        if ((env.AI || env.USE_MOCK_AI) && allFeedback.length > 0) {
          const summaryPrompt = `Based on this feedback dashboard data, provide a concise executive summary with actionable insights:

Total Feedback: ${stats.total}
Last 7 Days: ${last7Days}

Sentiment Distribution:
- Positive: ${stats.bySentiment.positive || 0}
- Neutral: ${stats.bySentiment.neutral || 0}
- Negative: ${stats.bySentiment.negative || 0}

Priority Distribution:
- P0 (Critical): ${stats.byPriority.P0 || 0}
- P1 (High): ${stats.byPriority.P1 || 0}
- P2 (Medium): ${stats.byPriority.P2 || 0}
- P3 (Low): ${stats.byPriority.P3 || 0}

Category Distribution:
${Object.entries(stats.byCategory)
  .map(([cat, count]) => `- ${cat}: ${count}`)
  .join("\n")}

Please provide:
1. Key findings about overall sentiment and priority trends
2. Top 3 actionable insights or recommendations
3. Critical areas needing immediate attention (if any)

Format the response as clear, concise bullet points.`;

          try {
            console.log("AI Summary: Attempting to call AI model...");
            console.log("AI binding available:", !!env.AI);
            console.log("Mock AI enabled:", env.USE_MOCK_AI);
            console.log("Feedback count:", allFeedback.length);
            
            let response: any;
            
            if (env.USE_MOCK_AI && !env.AI) {
              // Mock AI response for local development
              console.log("Using Mock AI response");
              response = {
                result: {
                  response: `Key Findings:
• Overall sentiment is ${stats.bySentiment.negative ? "trending negative" : "positive"} with ${stats.bySentiment.negative || 0} negative feedback items
• ${stats.byPriority.P0 || 0} critical (P0) issues require immediate attention
• Most common issue category: ${Object.entries(stats.byCategory).sort((a, b) => b[1] - a[1])[0]?.[0] || "unknown"}
• Last 7 days: ${last7Days} new feedback items

Recommended Actions:
1. Address the ${stats.byPriority.P0 || 0} P0 critical issues as top priority
2. Focus on improving customer satisfaction in the "${Object.entries(stats.byCategory).sort((a, b) => b[1] - a[1])[0]?.[0] || "primary"}" category
3. Implement monitoring for recurring patterns in negative feedback

Critical Items Requiring Attention:
• ${stats.byPriority.P0 || 0} P0 items pending resolution
• ${stats.bySentiment.negative || 0} negative sentiment feedback entries
• Review category performance trends`
                }
              };
            } else {
              response = await env.AI.run(
                "@cf/mistral/mistral-7b-instruct-v0.1",
                { prompt: summaryPrompt }
              );
            }

            console.log("AI Response structure:", JSON.stringify(response, null, 2));

            const aiText =
              response?.result?.response ??
              response?.result?.output_text ??
              response?.result?.text ??
              (Array.isArray(response?.result?.outputs)
                ? response.result.outputs
                    .map((output: { text?: string }) => output?.text)
                    .filter(Boolean)
                    .join("\n")
                : undefined) ??
              response?.response ??
              response?.output_text ??
              response?.text;

            if (aiText) {
              aiSummary = aiText;
              console.log("AI Summary generated successfully");
            } else {
              console.warn("Unexpected AI response format:", response);
              aiSummary = "Summary generated but with unexpected format.";
            }
          } catch (e) {
            const errorMsg = e instanceof Error ? e.message : String(e);
            console.error("AI summary error:", errorMsg);
            console.error("Full error:", e);
            aiSummary = `Unable to generate AI summary at this time. (Error: ${errorMsg.substring(0, 50)})`;
          }
        } else {
          console.log("AI Summary: Skipped. AI binding:", !!env.AI, "Mock AI:", env.USE_MOCK_AI, "Feedback count:", allFeedback.length);
        }
      } catch (e) {
        console.error("Summary generation error:", e);
      }

      const rows =
        list
          .map(
            (r) => `
<tr class="feedback-row">
  <td>${escapeHtml(formatDate(r.created_at))}</td>
  <td>${escapeHtml(r.source)}</td>
  <td>${escapeHtml(r.sentiment ?? "-")}</td>
  <td>${escapeHtml(r.priority ?? "-")}</td>
  <td>${escapeHtml(r.category ?? "-")}</td>
  <td>${escapeHtml(r.raw_text ?? "-")}</td>
</tr>`
          )
          .join("") || `<tr><td colspan="6" style="text-align:center">No feedback yet.</td></tr>`;

      const slackConfigured = Boolean(env.SLACK_WEBHOOK_URL);

      const page = `
<!doctype html>
<html>
<head>
  <meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Feedback Dashboard</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"><\/script>
  <script src="https://cdn.jsdelivr.net/npm/wordcloud@1.2.2/src/wordcloud.js"><\/script>
  <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:24px;background:#f9fafb;color:#111}.container{max-width:1400px;margin:0 auto}h1{margin:0 0 32px 0;font-size:32px;font-weight:700}.ai-summary{background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:#fff;padding:32px;border-radius:12px;margin-bottom:24px;box-shadow:0 4px 6px rgba(102,126,234,.2)}.ai-summary h2{color:#fff;margin:0 0 16px 0;font-size:24px;font-weight:600;display:flex;align-items:center;gap:8px}.ai-summary h2::before{content:'🤖';font-size:28px}.ai-summary p{line-height:1.8;margin:0 0 12px 0;font-size:15px;opacity:.95}.ai-summary ul{margin:12px 0 0 20px;padding:0}.ai-summary li{margin:8px 0;line-height:1.6;font-size:15px;opacity:.95}.slack-card{background:#fff;border-radius:12px;border:1px solid #e5e7eb;box-shadow:0 1px 3px rgba(0,0,0,.08);padding:20px;margin-bottom:24px;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}.slack-card h3{margin:0;font-size:18px;font-weight:600}.slack-meta{color:#6b7280;font-size:14px;line-height:1.5}.slack-status{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;font-size:12px;font-weight:600}.slack-status.connected{background:#dcfce7;color:#166534}.slack-status.disconnected{background:#fee2e2;color:#991b1b}.slack-actions{display:flex;gap:10px;flex-wrap:wrap}.btn{display:inline-block;padding:8px 12px;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none;border:1px solid #d1d5db;color:#111;background:#fff}.btn.primary{background:#2563eb;border-color:#2563eb;color:#fff}.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:40px}.stat-card{background:#fff;padding:24px;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.08);border:1px solid #e5e7eb}.stat-card h3{font-size:13px;font-weight:600;color:#6b7280;margin-bottom:8px;text-transform:uppercase}.stat-card .value{font-size:40px;font-weight:700;color:#111}.charts{display:grid;grid-template-columns:repeat(auto-fit,minmax(380px,1fr));gap:24px;margin-bottom:40px}.chart-container{background:#fff;padding:24px;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.08);border:1px solid #e5e7eb}.chart-container h3{margin-bottom:16px;font-weight:600;font-size:16px}.wordcloud-container{background:#fff;padding:24px;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.08);border:1px solid #e5e7eb;margin-bottom:40px}#wordcloud{width:100%!important;height:400px}.feedback-table{background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.08);border:1px solid #e5e7eb;overflow:hidden}table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #e5e7eb;padding:14px 16px;font-size:14px;text-align:left}th{background:#f9fafb;font-weight:600;color:#374151}tr:hover{background:#f9fafb}.badge{display:inline-block;padding:4px 10px;border-radius:6px;font-size:12px;font-weight:500}.badge.negative{background:#fee2e2;color:#991b1b}.badge.neutral{background:#fef3c7;color:#92400e}.badge.positive{background:#dcfce7;color:#166534}.badge.unknown{background:#f3f4f6;color:#6b7280}.badge.p0{background:#fecaca;color:#7f1d1d}.badge.p1{background:#fed7aa;color:#92400e}.badge.p2{background:#bfdbfe;color:#1e40af}.badge.p3{background:#dbeafe;color:#0c4a6e}h2{margin:40px 0 16px 0;font-weight:600;font-size:20px}.hint{color:#666;font-size:13px;margin-bottom:16px}</style>
</head>
<body>
  <div class="container">
    <h1>📊 Feedback Dashboard</h1>
    ${aiSummary ? `<div class="ai-summary">
      <h2>AI Summary & Insights</h2>
      <div style="white-space:pre-wrap;font-family:inherit;line-height:1.8">${escapeHtml(aiSummary)}</div>
    </div>` : ""}
    <div class="slack-card">
      <div>
        <h3>Slack Daily Summary</h3>
        <div class="slack-meta">Send the AI Summary & Insights to Slack every day at 09:00 UTC.</div>
      </div>
      <div>
        <div class="slack-status ${slackConfigured ? "connected" : "disconnected"}">
          ${slackConfigured ? "Connected" : "Not connected"}
        </div>
      </div>
      <div class="slack-actions">
        <a class="btn primary" href="https://api.slack.com/messaging/webhooks" target="_blank" rel="noreferrer">Connect Slack</a>
        <a class="btn" href="https://developers.cloudflare.com/workers/wrangler/commands/#secret" target="_blank" rel="noreferrer">Set Webhook Secret</a>
      </div>
    </div>
    <div class="summary">
      <div class="stat-card"><h3>Total</h3><div class="value" id="total-count">0</div></div>
      <div class="stat-card"><h3>Last 7 Days</h3><div class="value" id="last7-count">0</div></div>
      <div class="stat-card"><h3>Negative</h3><div class="value" id="negative-count">0</div></div>
      <div class="stat-card"><h3>P0 Critical</h3><div class="value" id="p0-count">0</div></div>
    </div>
    <div class="charts">
      <div class="chart-container"><h3>Priority</h3><canvas id="priorityChart"><\/canvas></div>
      <div class="chart-container"><h3>Sentiment</h3><canvas id="sentimentChart"><\/canvas></div>
      <div class="chart-container"><h3>Categories</h3><canvas id="categoryChart"><\/canvas></div>
    </div>
    <div class="wordcloud-container"><h3>☁️ Keywords</h3><div id="wordcloud" style="position:relative;width:100%;height:400px;background:linear-gradient(135deg,#f8f9fa 0%,#ffffff 100%);border-radius:8px;overflow:hidden"></div></div>
    <h2>All Feedback (${list.length})</h2>
    <div style="background:#fff;padding:20px;border-radius:12px;margin-bottom:20px;border:1px solid #e5e7eb">
      <h3 style="margin-bottom:16px;font-weight:600">Filters</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:16px">
        <div>
          <label style="display:block;font-size:12px;font-weight:600;margin-bottom:6px;color:#6b7280">Sentiment</label>
          <select id="filter-sentiment" style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:6px;font-size:14px" onchange="applyFilters()">
            <option value="">All</option>
            <option value="negative">Negative</option>
            <option value="neutral">Neutral</option>
            <option value="positive">Positive</option>
          </select>
        </div>
        <div>
          <label style="display:block;font-size:12px;font-weight:600;margin-bottom:6px;color:#6b7280">Priority</label>
          <select id="filter-priority" style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:6px;font-size:14px" onchange="applyFilters()">
            <option value="">All</option>
            <option value="P0">P0</option>
            <option value="P1">P1</option>
            <option value="P2">P2</option>
            <option value="P3">P3</option>
          </select>
        </div>
        <div>
          <label style="display:block;font-size:12px;font-weight:600;margin-bottom:6px;color:#6b7280">Category</label>
          <select id="filter-category" style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:6px;font-size:14px" onchange="applyFilters()">
            <option value="">All</option>
            <option value="bug">Bug</option>
            <option value="performance">Performance</option>
            <option value="feature_request">Feature Request</option>
            <option value="docs">Docs</option>
          </select>
        </div>
        <div>
          <label style="display:block;font-size:12px;font-weight:600;margin-bottom:6px;color:#6b7280">Source</label>
          <select id="filter-source" style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:6px;font-size:14px" onchange="applyFilters()">
            <option value="">All</option>
            <option value="github">GitHub</option>
            <option value="twitter">Twitter</option>
            <option value="email">Email</option>
            <option value="slack">Slack</option>
            <option value="discord">Discord</option>
          </select>
        </div>
        <div>
          <label style="display:block;font-size:12px;font-weight:600;margin-bottom:6px;color:#6b7280">Scope</label>
          <label style="display:flex;align-items:center;gap:8px;font-size:14px">
            <input id="filter-product-only" type="checkbox" ${productOnly ? "checked" : ""} onchange="applyFilters()" />
            Product feedback only
          </label>
        </div>
      </div>
      <button onclick="clearFilters()" style="padding:8px 16px;background:#e5e7eb;border:none;border-radius:6px;font-weight:600;cursor:pointer">Clear Filters</button>
      <span id="keyword-filter-info" style="margin-left:12px;color:#666;font-size:14px;display:none">Filtered by keyword: <strong id="current-keyword"></strong> <a href="#" onclick="clearKeywordFilter(event)" style="color:#3b82f6;text-decoration:none;margin-left:8px">[Clear]</a></span>
    </div>
    <div class="feedback-table"><table><thead><tr><th>Time</th><th>Source</th><th>Sentiment</th><th>Priority</th><th>Category</th><th>Comment</th></tr></thead><tbody>${rows}</tbody></table></div>
  </div>
  <script>
    function applyFilters(){
      const sentiment = document.getElementById('filter-sentiment').value;
      const priority = document.getElementById('filter-priority').value;
      const category = document.getElementById('filter-category').value;
      const source = document.getElementById('filter-source').value;
      const productOnly = document.getElementById('filter-product-only').checked;
      
      const params = new URLSearchParams();
      if(sentiment) params.append('sentiment', sentiment);
      if(priority) params.append('priority', priority);
      if(category) params.append('category', category);
      if(source) params.append('source', source);
      params.append('product_only', productOnly ? '1' : '0');
      
      window.location.href = '/dashboard?' + params.toString();
    }
    
    function clearFilters(){
      window.location.href = '/dashboard';
    }
    
    function clearKeywordFilter(e) {
      e.preventDefault();
      document.querySelectorAll('.feedback-row').forEach(row => {
        row.style.display = '';
      });
      document.querySelectorAll('.no-results').forEach(row => {
        row.remove();
      });
      document.getElementById('keyword-filter-info').style.display = 'none';
    }
    
    async function loadData() {
      try {
        const productOnly = document.getElementById('filter-product-only').checked;
        const res = await fetch('/api/stats?product_only=' + (productOnly ? '1' : '0'));
        const stats = await res.json();
        
        document.getElementById('total-count').textContent = stats.total;
        document.getElementById('last7-count').textContent = stats.last7Days;
        document.getElementById('negative-count').textContent = stats.bySentiment['negative'] || 0;
        document.getElementById('p0-count').textContent = stats.byPriority['P0'] || 0;
        
        // Priority Chart
        new Chart(document.getElementById('priorityChart'), {
          type: 'doughnut',
          data: {
            labels: ['P0','P1','P2','P3'],
            datasets: [{
              data: [stats.byPriority['P0']||0, stats.byPriority['P1']||0, stats.byPriority['P2']||0, stats.byPriority['P3']||0],
              backgroundColor: ['#ef4444','#f97316','#eab308','#84cc16']
            }]
          },
          options: {responsive: true, plugins: {legend: {position: 'bottom'}}}
        });
        
        // Sentiment Chart
        new Chart(document.getElementById('sentimentChart'), {
          type: 'doughnut',
          data: {
            labels: ['Negative','Neutral','Positive','Unknown'],
            datasets: [{
              data: [stats.bySentiment['negative']||0, stats.bySentiment['neutral']||0, stats.bySentiment['positive']||0, stats.bySentiment['unknown']||0],
              backgroundColor: ['#ef4444','#f59e0b','#10b981','#d1d5db']
            }]
          },
          options: {responsive: true, plugins: {legend: {position: 'bottom'}}}
        });
        
        // Category Chart
        const tc = Object.entries(stats.byCategory).sort((a,b)=>b[1]-a[1]).slice(0,6);
        new Chart(document.getElementById('categoryChart'), {
          type: 'bar',
          data: {
            labels: tc.map(x=>x[0]),
            datasets: [{label: 'Count', data: tc.map(x=>x[1]), backgroundColor: '#3b82f6'}]
          },
          options: {indexAxis: 'y', responsive: true, plugins: {legend: {display: false}}, scales: {x: {beginAtZero: true}}}
        });
        
        // Word Cloud with collision detection
        if(stats.topWords && stats.topWords.length > 0) {
          const wordcloud = document.getElementById('wordcloud');
          wordcloud.innerHTML = '';
          const maxCount = Math.max(...stats.topWords.map(x => x.count));
          const colors = ['#3b82f6','#8b5cf6','#ec4899','#f59e0b','#10b981','#06b6d4','#14b8a6','#f43f5e','#8b5cf6','#06b6d4'];
          const positions = [];
          
          function canPlaceWord(x, y, width, height) {
            for(let pos of positions) {
              if(!(x + width + 10 < pos.x || x > pos.x + pos.width + 10 ||
                   y + height + 10 < pos.y || y > pos.y + pos.height + 10)) {
                return false;
              }
            }
            return true;
          }
          
          stats.topWords.slice(0, 25).forEach((word, idx) => {
            const size = 14 + (word.count / maxCount) * 28;
            const color = colors[idx % colors.length];
            const angle = Math.random() * 10 - 5;
            
            const span = document.createElement('span');
            span.textContent = word.word;
            span.style.position = 'absolute';
            span.style.fontSize = size + 'px';
            span.style.color = color;
            span.style.fontWeight = '700';
            span.style.opacity = (0.75 + (word.count / maxCount) * 0.25).toString();
            span.style.cursor = 'pointer';
            span.style.whiteSpace = 'nowrap';
            span.style.transition = 'all 0.3s ease';
            span.style.padding = '4px 8px';
            span.style.userSelect = 'none';
            span.setAttribute('data-keyword', word.word);
            
            let placed = false;
            let attempts = 0;
            while(!placed && attempts < 50) {
              const x = Math.random() * 85;
              const y = Math.random() * 85;
              const estimatedWidth = word.word.length * (size * 0.6);
              const estimatedHeight = size * 1.3;
              
              if(canPlaceWord(x, y, estimatedWidth, estimatedHeight)) {
                span.style.left = x + '%';
                span.style.top = y + '%';
                positions.push({x, y, width: estimatedWidth, height: estimatedHeight});
                placed = true;
              }
              attempts++;
            }
            
            if(placed) {
              const transformStr = 'translate(-50%, -50%) rotate(' + angle + 'deg)';
              span.style.transform = transformStr;
              
              span.onmouseover = function() {
                span.style.color = '#000';
                span.style.fontWeight = '900';
                const scaleStr = 'translate(-50%, -50%) rotate(' + angle + 'deg) scale(1.15)';
                span.style.transform = scaleStr;
              };
              span.onmouseout = function() {
                span.style.color = color;
                span.style.fontWeight = '700';
                const normalStr = 'translate(-50%, -50%) rotate(' + angle + 'deg) scale(1)';
                span.style.transform = normalStr;
              };
              span.onclick = function() {
                filterFeedbackByKeyword(word.word);
              };
              wordcloud.appendChild(span);
            }
          });
        }
        
        function filterFeedbackByKeyword(keyword) {
          const rows = document.querySelectorAll('.feedback-row');
          let visibleCount = 0;
          rows.forEach(row => {
            const text = row.textContent.toLowerCase();
            if(text.includes(keyword.toLowerCase())) {
              row.style.display = '';
              visibleCount++;
            } else {
              row.style.display = 'none';
            }
          });
          
          document.getElementById('current-keyword').textContent = keyword;
          document.getElementById('keyword-filter-info').style.display = 'inline';
          
          if(visibleCount === 0) {
            const tbody = document.querySelector('tbody');
            const noResults = tbody.querySelector('.no-results');
            if(!noResults) {
              const tr = document.createElement('tr');
              tr.className = 'no-results';
              tr.innerHTML = '<td colspan="6" style="text-align:center;padding:20px">No feedback contains "' + keyword + '"</td>';
              tbody.appendChild(tr);
            }
          } else {
            const noResults = document.querySelector('.no-results');
            if(noResults) noResults.remove();
          }
        }
      } catch(error) {
        console.error('Error loading data:', error);
      }
    }
    
    loadData();
  <\/script>
</body>
</html>
      `.trim();
      return new Response(page, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    return new Response("Not Found", { status: 404 });
  },

  async scheduled(_controller: ScheduledController, _env: Env, _ctx: ExecutionContext) {
    if (!_env.DAILY_ANALYSIS_WORKFLOW) {
      console.log("scheduled event fired without workflow binding");
      return;
    }

    const today = new Date().toISOString().slice(0, 10);
    const instanceId = `daily-analysis-${today}`;

    _ctx.waitUntil(
      _env.DAILY_ANALYSIS_WORKFLOW.create({ id: instanceId }).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`workflow instance ${instanceId} not started: ${message}`);
      })
    );
  },
} satisfies ExportedHandler<Env>;

// -------------------------
// Helpers
// -------------------------

function sanitizeChoice<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  if (typeof value !== "string") return null;
  return allowed.includes(value as T) ? (value as T) : null;
}

function sanitizeNullable(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  return str.length ? str : null;
}

function normalizeLimit(value: string | null): number | undefined {
  if (!value) return undefined;
  const num = Number(value);
  if (!Number.isFinite(num)) return undefined;
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(num)));
}

async function listFeedback(env: Env, filters: FeedbackFilters): Promise<FeedbackRecord[]> {
  const clauses: string[] = [];
  const params: Array<string | number> = [];

  if (filters.productOnly) {
    const placeholders = PRODUCT_CATEGORIES.map(() => "?").join(", ");
    clauses.push(`category IN (${placeholders})`);
    params.push(...PRODUCT_CATEGORIES);
  }

  if (filters.sentiment) {
    clauses.push("sentiment = ?");
    params.push(filters.sentiment);
  }

  if (filters.priority) {
    clauses.push("priority = ?");
    params.push(filters.priority);
  }

  if (filters.category) {
    clauses.push("category = ?");
    params.push(filters.category);
  }

  if (filters.source) {
    clauses.push("source = ?");
    params.push(filters.source);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = filters.limit ?? 100;

  const query = `
    SELECT id, source, raw_text, sentiment, priority, category, summary, priority_reason, created_at
    FROM feedback
    ${where}
    ORDER BY datetime(created_at) DESC
    LIMIT ?
  `;

  const { results } = await env.feedback_db
    .prepare(query)
    .bind(...params, limit)
    .all<FeedbackRecord>();

  return results ?? [];
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().replace("T", " ").replace("Z", " UTC");
}

function resolveBoolean(value: unknown): boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return null;
}

function resolveProductOnly(value: string | null): boolean {
  return resolveBoolean(value) ?? true;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function ensureAuthorized(request: Request, env: Env, url: URL): Response | null {
  const expected = env.INGEST_TOKEN;
  if (!expected) return null;

  const authHeader = request.headers.get("authorization");
  let provided = authHeader
    ? authHeader.replace(/^Bearer\s+/i, "")
    : null;

  provided ||= request.headers.get("x-api-key");
  provided ||= url.searchParams.get("token");

  if (provided?.trim() === expected) return null;
  return new Response("Unauthorized", { status: 401 });
}

// -------------------------
// Workers AI labeling
// -------------------------

async function inferFeedbackMetadata(
  env: Env,
  input: { source: string; text: string },
  debug?: any
): Promise<AiAutoLabels | null> {
  console.log("[AI] Starting inferFeedbackMetadata");
  console.log("[AI] env.AI available:", !!env.AI);
  
  if (!env.AI && !env.USE_MOCK_AI) {
    console.log("[AI] AI binding not available and mock disabled, returning null");
    return null;
  }
  if (!input.text) {
    console.log("[AI] Input text empty, returning null");
    return null;
  }

  // Mock AI for local development
  if (env.USE_MOCK_AI === "true") {
    console.log("[AI] Using mock AI for local development");
    if (debug) debug.ai_called = true;
    
    const mockLabels = mockAiInference(input.text);
    if (debug) debug.ai_response = { mock: true };
    if (debug) debug.ai_labels = mockLabels;
    return mockLabels;
  }

  const ai = new Ai(env.AI);
  console.log("[AI] Ai instance created");

  const system =
    "You are a product feedback triage assistant. " +
    "Return ONLY a valid compact JSON object. No markdown. No extra text.";

  const user = [
    "Analyze the following user feedback and classify it.",
    "Return a JSON object with EXACTLY these keys:",
    "",
    'sentiment: one of ["negative","neutral","positive"]',
    'priority: one of ["P0","P1","P2","P3"]',
    'category: one short label like "bug","performance","billing","docs","ux","feature_request","security","other"',
    'priority_reason: 1 concise sentence explaining why this priority was chosen',
    'summary: 1 concise sentence summarizing the feedback',"",
    "Do NOT summarize or rewrite the feedback.",
    "The original feedback text will be stored and displayed separately.",
    "",
    "Priority definitions:",
    "P0 = outage, data loss, security issue, payment failure",
    "P1 = major broken feature that blocks many users",
    "P2 = significant issue but workaround exists",
    "P3 = minor issue or nice-to-have",
    "",
    `Source: ${input.source}`,
    "Original user feedback:",
    `"${input.text}"`,
    "",
    "Return JSON ONLY. Example:",
    '{"sentiment":"negative","priority":"P1","category":"bug","priority_reason":"Login failure blocks all users from accessing the product."}'
].join("\n");
 

  try {
    console.log("[AI] Calling ai.run with llama-3.1-8b-instruct model");
    if (debug) debug.ai_called = true;
    
    const response = await ai.run("@cf/meta/llama-3.1-8b-instruct", {
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: 400,
      temperature: 0.2,
    });

    console.log("[AI] Got response from ai.run:", JSON.stringify(response).slice(0, 200));
    if (debug) debug.ai_response = response;

    const text = pickAiText(response);
    if (!text) {
      console.log("[AI] Failed to extract text from response");
      return null;
    }

    console.log("[AI] Extracted text:", text.slice(0, 100));

    const parsed = safeParseAiJson(text);
    if (!parsed) {
      console.log("[AI] Failed to parse JSON from response");
      return null;
    }

    console.log("[AI] Successfully parsed AI labels:", JSON.stringify(parsed));
    return parsed;
  } catch (error) {
    console.error("[AI] AI tagging failed with error:", error);
    if (debug) debug.ai_error = String(error);
    return null;
  }
}

function pickAiText(response: unknown): string | null {
  if (!response) return null;
  if (typeof response === "string") return response;

  if (typeof response === "object") {
    const maybe = response as Record<string, unknown>;
    const keys = ["response", "result", "text", "output", "content"];
    for (const key of keys) {
      const value = maybe[key];
      if (typeof value === "string" && value.trim()) return value;
    }

    // Some responses may include "messages" array
    const msgs = maybe["messages"];
    if (Array.isArray(msgs) && msgs.length) {
      const last = msgs[msgs.length - 1] as any;
      if (last && typeof last.content === "string" && last.content.trim()) return last.content;
    }
  }

  return null;
}

function safeParseAiJson(text: string): AiAutoLabels | null {
  const trimmed = text.trim();

  // Extract first {...} block
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;

  try {
    const json = JSON.parse(trimmed.slice(start, end + 1));
    if (json && typeof json === "object") {
      return json as AiAutoLabels;
    }
  } catch {
    return null;
  }

  return null;
}

function mockAiInference(text: string): AiAutoLabels {
  const lowerText = text.toLowerCase();

  // Simple heuristics for mock inference
  let sentiment: "negative" | "neutral" | "positive" = "neutral";
  let priority: "P0" | "P1" | "P2" | "P3" = "P3";
  let category = "other";

  // Sentiment detection
  const negativeWords = ["crash", "fail", "error", "bug", "slow", "break", "issue", "problem", "broken"];
  const positiveWords = ["great", "awesome", "love", "excellent", "nice", "good"];

  if (negativeWords.some((w) => lowerText.includes(w))) sentiment = "negative";
  else if (positiveWords.some((w) => lowerText.includes(w))) sentiment = "positive";

  // Priority detection
  if (
    lowerText.includes("outage") ||
    lowerText.includes("down") ||
    lowerText.includes("data loss") ||
    lowerText.includes("security")
  ) {
    priority = "P0";
    category = lowerText.includes("security") ? "security" : "bug";
  } else if (
    lowerText.includes("crash") ||
    lowerText.includes("blocked") ||
    lowerText.includes("blocks all")
  ) {
    priority = "P1";
    category = "bug";
  } else if (lowerText.includes("slow")) {
    priority = "P1";
    category = "performance";
  } else if (
    lowerText.includes("feature") ||
    lowerText.includes("request") ||
    lowerText.includes("like to")
  ) {
    priority = "P3";
    category = "feature_request";
  }

  // Category detection
  if (lowerText.includes("perform")) category = "performance";
  if (lowerText.includes("doc")) category = "docs";
  if (lowerText.includes("billing") || lowerText.includes("payment")) category = "billing";
  if (lowerText.includes("ui") || lowerText.includes("ux")) category = "ux";

  return {
    sentiment,
    priority,
    category,
    summary: text.slice(0, 120),
    priority_reason: `${priority} priority due to ${sentiment} sentiment and ${category} issue`,
  };
}

export { DailyAnalysisWorkflow } from "./workflows/daily-analysis";
