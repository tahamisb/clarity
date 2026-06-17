export const cxKpis = {
  totalInteractions: 38450,
  sentimentScore: 7.4, // out of 10
  cancellationRate: 4.5, // %
  avgResolutionTime: 3.8, // hours
  chatbotContainment: 68.2, // %
  escalationRate: 31.8, // %

  // trends (positive numbers mean "up", so we'll decide if up is good or bad in UI)
  totalInteractionsTrend: "+4%",
  sentimentScoreTrend: "+0.2",
  cancellationRateTrend: "-0.6%",
  avgResolutionTimeTrend: "-0.4h",
  chatbotContainmentTrend: "+2.1%",
  escalationRateTrend: "-2.1%",
};

export const weeklyCallsVolume = [
  { week: "W1", billing: 1200, technical: 800, returns: 400, complaints: 600, general: 1500, cancellations: 500 },
  { week: "W2", billing: 1300, technical: 850, returns: 420, complaints: 580, general: 1450, cancellations: 520 },
  { week: "W3", billing: 1250, technical: 900, returns: 380, complaints: 620, general: 1600, cancellations: 480 },
  { week: "W4", billing: 1400, technical: 820, returns: 450, complaints: 650, general: 1550, cancellations: 550 },
  { week: "W5", billing: 1350, technical: 880, returns: 410, complaints: 610, general: 1500, cancellations: 510 },
  { week: "W6", billing: 1280, technical: 840, returns: 390, complaints: 590, general: 1480, cancellations: 490 },
  { week: "W7", billing: 1320, technical: 860, returns: 430, complaints: 630, general: 1520, cancellations: 530 },
  { week: "W8", billing: 1450, technical: 920, returns: 480, complaints: 700, general: 1650, cancellations: 600 },
  { week: "W9", billing: 1380, technical: 890, returns: 440, complaints: 640, general: 1580, cancellations: 540 },
  { week: "W10", billing: 1300, technical: 850, returns: 400, complaints: 600, general: 1500, cancellations: 500 },
  { week: "W11", billing: 1250, technical: 820, returns: 380, complaints: 580, general: 1450, cancellations: 480 },
  { week: "W12", billing: 1200, technical: 800, returns: 350, complaints: 550, general: 1400, cancellations: 450 },
];

export const weeklySentiment = [
  { week: "W1", score: 7.2, positive: 65, neutral: 20, negative: 15 },
  { week: "W2", score: 7.3, positive: 66, neutral: 19, negative: 15 },
  { week: "W3", score: 7.1, positive: 64, neutral: 20, negative: 16 },
  { week: "W4", score: 7.4, positive: 68, neutral: 18, negative: 14 },
  { week: "W5", score: 7.2, positive: 65, neutral: 19, negative: 16 },
  { week: "W6", score: 7.5, positive: 69, neutral: 18, negative: 13 },
  { week: "W7", score: 7.3, positive: 67, neutral: 18, negative: 15 },
  { week: "W8", score: 6.8, positive: 58, neutral: 22, negative: 20 }, // dip
  { week: "W9", score: 7.1, positive: 64, neutral: 20, negative: 16 },
  { week: "W10", score: 7.4, positive: 68, neutral: 18, negative: 14 },
  { week: "W11", score: 7.5, positive: 69, neutral: 18, negative: 13 },
  { week: "W12", score: 7.6, positive: 71, neutral: 17, negative: 12 },
];

export const topComplaints = [
  { rank: 1, name: "Late Delivery", count: 1245, trend: "up" },
  { rank: 2, name: "Wrong Items Sent", count: 854, trend: "down" },
  { rank: 3, name: "App Crashes", count: 620, trend: "up" },
];

export const topNegativeTopics = [
  { topic: "Delivery Time", count: 320 },
  { topic: "Food Quality", count: 280 },
  { topic: "Missing Items", count: 210 },
  { topic: "Rude Driver", count: 150 },
  { topic: "Payment Error", count: 95 },
];

export const sentimentMerchantBreakdown = [
  { name: "Restaurant", value: 45, fill: "var(--chart-1)" },
  { name: "Dark Kitchen", value: 35, fill: "var(--chart-4)" },
  { name: "Grocery", value: 15, fill: "var(--chart-2)" },
  { name: "Pharmacy", value: 5, fill: "var(--chart-5)" },
];

