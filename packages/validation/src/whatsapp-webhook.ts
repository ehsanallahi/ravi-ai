import { z } from "zod";

/**
 * WhatsApp Cloud API webhook payloads (field "messages").
 * Objects are `looseObject` so new fields from Meta do not break ingestion;
 * only the fields we rely on are validated.
 */
const mediaSchema = z.looseObject({
  id: z.string(),
  mime_type: z.string().optional(),
  caption: z.string().optional(),
  filename: z.string().optional(),
});

export const inboundMessageSchema = z.looseObject({
  from: z.string(),
  id: z.string(),
  timestamp: z.string(),
  type: z.string(),
  text: z.looseObject({ body: z.string() }).optional(),
  image: mediaSchema.optional(),
  audio: mediaSchema.optional(),
  video: mediaSchema.optional(),
  document: mediaSchema.optional(),
  sticker: mediaSchema.optional(),
  button: z.looseObject({ text: z.string().optional(), payload: z.string().optional() }).optional(),
  interactive: z
    .looseObject({
      type: z.string(),
      button_reply: z.looseObject({ id: z.string(), title: z.string() }).optional(),
      list_reply: z
        .looseObject({ id: z.string(), title: z.string(), description: z.string().optional() })
        .optional(),
    })
    .optional(),
  reaction: z.looseObject({ message_id: z.string(), emoji: z.string().optional() }).optional(),
  location: z
    .looseObject({
      latitude: z.number(),
      longitude: z.number(),
      name: z.string().optional(),
      address: z.string().optional(),
    })
    .optional(),
  context: z.looseObject({ from: z.string().optional(), id: z.string().optional() }).optional(),
});
export type InboundMessage = z.infer<typeof inboundMessageSchema>;

export const messageStatusSchema = z.looseObject({
  id: z.string(),
  status: z.string(),
  timestamp: z.string(),
  recipient_id: z.string().optional(),
  errors: z
    .array(
      z.looseObject({
        code: z.number(),
        title: z.string().optional(),
        message: z.string().optional(),
      }),
    )
    .optional(),
});
export type MessageStatusUpdate = z.infer<typeof messageStatusSchema>;

export const messagesChangeValueSchema = z.looseObject({
  messaging_product: z.literal("whatsapp"),
  metadata: z.looseObject({
    display_phone_number: z.string().optional(),
    phone_number_id: z.string(),
  }),
  contacts: z
    .array(
      z.looseObject({
        wa_id: z.string(),
        profile: z.looseObject({ name: z.string().optional() }).optional(),
      }),
    )
    .optional(),
  messages: z.array(inboundMessageSchema).optional(),
  statuses: z.array(messageStatusSchema).optional(),
});
export type MessagesChangeValue = z.infer<typeof messagesChangeValueSchema>;

/** Outer envelope. Change values are validated per field by the consumer. */
export const webhookPayloadSchema = z.looseObject({
  object: z.literal("whatsapp_business_account"),
  entry: z.array(
    z.looseObject({
      id: z.string(),
      changes: z.array(z.looseObject({ field: z.string(), value: z.unknown() })),
    }),
  ),
});
export type WebhookPayload = z.infer<typeof webhookPayloadSchema>;
