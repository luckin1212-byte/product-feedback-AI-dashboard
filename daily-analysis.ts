import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from "cloudflare:workers";

interface FeedbackWorkflowEnv {
  feedback_db: D1Database;
  AI: any;
  SLACK_WEBHOOK_URL: string;
}

interface ProcessedFeedback {
  id: string;
  source: string;
  raw_text: string;
  sentiment: string;
  priority: string;
  category: string;
  summary: string;
  priority_reason: string;
  created_at: string;
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
  urgentItems: ProcessedFeedback[];
}

export class DailyAnalysisWorkflow extends WorkflowEntrypoint<
  FeedbackWorkflowEnv,
  AnalysisResult
> {
  async run(event: WorkflowEvent<AnalysisResult>, step: WorkflowStep) {
    // Step 1: Fetch all feedback from the past 24 hours
    const feedbackData = await step.do("fetch-feedback", async () => {
      return await this.fetchRecentFeedback();
    });

    // Step 2: Analyze feedback with AI
    const analysis = await step.do("analyze-with-ai", async () => {
      return await this.analyzeWithAI(feedbackData);
    });

    // Step 3: Generate insights
    const insights = await step.do("generate-insights", async () => {
      return await this.generateInsights(analysis);
    });

    // Step 4: Send to Slack
    const slackResult = await step.do("send-to-slack", async () => {
      return await this.sendToSlack(insights);
    });

    // Step 5: Log to database
    await step.do("log-analysis", async () => {
      return await this.logAnalysis(insights);
    });

    return insights;
  }

  private async fetchRecentFeedback(): Promise<ProcessedFeedback[]> {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const { results } = await this.env.feedback_db
      .prepare(
        `
        SELECT * FROM feedback
        WHERE datetime(created_at) >= datetime(?)
        ORDER BY created_at DESC
      `
      )
      .bind(yesterday.toISOString())
      .all<ProcessedFeedback>();

    return results || [];
  }

  private async analyzeWithAI(feedback: ProcessedFeedback[]) {
    if (feedback.length === 0) {
      return {
        totalFeedback: 0,
        byPriority: {},
        bySentiment: {},
        byCategory: {},
        topIssues: [],
        recommendedActions: [],
        urgentItems: [],
      };
    }

    // Group feedback
    const stats = {
      totalFeedback: feedback.length,
      byPriority: {} as Record<string, number>,
      bySentiment: {} as Record<string, number>,
      byCategory: {} as Record<string, number>,
      urgentItems: [] as ProcessedFeedback[],
    };

    const issues = new Map<string, { count: number; sentiment: string }>();

    feedback.forEach((item) => {
      // Count by priority
      const p = item.priority || "unknown";
      stats.byPriority[p] = (stats.byPriority[p] || 0) + 1;

      if (p === "P0" || p === "P1") {
        stats.urgentItems.push(item);
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

    // Generate AI insights using Cloudflare AI
    let recommendedActions: string[] = [];
    if (this.env.AI && topIssues.length > 0) {
      try {
        const issuesSummary = topIssues
          .map(
            (i) => `- ${i.issue} (${i.count} occurrences, sentiment: ${i.sentiment})`
          )
          .join("\n");

        const response = await this.env.AI.run("@cf/mistral/mistral-7b-instruct-v0.1", {
          prompt: `Based on these customer feedback issues:\n\n${issuesSummary}\n\nProvide 3-4 specific, actionable recommendations to address these issues. Format as a numbered list.`,
        });

        if (response && response.result && response.result.response) {
          recommendedActions = response.result.response
            .split("\n")
            .filter((line: string) => line.trim().length > 0);
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

  private async generateInsights(analysis: any): Promise<AnalysisResult> {
    // Extract key metrics
    const totalNegative = analysis.bySentiment.negative || 0;
    const totalPositive = analysis.bySentiment.positive || 0;
    const totalNeutral = analysis.bySentiment.neutral || 0;
    const totalP0 = analysis.byPriority.P0 || 0;
    const totalP1 = analysis.byPriority.P1 || 0;

    return {
      totalFeedback: analysis.totalFeedback,
      byPriority: analysis.byPriority,
      bySentiment: analysis.bySentiment,
      byCategory: analysis.byCategory,
      topIssues: analysis.topIssues,
      recommendedActions: analysis.recommendedActions,
      urgentItems: analysis.urgentItems.slice(0, 5), // Top 5 urgent items
    };
  }

  private async sendToSlack(insights: AnalysisResult): Promise<any> {
    if (!this.env.SLACK_WEBHOOK_URL) {
      console.warn("SLACK_WEBHOOK_URL not configured");
      return { success: false, error: "Webhook not configured" };
    }

    // Build Slack message
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
            text: `*Total Feedback:*\n${insights.totalFeedback}`,
          },
          {
            type: "mrkdwn",
            text: `*Negative Sentiment:*\n${insights.bySentiment.negative || 0}`,
          },
          {
            type: "mrkdwn",
            text: `*P0 Priority:*\n${insights.byPriority.P0 || 0}`,
          },
          {
            type: "mrkdwn",
            text: `*P1 Priority:*\n${insights.byPriority.P1 || 0}`,
          },
        ],
      },
      {
        type: "divider",
      },
    ];

    // Add top issues
    if (insights.topIssues.length > 0) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Top Issues:*\n${insights.topIssues
            .slice(0, 3)
            .map((issue: any) => `• ${issue.issue} (${issue.count}x)`)
            .join("\n")}`,
        },
      });
    }

    // Add recommended actions
    if (insights.recommendedActions.length > 0) {
      blocks.push(
        {
          type: "divider",
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Recommended Actions:*\n${insights.recommendedActions
              .slice(0, 3)
              .map((action: string) => `• ${action}`)
              .join("\n")}`,
          },
        }
      );
    }

    // Add urgent items if any
    if (insights.urgentItems.length > 0) {
      blocks.push(
        {
          type: "divider",
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*⚠️ Urgent Items (${insights.urgentItems.length}):*`,
          },
        }
      );

      insights.urgentItems.slice(0, 3).forEach((item: ProcessedFeedback) => {
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
          url: `${new URL(this.env.SLACK_WEBHOOK_URL).origin}/dashboard`,
          action_id: "view_dashboard",
        },
      ],
    });

    try {
      const response = await fetch(this.env.SLACK_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blocks }),
      });

      return {
        success: response.ok,
        status: response.status,
      };
    } catch (error) {
      console.error("Slack notification error:", error);
      return {
        success: false,
        error: String(error),
      };
    }
  }

  private async logAnalysis(insights: AnalysisResult): Promise<void> {
    // Store analysis results in a table for historical tracking
    try {
      await this.env.feedback_db
        .prepare(
          `
          INSERT INTO analysis_logs (timestamp, total_feedback, negative_count, p0_count, p1_count, data)
          VALUES (?, ?, ?, ?, ?, ?)
        `
        )
        .bind(
          new Date().toISOString(),
          insights.totalFeedback,
          insights.bySentiment.negative || 0,
          insights.byPriority.P0 || 0,
          insights.byPriority.P1 || 0,
          JSON.stringify(insights)
        )
        .run();
    } catch (error) {
      console.error("Failed to log analysis:", error);
    }
  }
}
