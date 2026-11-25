// Isolation webview UI — marketplace M5 (seq 437), R2 rework (seq 475).
//
// The frame that runs plugin JS, and the notice that says what it is.
// The frame is a sandboxed iframe (`sandbox="allow-scripts"`, no
// `allow-same-origin`): its document is the bundled static asset
// `public/plugin-isolation.html` (PLUGIN_WEBVIEW_FRAME_URL), whose
// external script builds the `titer.*` bridge and runs the plugin's
// entry source after the host posts it by `postMessage`
// (`buildPluginWebviewInit`). Every call the bridge posts is routed
// through `interceptPluginCall` — the Tauri Isolation pattern's
// inspection point — before it reaches the host, and the result (or the
// denial) is posted back.
//
// Session ownership (seq 475): the session is EXTERNALLY owned —
// launched by `launchPluginWebview`, torn down by `onPluginDisabled` /
// `onPluginUninstalled` / `teardownPluginWebview`. This component owns
// only the `message` listener while it is mounted: its effect cleanup
// drops the listener and NOTHING else, so React StrictMode's mount →
// cleanup → remount can never tear the session down before the frame
// finishes loading. Unmounting this view removes the iframe (ending
// that frame's execution) but leaves the session alive for its owner
// to tear down; re-mounting the same session re-attaches to it. The
// iframe is keyed on `session.pluginId`, so a session change remounts
// the frame instead of letting in-flight replies stamp the new id —
// and every reply is stamped with the plugin id captured when its call
// arrived, never with whatever session is current when the reply lands.
//
// The honest line, in the only place it is written
// (PLUGIN_SAFETY_NOTICE, isolation.ts): a capability boundary, not a
// sandbox. This view renders that shared string, never its own copy.

import * as React from "react";
import {
  PLUGIN_SAFETY_NOTICE,
  PLUGIN_WEBVIEW_FRAME_URL,
  PLUGIN_WEBVIEW_READY_TYPE,
  PLUGIN_WEBVIEW_SANDBOX,
  buildPluginWebviewInit,
  interceptPluginCall,
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

type PluginFrameMessage = {
  type?: string;
  pluginId?: string;
  command?: string;
  args?: unknown;
  id?: number;
};

/** The Isolation frame for one launched plugin session. `host` is the
 *  app's per-command wiring (see `createPluginHostRouter`); it runs
 *  only inside the guard, for calls the guard allows. The `session`
 *  is owned by whoever launched it — this component never tears it
 *  down (see the header note). */
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

  // Deliver the plugin id, entry source, and command catalogue to the
  // frame. The frame ignores a duplicate init, so posting on load AND
  // in answer to its ready message is safe — whichever lands first wins.
  const postInit = React.useCallback(() => {
    const frame = frameRef.current;
    const current = sessionRef.current;
    frame?.contentWindow?.postMessage(buildPluginWebviewInit(current.source, current.pluginId), "*");
  }, []);

  React.useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const frame = frameRef.current;
      // Only the frame itself may call in — a message from any other
      // window is not a plugin call.
      if (!frame || event.source !== frame.contentWindow) return;
      const data = event.data as PluginFrameMessage | null;
      if (!data || typeof data.type !== "string") return;
      // The frame's script has loaded and is waiting for its init.
      if (data.type === PLUGIN_WEBVIEW_READY_TYPE) {
        postInit();
        return;
      }
      if (data.type !== "titer-plugin-call" || data.pluginId !== sessionRef.current.pluginId) return;
      const { command, args, id } = data as PluginCallMessage;
      // Capture the plugin id with the call: an in-flight reply must
      // stamp the session the call came from, not whatever session is
      // current when the reply lands.
      const pluginId = sessionRef.current.pluginId;
      const reply = (ok: boolean, result?: unknown, error?: string) =>
        frame.contentWindow?.postMessage(
          { type: "titer-plugin-result", pluginId, id, ok, result, error },
          "*",
        );
      void interceptPluginCall(sessionRef.current, command, args, hostRef.current).then(
        (result) => reply(true, result),
        (err: unknown) => reply(false, undefined, err instanceof Error ? err.message : String(err)),
      );
    };
    window.addEventListener("message", onMessage);
    // Cleanup drops the listener ONLY. The session is externally owned:
    // tearing it down here would let StrictMode's mount → cleanup →
    // remount kill it before the frame loads (seq 475).
    return () => {
      window.removeEventListener("message", onMessage);
    };
  }, [session.pluginId, postInit]);

  return (
    <div className="flex flex-col gap-2">
      <PluginIsolationNotice pluginName={session.pluginName} />
      <iframe
        ref={frameRef}
        key={session.pluginId}
        title={`Plugin ${session.pluginName}`}
        sandbox={PLUGIN_WEBVIEW_SANDBOX}
        src={PLUGIN_WEBVIEW_FRAME_URL}
        onLoad={postInit}
        className="h-full w-full border-0"
      />
    </div>
  );
}
