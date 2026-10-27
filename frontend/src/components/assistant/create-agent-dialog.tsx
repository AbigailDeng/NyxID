import { useState } from "react";
import { Bot, Users } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type {
  AssistantAgent,
  AssistantGroup,
} from "@/schemas/assistant-nyxagent";
import { NewAgentDialog } from "./nyxbot-agent-forms";
import { NewGroupDialog } from "./nyxbot-group-forms";

/** One creation entry point; ownership is chosen in the existing forms. */
export function CreateAgentDialog({
  agents,
  onClose,
  onAgentCreated,
  onCrewCreated,
}: {
  readonly agents: readonly AssistantAgent[];
  readonly onClose: () => void;
  readonly onAgentCreated: (agent: {
    id: string;
    home_conversation_id: string;
  }) => void;
  readonly onCrewCreated: (group: AssistantGroup) => void;
}) {
  const [kind, setKind] = useState<"agent" | "crew">();
  if (kind === "agent")
    return <NewAgentDialog onClose={onClose} onCreated={onAgentCreated} />;
  if (kind === "crew")
    return (
      <NewGroupDialog
        agents={agents}
        onClose={onClose}
        onCreated={onCrewCreated}
      />
    );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="md:max-w-md">
        <DialogHeader className="pr-6">
          <DialogTitle>Create agent</DialogTitle>
          <DialogDescription>
            Choose an agent or a crew. Ownership can be personal or
            organization.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setKind("agent")}
            className="flex w-full items-center gap-3 rounded-lg border border-border p-3 text-left transition-colors hover:bg-overlay focus-visible:outline-2 focus-visible:outline-ring"
          >
            <Bot
              aria-hidden="true"
              className="h-5 w-5 shrink-0 text-text-tertiary"
            />
            <span>
              <span className="block text-13 font-medium">Agent</span>
              <span className="block text-11 text-muted-foreground">
                A specialist for you or your organization.
              </span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => setKind("crew")}
            className="flex w-full items-center gap-3 rounded-lg border border-border p-3 text-left transition-colors hover:bg-overlay focus-visible:outline-2 focus-visible:outline-ring"
          >
            <Users
              aria-hidden="true"
              className="h-5 w-5 shrink-0 text-text-tertiary"
            />
            <span>
              <span className="block text-13 font-medium">Crew</span>
              <span className="block text-11 text-muted-foreground">
                Several agents working together in a group chat.
              </span>
            </span>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
