import { Card, Label } from "../../components/workspace/WorkspaceUI";
import { MachineDesktopEntries } from "./MachineDesktopEntries";
import type { MachineDesktopParams } from "./desktop/desktopRoutes";
import type { AssistantMessage } from "../assistant/assistantTypes";

type Receipt = NonNullable<AssistantMessage["activities"][number]["machine"]>;
export function MachineToolCard({
  receipt,
  conversationId,
  onOpenDesktop,
}: {
  receipt: Receipt;
  conversationId: string;
  onOpenDesktop: (params: MachineDesktopParams) => void;
}) {
  return (
    <Card>
      <Label>
        {receipt.action.replaceAll(".", " · ")} · {receipt.status}
      </Label>
      <Label muted>
        {receipt.machine_name || `Machine ${receipt.node_id.slice(0, 8)}`} ·{" "}
        {receipt.context_mode === "separated"
          ? "Separate workspace and browser"
          : "Shared workspace and browser"}
      </Label>
      {receipt.error_code != null && (
        <Label>Machine error {receipt.error_code}</Label>
      )}
      <MachineDesktopEntries
        nodeId={receipt.node_id}
        conversationId={conversationId}
        onOpen={onOpenDesktop}
      />
    </Card>
  );
}
