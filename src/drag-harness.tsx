// TEMPORARY drag-path harness (seq 394 diagnosis only — DELETE before commit).
// Mounts the real FigureView with the proof-307 fixture and exposes a probe
// so a CDP driver can dispatch real pointer events and read the drag state.
import * as React from "react";
import { createRoot } from "react-dom/client";
import { ProjectProvider, useProjectStore } from "./store/use-project-store";
import { LayoutProvider } from "./store/use-layout";
import { FigureView } from "./views/figures/figure-view";
import { parseProjectText } from "./lib/project-file";
import { getFigureDrag, getFigureDropHandler } from "./lib/figure-drag";
import "./styles.css";

// In browser mode confirmReplace uses window.confirm — auto-accept and record.
const confirmCalls: string[] = [];
window.confirm = (msg?: string) => {
  confirmCalls.push(String(msg ?? ""));
  return true;
};

function Harness() {
  const { nodes, loadProject } = useProjectStore();
  const [ready, setReady] = React.useState(false);
  const [error, setError] = React.useState("");
  const nodesRef = React.useRef(nodes);
  nodesRef.current = nodes;

  React.useEffect(() => {
    void fetch("/proof-307.hlx")
      .then((r) => r.text())
      .then((text) => {
        const parsed = parseProjectText(text);
        if ("error" in parsed) {
          setError(parsed.error);
          return;
        }
        const fig = Object.values(parsed.project.nodes).find((n) => n.type === "figure");
        loadProject({ ...parsed.project, filePath: null, edited: true, activeNodeId: fig?.id ?? null });
        setReady(true);
      })
      .catch((e: unknown) => setError(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    (window as unknown as Record<string, unknown>).__dragProbe = {
      getFigureDrag,
      hasDropHandler: () => getFigureDropHandler() !== null,
      confirmCalls,
      panels: () => {
        const fig = Object.values(nodesRef.current).find((n) => n.type === "figure");
        return fig?.panels?.map((p) => ({ graphId: p.graphId, row: p.row, col: p.col, label: p.label })) ?? null;
      },
      elementAt: (x: number, y: number) => {
        const el = document.elementFromPoint(x, y) as HTMLElement | null;
        if (!el) return null;
        const t = el.closest("[data-figure-drop]") as HTMLElement | null;
        return {
          tag: el.tagName,
          cls: String(el.getAttribute("class") ?? "").slice(0, 100),
          drop: t ? { row: t.dataset.dropRow, col: t.dataset.dropCol, fig: t.dataset.figureId } : null,
        };
      },
      panelRects: () =>
        [...document.querySelectorAll("[data-figure-drop]")].map((el) => {
          const r = (el as HTMLElement).getBoundingClientRect();
          const h = el as HTMLElement;
          return {
            row: h.dataset.dropRow,
            col: h.dataset.dropCol,
            x: Math.round(r.x),
            y: Math.round(r.y),
            w: Math.round(r.width),
            h: Math.round(r.height),
            hovered: h.className.includes("ring-accent"),
          };
        }),
    };
    (window as unknown as Record<string, unknown>).__dragReady = ready;
  }, [ready]);

  const fig = Object.values(nodes).find((n) => n.type === "figure");
  if (error) return <div data-testid="harness-error">{error}</div>;
  if (!ready || !fig) return <div>loading…</div>;
  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      <FigureView node={fig} />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <ProjectProvider>
    <LayoutProvider>
      <Harness />
    </LayoutProvider>
  </ProjectProvider>,
);
