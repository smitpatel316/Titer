// The flow opt-in flag — off by default, per the v1 scope (module inside
// Titer, Settings toggle, default off). No sidebar/menu/graph-picker surface
// lists a flow graph while this is off; the Settings toggle lane wires
// `setFlowEnabled` to the switch. Flow code itself never reads this flag
// to decide what to compute — it only gates visibility.

let flowEnabled = false;

export function isFlowEnabled(): boolean {
  return flowEnabled;
}

export function setFlowEnabled(enabled: boolean): void {
  flowEnabled = enabled;
}
