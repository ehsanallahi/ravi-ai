"use client";

import { useActionState } from "react";
import { type ActionState, FormMessage, SubmitButton } from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateConversationAction } from "../actions";

export function ConversationControls({
  orgSlug,
  conversationId,
  status,
  assignedUserId,
  aiEnabled,
  members,
}: {
  orgSlug: string;
  conversationId: string;
  status: "OPEN" | "PENDING" | "RESOLVED";
  assignedUserId: string | null;
  aiEnabled: boolean;
  members: { id: string; name: string }[];
}) {
  const action = updateConversationAction.bind(null, orgSlug, conversationId);
  const [state, formAction] = useActionState<ActionState, FormData>(action, null);

  return (
    <div className="space-y-4">
      <form action={formAction} className="space-y-2">
        <input type="hidden" name="intent" value="status" />
        <Label htmlFor="status">Status</Label>
        <div className="flex gap-2">
          <Select name="status" defaultValue={status}>
            <SelectTrigger id="status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="OPEN">Open</SelectItem>
              <SelectItem value="PENDING">Needs a human</SelectItem>
              <SelectItem value="RESOLVED">Resolved</SelectItem>
            </SelectContent>
          </Select>
          <SubmitButton variant="outline">Update</SubmitButton>
        </div>
      </form>

      <form action={formAction} className="space-y-2">
        <input type="hidden" name="intent" value="assign" />
        <Label htmlFor="assignee">Assigned to</Label>
        <div className="flex gap-2">
          <Select name="assignee" defaultValue={assignedUserId ?? "none"}>
            <SelectTrigger id="assignee">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Unassigned</SelectItem>
              {members.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <SubmitButton variant="outline">Assign</SubmitButton>
        </div>
      </form>

      <form action={formAction} className="space-y-2">
        <input type="hidden" name="intent" value="disable-ai" />
        <p className="text-sm font-medium">AI for this conversation</p>
        <p className="text-sm text-muted-foreground">
          {aiEnabled
            ? "AI replies are disabled platform-wide in this phase. You can also turn AI off for this conversation permanently."
            : "AI is turned off for this conversation."}
        </p>
        {aiEnabled ? (
          <SubmitButton variant="outline" size="sm">
            Turn AI off for this conversation
          </SubmitButton>
        ) : null}
      </form>

      <FormMessage state={state} />
    </div>
  );
}
