/**
 * Synthetic webhook payloads shaped like Meta's documented examples. Used by tests only.
 * The IDs and numbers are obviously fake placeholders, not real customer data.
 */
export function textMessagePayload(overrides: { body?: string; messageId?: string } = {}) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "000000000000000",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "15550000000", phone_number_id: "100000000000001" },
              contacts: [{ profile: { name: "Test User" }, wa_id: "15550000001" }],
              messages: [
                {
                  from: "15550000001",
                  id: overrides.messageId ?? "wamid.TEST_INBOUND_1",
                  timestamp: "1760000000",
                  type: "text",
                  text: { body: overrides.body ?? "Hello, what are your opening hours?" },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

export function statusPayload(status = "delivered") {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "000000000000000",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "15550000000", phone_number_id: "100000000000001" },
              statuses: [
                {
                  id: "wamid.TEST_OUTBOUND_1",
                  status,
                  timestamp: "1760000100",
                  recipient_id: "15550000001",
                  ...(status === "failed"
                    ? { errors: [{ code: 131047, title: "Re-engagement message" }] }
                    : {}),
                },
              ],
            },
          },
        ],
      },
    ],
  };
}
