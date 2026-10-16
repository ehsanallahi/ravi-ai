import { JOB_TYPES, type JobHandler } from "../jobs";
import { handleAiReply } from "./ai-reply";
import { handleWhatsAppSend } from "./whatsapp-send";
import { handleWhatsAppWebhook } from "./whatsapp-webhook";

export const handlers: Record<string, JobHandler> = {
  [JOB_TYPES.whatsappWebhook]: handleWhatsAppWebhook,
  [JOB_TYPES.aiReply]: handleAiReply,
  [JOB_TYPES.whatsappSend]: handleWhatsAppSend,
};
