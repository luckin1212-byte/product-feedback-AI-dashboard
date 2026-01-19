/**
 * Example: Advanced Workflow Configuration
 * 
 * This demonstrates how to set up multiple workflows and custom triggers
 */

import { ScheduledEvent } from "cloudflare:workers";

interface WorkflowConfig {
  name: string;
  schedule: string;
  enabled: boolean;
  slackChannel?: string;
  emailRecipients?: string[];
  filters?: {
    minPriority?: string;
    sentiments?: string[];
    categories?: string[];
  };
}

// Define multiple workflow configurations
const workflows: Record<string, WorkflowConfig> = {
  dailyAnalysis: {
    name: "Daily Feedback Analysis",
    schedule: "0 9 * * *", // 9 AM UTC every day
    enabled: true,
    slackChannel: "#feedback-analysis",
    filters: {
      sentiments: ["negative", "neutral", "positive"],
    },
  },
  urgentAlerts: {
    name: "Urgent Issues Alert",
    schedule: "*/30 * * * *", // Every 30 minutes
    enabled: true,
    slackChannel: "#urgent-feedback",
    filters: {
      minPriority: "P0",
    },
  },
  weeklyDigest: {
    name: "Weekly Digest",
    schedule: "0 10 * * MON", // 10 AM UTC every Monday
    enabled: true,
    slackChannel: "#weekly-digest",
    filters: {
      sentiments: ["negative"],
    },
  },
  performanceReport: {
    name: "Performance Issues Report",
    schedule: "0 11 * * FRI", // 11 AM UTC every Friday
    enabled: true,
    slackChannel: "#performance",
    filters: {
      categories: ["performance", "bug"],
    },
  },
};

/**
 * Scheduled handler with routing based on workflow type
 */
export async function handleScheduledWithRouting(
  event: ScheduledEvent,
  env: any
): Promise<void> {
  const now = new Date();
  const cron = `${now.getUTCHours()} ${now.getUTCMinutes()} * * *`;

  console.log(`[${now.toISOString()}] Checking scheduled triggers...`);

  // Check which workflow should run
  for (const [key, config] of Object.entries(workflows)) {
    if (config.enabled && matchesCron(config.schedule, now)) {
      console.log(`Triggering workflow: ${config.name}`);
      await executeWorkflow(key, config, env);
    }
  }
}

/**
 * Simple cron pattern matcher
 */
function matchesCron(pattern: string, date: Date): boolean {
  // This is a simplified matcher - for production, use a proper cron parser
  const [minute, hour, dayOfMonth, month, dayOfWeek] = pattern.split(" ");

  const dateMinute = date.getUTCMinutes();
  const dateHour = date.getUTCHours();
  const dateDay = date.getUTCDate();
  const dateMonth = date.getUTCMonth() + 1;
  const dateDoW = date.getUTCDay();

  const checkField = (pattern: string, value: number): boolean => {
    if (pattern === "*") return true;
    if (pattern.includes(",")) {
      return pattern.split(",").map(Number).includes(value);
    }
    if (pattern.includes("/")) {
      const [start, step] = pattern.split("/").map(Number);
      return value % step === start % step;
    }
    if (pattern.includes("-")) {
      const [start, end] = pattern.split("-").map(Number);
      return value >= start && value <= end;
    }
    return Number(pattern) === value;
  };

  return (
    checkField(minute, dateMinute) &&
    checkField(hour, dateHour) &&
    checkField(dayOfMonth, dateDay) &&
    checkField(month, dateMonth) &&
    (dayOfWeek === "*" || checkField(dayOfWeek, dateDoW))
  );
}

/**
 * Execute specific workflow
 */
async function executeWorkflow(
  workflowKey: string,
  config: WorkflowConfig,
  env: any
): Promise<void> {
  try {
    // Fetch feedback with filters
    const feedback = await fetchFilteredFeedback(config.filters, env);

    if (feedback.length === 0) {
      console.log(`No feedback matching filters for ${config.name}`);
      return;
    }

    // Analyze feedback
    const analysis = await analyzeFeedback(feedback, env);

    // Send notifications
    if (config.slackChannel) {
      await sendSlackNotification(config.name, analysis, config.slackChannel, env);
    }

    if (config.emailRecipients && config.emailRecipients.length > 0) {
      await sendEmailNotification(config.name, analysis, config.emailRecipients, env);
    }

    console.log(`✅ Workflow completed: ${config.name}`);
  } catch (error) {
    console.error(`❌ Workflow failed: ${config.name}`, error);
  }
}

/**
 * Fetch feedback with custom filters
 */
async function fetchFilteredFeedback(
  filters: any = {},
  env: any
): Promise<any[]> {
  let query = "SELECT * FROM feedback WHERE 1=1";
  const params: any[] = [];

  if (filters.minPriority) {
    const priorities = ["P0", "P1", "P2", "P3"];
    const minIndex = priorities.indexOf(filters.minPriority);
    const validPriorities = priorities.slice(0, minIndex + 1);
    query += ` AND priority IN (${validPriorities.map(() => "?").join(",")})`;
    params.push(...validPriorities);
  }

  if (filters.sentiments && filters.sentiments.length > 0) {
    query += ` AND sentiment IN (${filters.sentiments.map(() => "?").join(",")})`;
    params.push(...filters.sentiments);
  }

  if (filters.categories && filters.categories.length > 0) {
    query += ` AND category IN (${filters.categories.map(() => "?").join(",")})`;
    params.push(...filters.categories);
  }

  query += " ORDER BY created_at DESC LIMIT 1000";

  const { results } = await env.feedback_db.prepare(query).bind(...params).all();
  return results || [];
}

/**
 * Analyze feedback
 */
async function analyzeFeedback(feedback: any[], env: any): Promise<any> {
  // Implementation similar to main scheduled handler
  return {
    totalFeedback: feedback.length,
    byPriority: {},
    bySentiment: {},
    byCategory: {},
    topIssues: [],
    recommendedActions: [],
  };
}

/**
 * Send Slack notification
 */
async function sendSlackNotification(
  workflowName: string,
  analysis: any,
  channel: string,
  env: any
): Promise<void> {
  // Implementation to send to Slack
  console.log(`Sending ${workflowName} to ${channel}`);
}

/**
 * Send email notification
 */
async function sendEmailNotification(
  workflowName: string,
  analysis: any,
  recipients: string[],
  env: any
): Promise<void> {
  // Implementation to send email
  console.log(`Sending ${workflowName} to ${recipients.join(", ")}`);
}

// Export for use in worker
export { workflows, handleScheduledWithRouting };
