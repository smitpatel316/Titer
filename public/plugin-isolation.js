// Plugin Isolation frame script — marketplace M5 (seq 437), R2 rework (seq 475).
//
// The external script for public/plugin-isolation.html. It holds the whole
// frame side of the isolation bridge, so the frame document needs no inline
// <script> (blocked by the release CSP — see the HTML file's comment).
//
// Protocol with the host (src/plugins/isolation-view.tsx):
//   frame -> host  { type: "titer-plugin-ready" }            on script load
//   host  -> frame { type: "titer-plugin-init", pluginId, source, commands }
//   frame -> host  { type: "titer-plugin-call", pluginId, command, args, id }
//   host  -> frame { type: "titer-plugin-result", pluginId, id, ok, result, error }
//
// The frame only ever talks to its parent (window.parent), and the host
// only ever talks to the frame element's contentWindow — the same trust
// model as the old inline bridge. The plugin's entry source is executed
// with new Function, in global scope: it can see window.titer (built from
// the init catalogue) but cannot reach this script's locals (pending,
// pluginId). An empty source (analysis-only plugins ship no entry file)
// is a no-op. A duplicate init is ignored — the host posts init both on
// the iframe's load event and in answer to titer-plugin-ready, so whichever
// lands first wins and the second is a no-op.
(function () {
  var pluginId = null;
  var initialized = false;
  var nextId = 0;
  var pending = {};

  function call(command, args) {
    return new Promise(function (resolve, reject) {
      var id = ++nextId;
      pending[id] = { resolve: resolve, reject: reject };
      window.parent.postMessage(
        { type: "titer-plugin-call", pluginId: pluginId, command: command, args: args || null, id: id },
        "*",
      );
    });
  }

  function init(data) {
    if (initialized) return;
    initialized = true;
    pluginId = data.pluginId;
    var titer = { call: call };
    var commands = Array.isArray(data.commands) ? data.commands : [];
    for (var i = 0; i < commands.length; i++) {
      (function (command) {
        // Method name is the command without its "titer." prefix.
        var name = command.slice("titer.".length);
        // Never let a catalogue entry become a prototype mutation.
        if (name === "__proto__" || name === "constructor" || name === "prototype") return;
        titer[name] = function (args) {
          return call(command, args);
        };
      })(commands[i]);
    }
    window.titer = titer;
    // Runs in global scope: the entry sees window.titer and nothing of
    // this closure. 'unsafe-eval' in the release CSP allows new Function.
    new Function(data.source || "")();
  }

  window.addEventListener("message", function (event) {
    if (event.source !== window.parent) return;
    var data = event.data || {};
    if (data.type === "titer-plugin-init") {
      init(data);
      return;
    }
    if (data.type !== "titer-plugin-result" || data.pluginId !== pluginId) return;
    var p = pending[data.id];
    if (!p) return;
    delete pending[data.id];
    if (data.ok) p.resolve(data.result);
    else p.reject(new Error(data.error || "Plugin call failed."));
  });

  window.parent.postMessage({ type: "titer-plugin-ready" }, "*");
})();
