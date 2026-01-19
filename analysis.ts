/**
 * Utility functions for feedback analysis and Slack integration
 */

export interface SlackMessage {
  blocks: SlackBlock[];
  thread_ts?: string;
}

export interface SlackBlock {
  type: string;
  text?: {
    type: string;
    text: string;
    emoji?: boolean;
  };
  fields?: Array<{
    type: string;
    text: string;
  }>;
  elements?: any[];
  url?: string;
  action_id?: string;
}

/**
 * Format large numbers with commas
 */
export function formatNumber(num: number): string {
  return num.toLocaleString("en-US");
}

/**
 * Calculate sentiment percentage
 */
export function getSentimentPercentage(count: number, total: number): string {
  if (total === 0) return "0%";
  return `${Math.round((count / total) * 100)}%`;
}

/**
 * Get emoji for sentiment
 */
export function getSentimentEmoji(sentiment: string): string {
  const emojis: Record<string, string> = {
    positive: "😊",
    neutral: "😐",
    negative: "😞",
  };
  return emojis[sentiment] || "❓";
}

/**
 * Get emoji for priority
 */
export function getPriorityEmoji(priority: string): string {
  const emojis: Record<string, string> = {
    P0: "🔴",
    P1: "🟠",
    P2: "🟡",
    P3: "🟢",
  };
  return emojis[priority] || "⚪";
}

/**
 * Get color for priority
 */
export function getPriorityColor(priority: string): string {
  const colors: Record<string, string> = {
    P0: "#FF0000",
    P1: "#FF6600",
    P2: "#FFCC00",
    P3: "#00CC00",
  };
  return colors[priority] || "#CCCCCC";
}

/**
 * Truncate text to max length
 */
export function truncate(text: string, maxLength: number = 100): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + "...";
}

/**
 * Format date for display
 */
export function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    return date.toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return dateStr;
  }
}

/**
 * Format time difference (e.g., "2 hours ago")
 */
export function formatTimeDiff(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  } catch {
    return "recently";
  }
}

/**
 * Extract words from text
 */
export function extractWords(text: string, minLength: number = 4): string[] {
  return text
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length >= minLength && /^[a-z]+$/.test(word));
}

/**
 * Get top N items from array based on count property
 */
export function getTopItems<T extends { count: number }>(
  items: T[],
  n: number = 5
): T[] {
  return items.sort((a, b) => b.count - a.count).slice(0, n);
}

/**
 * Create Slack divider block
 */
export function createDividerBlock(): SlackBlock {
  return { type: "divider" };
}

/**
 * Create Slack header block
 */
export function createHeaderBlock(text: string): SlackBlock {
  return {
    type: "header",
    text: {
      type: "plain_text",
      text,
      emoji: true,
    },
  };
}

/**
 * Create Slack section block with text
 */
export function createSectionBlock(text: string, markdown: boolean = true): SlackBlock {
  return {
    type: "section",
    text: {
      type: markdown ? "mrkdwn" : "plain_text",
      text,
      emoji: true,
    },
  };
}

/**
 * Create Slack button element
 */
export function createButton(text: string, url: string, actionId: string = ""): any {
  return {
    type: "button",
    text: {
      type: "plain_text",
      text,
      emoji: true,
    },
    url,
    action_id: actionId || `button_${Date.now()}`,
  };
}

/**
 * Build analysis summary
 */
export function buildAnalysisSummary(analysis: any): string {
  let summary = "*📊 Analysis Summary*\n";
  summary += `• Total Feedback: *${formatNumber(analysis.totalFeedback)}*\n`;
  summary += `• Negative: *${analysis.bySentiment.negative || 0}* (${getSentimentPercentage(
    analysis.bySentiment.negative || 0,
    analysis.totalFeedback
  )})\n`;
  summary += `• Positive: *${analysis.bySentiment.positive || 0}* (${getSentimentPercentage(
    analysis.bySentiment.positive || 0,
    analysis.totalFeedback
  )})\n`;
  summary += `• P0 Issues: *${analysis.byPriority.P0 || 0}*\n`;
  summary += `• P1 Issues: *${analysis.byPriority.P1 || 0}*`;
  return summary;
}

/**
 * Build action items for recommendations
 */
export function buildActionItems(actions: string[]): string {
  return actions.map((action, i) => `${i + 1}. ${action}`).join("\n");
}

/**
 * Generate AI prompt for analysis
 */
export function generateAnalysisPrompt(issues: Array<any>): string {
  const issuesSummary = issues
    .map((i) => `- ${i.issue} (${i.count} occurrences, sentiment: ${i.sentiment})`)
    .join("\n");

  return `Based on these customer feedback issues:\n\n${issuesSummary}\n\nProvide 3-4 specific, actionable recommendations to address these issues. Format as a numbered list.`;
}

/**
 * Validate Slack webhook URL
 */
export function isValidSlackWebhook(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "hooks.slack.com" && parsed.pathname.startsWith("/services/");
  } catch {
    return false;
  }
}

/**
 * Retry async function with exponential backoff
 */
export async function retryAsync<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  initialDelay: number = 1000
): Promise<T> {
  let lastError: any;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i < maxRetries - 1) {
        const delay = initialDelay * Math.pow(2, i);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

/**
 * Parse feedback metadata from raw text
 */
export function parseFeedbackMetadata(rawText: string): {
  email?: string;
  phone?: string;
  tags?: string[];
} {
  const result: any = {};

  // Extract email
  const emailMatch = rawText.match(/[\w.-]+@[\w.-]+\.\w+/);
  if (emailMatch) {
    result.email = emailMatch[0];
  }

  // Extract phone (basic pattern)
  const phoneMatch = rawText.match(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/);
  if (phoneMatch) {
    result.phone = phoneMatch[0];
  }

  // Extract tags (words starting with #)
  const tags = rawText.match(/#\w+/g);
  if (tags) {
    result.tags = tags.map((t) => t.substring(1));
  }

  return result;
}

/**
 * Generate analysis report in plain text
 */
export function generateTextReport(analysis: any): string {
  let report = "═══════════════════════════════════════\n";
  report += "DAILY FEEDBACK ANALYSIS REPORT\n";
  report += "═══════════════════════════════════════\n\n";

  report += `Generated: ${new Date().toLocaleString()}\n\n`;

  report += "SUMMARY\n";
  report += "───────────────────────────────────────\n";
  report += `Total Feedback:     ${formatNumber(analysis.totalFeedback)}\n`;
  report += `Negative Sentiment: ${analysis.bySentiment.negative || 0}\n`;
  report += `Positive Sentiment: ${analysis.bySentiment.positive || 0}\n`;
  report += `P0 Priority Items:  ${analysis.byPriority.P0 || 0}\n`;
  report += `P1 Priority Items:  ${analysis.byPriority.P1 || 0}\n\n`;

  report += "TOP ISSUES\n";
  report += "───────────────────────────────────────\n";
  analysis.topIssues.slice(0, 5).forEach((issue: any, i: number) => {
    report += `${i + 1}. ${issue.issue}\n`;
    report += `   Occurrences: ${issue.count}\n`;
    report += `   Sentiment:   ${issue.sentiment}\n\n`;
  });

  report += "RECOMMENDATIONS\n";
  report += "───────────────────────────────────────\n";
  analysis.recommendedActions.forEach((action: string, i: number) => {
    report += `${i + 1}. ${action}\n`;
  });

  report += "\n═══════════════════════════════════════\n";

  return report;
}
