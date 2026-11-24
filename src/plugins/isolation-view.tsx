// Isolation webview UI — marketplace M5 (seq 437).
//
// The frame that runs plugin JS, and the notice that says what it is.
// The frame is a sandboxed iframe (`sandbox="allow-scripts"`, no
// `allow-same-origin`): the plugin's entry source plus the `titer.*`
// bridge (see `buildPluginWebviewSrcDoc` in isolation.ts). Every call
// the bridge posts is routed through `interceptPluginCall` — the
// Tauri Isolation pattern's inspection point — before it reaches the
// host, and the result (or the denial) is posted back. The frame is
// torn down when this component unmounts, so unmounting a plugin's
// view ends its execution.
//
// The honest line, in the only place it is written
// (PLUGIN_SAFETY_NOTICE, isolation.ts): a capability boundary, not a
// sandbox. This view renders that shared string, never its own copy.

import * as React from "react";
import {
  PLUGIN_SAFETY_NOTICE,
  PLUGIN_WEBVIEW_SANDBOX,
  buildPluginWebviewSrcDoc,
  interceptPluginCall,
  teardownPluginWebview,
  type PluginHostHandler,
  type PluginWebviewSession,
} from "./isolation";

/** The safety notice, for any surface that describes plugin safety —
 *  the enable review, settings, a listing. One shared string, so the
 *  honest line can never drift between surfaces. */
export function PluginIsolationNotice({ pluginName }: { pluginName?: string }) {
  return (
    <p className="text-xs text-secondary">
      {pluginName ? `Plugin “${pluginName}”: ` : ""}
      {PLUGIN_SAFETY_NOTICE}
    </p>
  );
}

type PluginCallMessage = {
  type: "titer-plugin-call";
  pluginId: string;
  command: string;
  args: unknown;
  id: number;
};

/** The Isolation frame for one launched plugin session. `host` is the
 *  app's per-command wiring (see `createPluginHostRouter`); it runs
 *  only inside the guard, for calls the guard allows. */
export function PluginIsolationWebview({
  session,
  host,
}: {
  session: PluginWebviewSession;
  host: PluginHostHandler;
}) {
  const frameRef = React.useRef<HTMLIFrameElement | null>(null);
  const sessionRef = React.useRef(session);
  sessionRef.current = session;
  const hostRef = React.useRef(host);
  hostRef.current = host;

  React.useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const frame = frameRef.current;
      // Only the frame itself may call in — a message from any other
      // window is not a plugin call.
      if (!frame || event.source !== frame.contentWindow) return;
      const data = event.data as Partial<PluginCallMessage> | null;
      if (!data || data.type !== "titer-plugin-call" || data.pluginId !== sessionRef.current.pluginId) return;
      const { command, args, id } = data as PluginCallMessage;
      const reply = (ok: boolean, result?: unknown, error?: string) =>
        frame.contentWindow?.postMessage(
          { type: "titer-plugin-result", pluginId: sessionRef.current.pluginId, id, ok, result, error },
          "*",
        );
      void interceptPluginCall(sessionRef.current, command, args, hostRef.current).then(
        (result) => reply(true, result),
        (err: unknown) => reply(false, undefined, err instanceof Error ? err.message : String(err)),
      );
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      teardownPluginWebview(sessionRef.current.pluginId);
    };
  }, []);

  return (
    <div className="flex flex-col gap-2">
      <PluginIsolationNotice pluginName={session.pluginName} />
      <iframe
        ref={frameRef}
        title={`Plugin ${session.pluginName}`}
        sandbox={PLUGIN_WEBVIEW_SANDBOX}
        srcDoc={buildPluginWebviewSrcDoc(session.source, session.pluginId)}
        className="h-full w-full border-0"
      />
    </div>
  );
}
