import { useState, useCallback, useEffect, useRef } from "react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import {
  convertToExcalidrawElements,
  CaptureUpdateAction,
  newElementWith,
} from "@excalidraw/excalidraw";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import Canvas from "./components/Canvas";
import ChatPanel from "./components/chat/ChatPanel";
import { serializeCanvasState } from "./context/canvas-state";
import "./App.css";

// One agent instance per page load. The canvas state lives only in the
// browser, so persisting chat history across refreshes would leave a dead
// conversation referencing diagrams that no longer exist. Generated at the
// module level so React StrictMode's double mount doesn't change it.
const sessionId = crypto.randomUUID();

export default function App() {
  const [excalidrawAPI, setExcalidrawAPI] =
    useState<ExcalidrawImperativeAPI | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">("light");

  // Track which tool calls we've already applied so we don't double-apply
  // when messages re-render.
  const appliedToolCalls = useRef<Set<string>>(new Set());

  // Hold the latest excalidrawAPI in a ref so the onToolCall callback (which
  // is captured once at hook init time) can always read the live API instead
  // of a stale closure copy.
  const excalidrawAPIRef = useRef<ExcalidrawImperativeAPI | null>(null);
  useEffect(() => {
    excalidrawAPIRef.current = excalidrawAPI;
  }, [excalidrawAPI]);

  const handleApiReady = useCallback((api: ExcalidrawImperativeAPI) => {
    setExcalidrawAPI(api);
  }, []);

  const agent = useAgent({ agent: "design-agent", name: sessionId });

  // useAgentChat manages the chat protocol on top of the agent connection.
  // We register an onToolCall handler to fulfill the queryCanvas client tool:
  // when the agent calls queryCanvas, the worker streams the call here, we
  // read the live scene, and submit the result back. The agent loop resumes
  // automatically (autoContinueAfterToolResult is true by default).
  const { messages, sendMessage, status, error } = useAgentChat({
    agent,
    resume: false,
    autoContinueAfterToolResult: false,
    prepareSendMessagesRequest: ({ id, messages, trigger, api }) => {
      console.log("[chat] prepare", {
        id,
        trigger,
        messageCount: messages.length,
        api,
      });
      return {};
    },
    onToolCall: async ({ toolCall, addToolOutput }) => {
      console.log("[chat] toolCall", {
        toolName: toolCall.toolName,
        toolCallId: toolCall.toolCallId,
      });
      if (toolCall.toolName !== "queryCanvas") return;
      const api = excalidrawAPIRef.current;
      const elements = api?.getSceneElements() ?? [];
      addToolOutput({
        toolCallId: toolCall.toolCallId,
        output: { summary: serializeCanvasState(elements as unknown[]) },
        state: "output-available",
      });
    },
  });

  useEffect(() => {
    console.log("[chat] status", status);
  }, [status]);

  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!last) return;
    const parts = last.parts ?? [];
    const hasUndefined = parts.some((part) => part == null);
    console.log("[chat] lastMessage", {
      id: last.id,
      role: last.role,
      partTypes: parts.map((part) => (part && "type" in part ? part.type : undefined)),
      hasUndefined,
    });
  }, [messages]);

  useEffect(() => {
    if (!error) return;
    console.error("[chat] error", error);
  }, [error]);

  // Watch messages for the three mutating server tools and apply them to the
  // live canvas. The worker side just relays intent — actual scene mutation
  // is the browser's job, since only the browser owns the Excalidraw store.
  useEffect(() => {
    if (!excalidrawAPI) return;

    for (const message of messages) {
      if (message.role !== "assistant") continue;
      for (const part of message.parts ?? []) {
        const type = (part as { type?: string }).type;
        if (
          type !== "tool-addElements" &&
          type !== "tool-updateElements" &&
          type !== "tool-removeElements"
        ) {
          continue;
        }
        const p = part as {
          type: string;
          toolCallId: string;
          state: string;
          output: unknown;
        };
        if (p.state !== "output-available") continue;
        if (appliedToolCalls.current.has(p.toolCallId)) continue;
        appliedToolCalls.current.add(p.toolCallId);

        if (p.type === "tool-addElements") {
          const output = p.output as { elements?: unknown };
          const skeletons = output?.elements;
          if (Array.isArray(skeletons) && skeletons.length > 0) {
            const withLabels = skeletons.flatMap((el) => {
              if (!el || typeof el !== "object") return [el];
              const element = el as Record<string, unknown>;
              const type = element.type;
              const text = element.text;
              const id = element.id;
              if (type !== "text" && typeof text === "string" && typeof id === "string") {
                const padding = 12;
                const baseX = typeof element.x === "number" ? element.x : 0;
                const baseY = typeof element.y === "number" ? element.y : 0;
                const baseW = typeof element.width === "number" ? element.width : 160;
                const baseH = typeof element.height === "number" ? element.height : 80;
                const labelWidth = Math.max(baseW - padding * 2, 20);
                const labelHeight = Math.max(baseH - padding * 2, 20);
                const label = {
                  id: `${id}_label`,
                  type: "text",
                  x: baseX + padding,
                  y: baseY + padding,
                  width: labelWidth,
                  height: labelHeight,
                  text,
                  originalText: text,
                  fontSize: element.fontSize ?? 18,
                  fontFamily: element.fontFamily ?? 1,
                  textAlign: element.textAlign ?? "center",
                  verticalAlign: "middle",
                  autoResize: false,
                  lineHeight: 1.2,
                  containerId: id,
                  strokeColor: element.strokeColor ?? "#1e1e1e",
                  backgroundColor: "transparent",
                };
                const base = { ...element };
                delete base.text;
                return [base, label];
              }
              return [element];
            });
            // Convert skeletons into full Excalidraw elements. regenerateIds
            // false so the agent's chosen ids survive — otherwise later
            // updateElements/removeElements calls (which use those ids) miss.
            const newOnes = convertToExcalidrawElements(withLabels as never, {
              regenerateIds: false,
            });
            const current = excalidrawAPI.getSceneElements();
            const next = [...current, ...newOnes];
            excalidrawAPI.updateScene({
              elements: next,
              captureUpdate: CaptureUpdateAction.IMMEDIATELY,
            });
            excalidrawAPI.scrollToContent(next, { fitToContent: true });
          }
        } else if (p.type === "tool-updateElements") {
          const output = p.output as {
            updates?: { id: string; fields: Record<string, unknown> }[];
          };
          const updates = output?.updates;
          if (Array.isArray(updates) && updates.length > 0) {
            const byId = new Map(updates.map((u) => [u.id, u.fields]));
            const current = excalidrawAPI.getSceneElements();
            const next = current.map((el) => {
              const fields = byId.get(el.id);
              return fields ? newElementWith(el, fields as never) : el;
            });
            excalidrawAPI.updateScene({
              elements: next,
              captureUpdate: CaptureUpdateAction.IMMEDIATELY,
            });
          }
        } else if (p.type === "tool-removeElements") {
          const output = p.output as { ids?: string[] };
          const ids = new Set(output?.ids ?? []);
          if (ids.size > 0) {
            const current = excalidrawAPI.getSceneElements();
            const next = current.filter((el) => !ids.has(el.id));
            excalidrawAPI.updateScene({
              elements: next,
              captureUpdate: CaptureUpdateAction.IMMEDIATELY,
            });
          }
        }
      }
    }
  }, [messages, excalidrawAPI]);

  return (
    <div className={`app ${theme}`}>
      <div className="canvas-container">
        <Canvas onApiReady={handleApiReady} onThemeChange={setTheme} />
      </div>
      <ChatPanel
        messages={messages}
        sendMessage={sendMessage}
        status={status}
      />
      <a href="#viewer" className="viewer-launch" title="Open diagram viewer for human scoring">
        viewer
      </a>
    </div>
  );
}
