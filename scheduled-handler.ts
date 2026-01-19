import { ScheduledEvent } from "cloudflare:workers";

interface Env {
  feedback_db: D1Database;
  AI?: any;
  SLACK_WEBHOOK_URL?: string;
  DAILY_ANALYSIS_WORKFLOW?: any;
}

/**
 * Scheduled handler that triggers the daily analysis workflow
 * Configure in wrangler.jsonc with a cron trigger
 */
export async function handleScheduled(event: ScheduledEvent, env: Env) {
  try {
    console.log("Triggering daily feedback analysis workflow");

    // Get feedback from the past 24 hours
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const { results: feedbackData } = await env.feedback_db
      .prepare(
        `
        SELECT * FROM feedback
        WHERE datetime(created_at) >= datetime(?)
        ORDER BY created_at DESC
      `
      )
      .bind(yesterday.toISOString())
      .all();

    if (!feedbackData || feedbackData.length === 0) {
      console.log("No feedback received in the past 24 hours");
      return;
    }

    console.log(`Processing ${feedbackData.length} feedback items`);

    // Analyze feedback
    const analysis = await analyzeFeedback(feedbackData, env);

    // Send to Slack
    if (env.SLACK_WEBHOOK_URL) {
      await sendToSlack(analysis, env.SLACK_WEBHOOK_URL, feedbackData);
    }

    // Log analysis results
    await logAnalysis(analysis, env);
  } catch (error) {
    console.error("Scheduled handler error:", error);
    // Send error notification to Slack if configured
    if (env.SLACK_WEBHOOK_URL) {
      await notifyError(error, env.SLACK_WEBHOOK_URL);
    }
  }
}

interface AnalysisResult {
  totalFeedback: number;
  byPriority: Record<string, number>;
  bySentiment: Record<string, number>;
  byCategory: Record<string, number>;
  topIssues: Array<{
    issue: string;
    count: number;
    sentiment: string;
  }>;
  recommendedActions: string[];
  urgentCount: number;
}