export const weeklyCancellations = [
  { week: "W1", rate: 4.2 },
  { week: "W2", rate: 4.5 },
  { week: "W3", rate: 4.1 },
  { week: "W4", rate: 4.8 },
  { week: "W5", rate: 6.5 },
  { week: "W6", rate: 4.6 },
  { week: "W7", rate: 4.3 },
  { week: "W8", rate: 4.7 },
  { week: "W9", rate: 4.4 },
  { week: "W10", rate: 4.9 },
  { week: "W11", rate: 5.1 },
  { week: "W12", rate: 4.5 },
];

export const topCancellationDrivers = [
  { name: "Late Preparation", count: 3240, percentage: 38 },
  { name: "Driver No-show", count: 1960, percentage: 23 },
  { name: "Customer Changed Mind", count: 1108, percentage: 13 },
];

export const cancellationZones = [
  { zone: "West Bay", rate: 6.8, level: "high" },
  { zone: "Lusail", rate: 5.5, level: "high" },
  { zone: "Al Rayyan", rate: 4.2, level: "medium" },
  { zone: "Al Wakra", rate: 3.8, level: "low" },
  { zone: "Al Daayen", rate: 3.2, level: "low" },
  { zone: "Al Khor", rate: 2.9, level: "low" },
];

export const weeklyResolutionTime = [
  { week: "W1", hours: 3.9 },
  { week: "W2", hours: 4.1 }, // breach
  { week: "W3", hours: 3.8 },
  { week: "W4", hours: 4.5 }, // breach
  { week: "W5", hours: 5.2 }, // breach
  { week: "W6", hours: 4.0 },
  { week: "W7", hours: 3.7 },
  { week: "W8", hours: 4.8 }, // breach
  { week: "W9", hours: 4.2 }, // breach
  { week: "W10", hours: 3.9 },
  { week: "W11", hours: 3.6 },
  { week: "W12", hours: 3.5 },
];

export const resolutionByIssueType = [
  { type: "Wrong Item", avgTime: 2.4, trend: "down", sla: "Met", status: "met" },
  { type: "Late Delivery", avgTime: 1.8, trend: "down", sla: "Met", status: "met" },
  { type: "Refund Request", avgTime: 6.2, trend: "up", sla: "Breached", status: "breached" },
  { type: "App Error", avgTime: 4.8, trend: "up", sla: "Breached", status: "breached" },
  { type: "Cancellation Query", avgTime: 2.1, trend: "down", sla: "Met", status: "met" },
  { type: "Payment Issue", avgTime: 3.5, trend: "neutral", sla: "Met", status: "met" },
];

export const chatbotStats = {
  containmentRate: 68.2,
  fallbackRate: 14.5,
  avgBotTurns: 2.4,
  topUnanswered: "Order refund status",
};

export const topUnansweredQuestions = [
  { rank: 1, question: "Where is my refund from last week?", count: 1450 },
  { rank: 2, question: "Can I change my delivery address after ordering?", count: 980 },
  { rank: 3, question: "Why was my account charged twice?", count: 765 },
  { rank: 4, question: "السائق لم يحضر الطلب حتى الان", count: 640 }, // Driver didn't bring the order yet
  { rank: 5, question: "طلبي ناقص كيف استرجع فلوسي؟", count: 590 }, // My order is missing items, how to refund?
];

export const chatbotResolutionSplit = [
  { name: "Bot Resolved", value: 68.2, fill: "var(--primary)" },
  { name: "Agent Escalated", value: 31.8, fill: "var(--muted-foreground)" },
];

export const weeklyCxHealth = [
  { week: "W5", score: 72 },
  { week: "W6", score: 76 },
  { week: "W7", score: 78 },
  { week: "W8", score: 65 }, // dip
  { week: "W9", score: 74 },
  { week: "W10", score: 77 },
  { week: "W11", score: 81 },
  { week: "W12", score: 84 },
];

export const cxHealthComponents = [
  { name: "Sentiment (30%)", score: 26 },
  { name: "Cancellations (25%)", score: 21 },
  { name: "Resolution (25%)", score: 22 },
  { name: "Chatbot (20%)", score: 15 },
];
