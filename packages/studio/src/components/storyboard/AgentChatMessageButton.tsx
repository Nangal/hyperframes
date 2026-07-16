import { useState } from "react";
import { Button } from "../ui/Button";

export const APPLY_STORYBOARD_FEEDBACK_MESSAGE = "Apply my saved storyboard feedback.";

export function AgentChatMessageButton({
  message,
  label = "Copy agent message",
}: {
  message: string;
  label?: string;
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  const copyMessage = async () => {
    try {
      await navigator.clipboard.writeText(message);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  return (
    <Button size="sm" variant="secondary" onClick={() => void copyMessage()}>
      {copyState === "copied"
        ? "Copied — paste in agent chat"
        : copyState === "failed"
          ? "Copy failed"
          : label}
    </Button>
  );
}
