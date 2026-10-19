import { ShieldAlert } from "lucide-react";
import { EmptyState } from "./empty-state";

export function AccessDenied({ what }: { what: string }) {
  return (
    <EmptyState
      icon={ShieldAlert}
      title="You don't have access to this page"
      description={`Your role doesn't include permission to ${what}. Ask an owner or admin if you need access.`}
    />
  );
}