async function analyzeFeedback(
  feedbackData: any[],
  env: Env
): Promise<AnalysisResult> {
  const stats = {
    totalFeedback: feedbackData.length,
    byPriority: {} as Record<string, number>,
    bySentiment: {} as Record<string, number>,
    byCategory: {} as Record<string, number>,
    urgentCount: 0,
  };

  const issues = new Map<string, { count: number; sentiment: string }>();

  feedbackData.forEach((item) => {
    // Count by priority
    const p = item.priority || "unknown";
    stats.byPriority[p] = (stats.byPriority[p] || 0) + 1;

    if (p === "P0" || p === "P1") {
      stats.urgentCount++;
    }

    // Count by sentiment
    const s = item.sentiment || "unknown";
    stats.bySentiment[s] = (stats.bySentiment[s] || 0) + 1;

    // Count by category
    const c = item.category || "other";
    stats.byCategory[c] = (stats.byCategory[c] || 0) + 1;

    // Track issues
    if (item.summary) {
      const existing = issues.get(item.summary) || {
        count: 0,
        sentiment: item.sentiment || "neutral",
      };
      existing.count += 1;
      issues.set(item.summary, existing);
    }
  });

  // Get top issues
  const topIssues = Array.from(issues.entries())
    .map(([issue, data]) => ({
      issue,
      ...data,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // Generate AI insights
  let recommendedActions: string[] = [];
  if (env.AI && topIssues.length > 0) {
    try {
      const issuesSummary = topIssues
        .map(
          (i) => `- ${i.issue} (${i.count} occurrences, sentiment: ${i.sentiment})`
        )
        .join("\n");

      const response = await env.AI.run(
        "@cf/mistral/mistral-7b-instruct-v0.1",
        {
          prompt: `Based on these customer feedback issues:\n\n${issuesSummary}\n\nProvide 3-4 specific, actionable recommendations to address these issues. Format as a numbered list.`,
        }
      );

      if (response && response.result && response.result.response) {
        recommendedActions = response.result.response
          .split("\n")
          .filter((line: string) => line.trim().length > 0)
          .slice(0, 4);
      }
    } catch (error) {
      console.error("AI analysis error:", error);
      recommendedActions = [
        "Review high-priority feedback items",
        "Investigate recurring issues",
        "Follow up with affected customers",
      ];
    }
  }

  return {
    ...stats,
    topIssues,
    recommendedActions,
  };
}

async function sendToSlack(
  analysis: AnalysisResult,
  webhookUrl: string,
  feedbackData: any[]
): Promise<void> {
  const blocks = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "📊 Daily Feedback Analysis",
        emoji: true,
      },
    },
    {
      type: "section",
      fields: [
        {
          type: "mrkdwn",
          text: `*Total Feedback:*\n${analysis.totalFeedback}`,
        },
        {
          type: "mrkdwn",
          text: `*Negative Sentiment:*\n${analysis.bySentiment.negative || 0}`,
        },
        {
          type: "mrkdwn",
          text: `*P0 Priority:*\n${analysis.byPriority.P0 || 0}`,
        },
        {
          type: "mrkdwn",
          text: `*P1 Priority:*\n${analysis.byPriority.P1 || 0}`,
        },
      ],
    },
    {
      type: "divider",
    },
  ];

  // Add top issues
  if (analysis.topIssues.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Top Issues:*\n${analysis.topIssues
          .slice(0, 3)
          .map((issue) => `• ${issue.issue} (${issue.count}x)`)
          .join("\n")}`,
      },
    });
  }

  // Add recommended actions
  if (analysis.recommendedActions.length > 0) {
    blocks.push(
      {
        type: "divider",
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Recommended Actions:*\n${analysis.recommendedActions
            .map((action) => `• ${action}`)
            .join("\n")}`,
        },
      }
    );
  }

  // Add urgent items if any
  if (analysis.urgentCount > 0) {
    const urgentItems = feedbackData
      .filter((item) => item.priority === "P0" || item.priority === "P1")
      .slice(0, 3);

    blocks.push(
      {
        type: "divider",
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*⚠️ Urgent Items (${analysis.urgentCount}):*`,
        },
      }
    );

    urgentItems.forEach((item) => {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `• [${item.priority}] ${item.summary || item.raw_text.substring(0, 80)}\n_${item.source} • ${new Date(item.created_at).toLocaleString()}_`,
        },
      });
    });
  }

  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        text: {
          type: "plain_text",
          text: "View Dashboard",
          emoji: true,
        },
        url: "https://your-domain.com/dashboard",
        action_id: "view_dashboard",
      },
    ],
  });

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blocks }),
    });

    if (!response.ok) {
      console.error(`Slack API error: ${response.status}`);
    }
  } catch (error) {
    console.error("Slack notification error:", error);
  }
}

async function logAnalysis(analysis: AnalysisResult, env: Env): Promise<void> {
  try {
    await env.feedback_db
      .prepare(
        `
        INSERT INTO analysis_logs (timestamp, total_feedback, negative_count, p0_count, p1_count, data)
        VALUES (?, ?, ?, ?, ?, ?)
      `
      )
      .bind(
        new Date().toISOString(),
        analysis.totalFeedback,
        analysis.bySentiment.negative || 0,
        analysis.byPriority.P0 || 0,
        analysis.byPriority.P1 || 0,
        JSON.stringify(analysis)
      )
      .run();
  } catch (error) {
    console.error("Failed to log analysis:", error);
  }
}

async function notifyError(error: any, webhookUrl: string): Promise<void> {
  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `🚨 *Feedback Analysis Error*\n\`\`\`${String(error)}\`\`\``,
            },
          },
        ],
      }),
    });
  } catch (e) {
    console.error("Failed to send error notification:", e);
  }
}
