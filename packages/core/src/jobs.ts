/** Job types shared by producers (web app) and consumers (worker). */
export const JOB_TYPES = {
  whatsappWebhook: "whatsapp.webhook",
  aiReply: "ai.reply",
  whatsappSend: "whatsapp.send",
} as const;

export type JobType = (typeof JOB_TYPES)[keyof typeof JOB_TYPES];
