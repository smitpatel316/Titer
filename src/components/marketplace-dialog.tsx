// Marketplace — the in-app plugin store (M2, seq 434): browse/search the
// index, install (download → hash → review → enable), update, pin,
// uninstall. The safety scorecard slot is rendered but filled by M3; until
// then it says "pending" and never invents a score. Plugin JS never runs
// here — install is disabled-by-default and the review step grants
// permissions. A capability boundary, not a sandbox — the copy says so.
import * as React from "react";
import { Dialog } from "../ui/dialog";
import { Button, Input, Switch } from "../ui/controls";
import { useProjectStore } from "../store/use-project-store";
import { getMarketplaceStore } from "../marketplace/wiring";
import type { MarketplaceStore } from "../marketplace/store";
import type { MarketplaceListing } from "../marketplace/index";
import type { PluginRecord } from "../marketplace/loader-port";
import { PENDING_SCORECARD } from "../marketplace/scorecard";

/** A labelled block of the dialog, full-width. */
function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-regular text-primary">{label}</p>
      {children}
    </div>
  );
}

interface ReviewState {
  record: PluginRecord;
  lines: string[];
}

export function MarketplaceDialog() {
  const { selector, openSelector, closeSelector } = useProjectStore();
  const open = selector?.kind === "marketplace";
  const [store, setStore] = React.useState<MarketplaceStore | null>(null);
  const [loadError, setLoadError] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [listings, setListings] = React.useState<MarketplaceListing[]>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [review, setReview] = React.useState<ReviewState | null>(null);
  const [grants, setGrants] = React.useState<Record<string, boolean>>({});
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [notice, setNotice] = React.useState("");

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError("");
    setNotice("");
    setLoadError("");
    getMarketplaceStore()
      .then((s) => {
        if (cancelled) return;
        setStore(s);
        setListings(s.search(""));
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const refreshListings = React.useCallback((s: MarketplaceStore, q: string) => {
    setListings(s.search(q));
  }, []);

  const onSearch = (q: string) => {
    setQuery(q);
    if (store) refreshListings(store, q);
  };

  const startReview = (s: MarketplaceStore, record: PluginRecord) => {
    setReview({ record, lines: s.reviewLines(record.manifest.id) });
    const initial: Record<string, boolean> = {};
    for (const p of record.manifest.permissions) {
      // Fresh install: nothing starts checked — the user grants each
      // permission explicitly. Re-enable: what was granted last time
      // starts checked. (R2-64: the old `|| grantedPermissions.length
      // === 0` pre-checked every permission, including "network", on
      // a fresh install and on re-enabling a zero-permission plugin.)
      initial[p] = record.grantedPermissions.includes(p);
    }
    setGrants(initial);
  };

  const install = async (listing: MarketplaceListing) => {
    if (!store || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const installed = await store.installListing(listing);
      if ("errors" in installed) {
        setError(installed.errors.join(" "));
      } else {
        refreshListings(store, query);
        startReview(store, installed.record);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const confirmReview = async () => {
    if (!store || !review || busy) return;
    setBusy(true);
    setError("");
    try {
      const id = review.record.manifest.id;
      const granted = review.record.manifest.permissions.filter((p) => grants[p]);
      store.requestEnable(id);
      store.confirmEnable(id, granted);
      setNotice(`“${review.record.manifest.name}” is enabled.`);
      setReview(null);
      refreshListings(store, query);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const enableInstalled = (id: string) => {
    if (!store) return;
    const record = store.getInstalled(id);
    if (record) startReview(store, record);
  };

  const disableInstalled = (id: string) => {
    if (!store) return;
    store.disable(id);
    setNotice("Plugin disabled.");
    refreshListings(store, query);
  };

  const uninstall = (id: string) => {
    if (!store) return;
    const removed = store.uninstall(id);
    if ("errors" in removed) setError(removed.errors.join(" "));
    else {
      setNotice("Plugin uninstalled.");
      refreshListings(store, query);
    }
  };

  const update = async (id: string) => {
    if (!store || busy) return;
    const offered = store.availableUpdate(id);
    if (!offered) return;
    setBusy(true);
    setError("");
    try {
      const updated = await store.updatePlugin(id, { toVersion: offered });
      if ("errors" in updated) setError(updated.errors.join(" "));
      else {
        setNotice(`Updated to ${offered}.`);
        refreshListings(store, query);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const togglePin = (listing: MarketplaceListing) => {
    if (!store) return;
    const record = store.getInstalled(listing.id);
    if (!record) return;
    if (store.pinnedVersion(listing.id)) store.clearPin(listing.id);
    else store.setPin(listing.id, record.manifest.version);
    refreshListings(store, query);
  };

  const refreshIndex = async () => {
    if (!store || busy) return;
    setBusy(true);
    setError("");
    try {
      const fetched = await store.fetchIndex();
      if ("errors" in fetched) setError(fetched.errors.join(" "));
      else {
        setNotice("Index refreshed.");
        refreshListings(store, query);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const selected = listings.find((l) => l.id === selectedId) ?? null;

  return (
    <Dialog
      open={open}
      onClose={closeSelector}
      title="Marketplace"
      description="Plugins extend Titer with new analyses. They install disabled, and nothing runs until you review and enable them — a capability boundary, not a sandbox."
      footer={<Button onClick={refreshIndex} disabled={busy || !store}>Refresh index</Button>}
    >
      {loadError ? (
        <p className="text-regular text-secondary">
          The marketplace could not start: {loadError} The plugin loader lands with M1 — browse works again once it does.
        </p>
      ) : review ? (
        <Section label={`Review “${review.record.manifest.name}”`}>
          {review.lines.map((line) => (
            <p key={line} className="text-regular text-secondary">{line}</p>
          ))}
          {review.record.manifest.permissions.map((p) => (
            <label key={p} className="flex items-center gap-2 text-regular text-primary">
              <input
                type="checkbox"
                checked={grants[p] ?? false}
                onChange={() => setGrants({ ...grants, [p]: !grants[p] })}
              />
              {p}
            </label>
          ))}
          <p className="text-small text-secondary">
            Only the permissions you check are granted. Unchecked permissions stay denied.
          </p>
          <div className="flex gap-2">
            <Button variant="accent" onClick={confirmReview} disabled={busy}>Enable</Button>
            <Button onClick={() => setReview(null)}>Not now</Button>
          </div>
        </Section>
      ) : (
        <>
          <Section label="Browse plugins">
            <Input
              value={query}
              onChange={(e) => onSearch(e.target.value)}
              placeholder="Search by name, author, or description…"
              aria-label="Search plugins"
            />
            <div className="flex max-h-64 flex-col gap-2 overflow-y-auto">
              {listings.length === 0 && <p className="text-regular text-secondary">No plugins match.</p>}
              {listings.map((listing) => {
                const installed = store?.getInstalled(listing.id);
                const offered = store?.availableUpdate(listing.id);
                const pinned = store?.pinnedVersion(listing.id);
                const scorecard = listing.scorecard ?? PENDING_SCORECARD;
                return (
                  <div key={listing.id} className="flex flex-col gap-1 rounded-md bg-control p-2">
                    <button type="button" className="text-left" onClick={() => setSelectedId(selectedId === listing.id ? null : listing.id)}>
                      <p className="text-regular text-primary">
                        {listing.name} <span className="text-secondary">{listing.version}</span>
                      </p>
                      <p className="text-small text-secondary">
                        by {listing.author}
                        {installed ? ` — installed ${installed.manifest.version} (${installed.status})` : ""}
                        {offered ? ` — update ${offered} available` : ""}
                        {pinned ? ` — pinned to ${pinned}` : ""}
                      </p>
                      <p className="text-small text-secondary">
                        Safety scorecard: {scorecard.status}
                        {scorecard.lines[0] ? ` — ${scorecard.lines[0]}` : ""}
                      </p>
                    </button>
                    <div className="flex flex-wrap items-center gap-2">
                      {!installed && (
                        <Button size="small" variant="accent" onClick={() => install(listing)} disabled={busy}>Install</Button>
                      )}
                      {installed && installed.status !== "enabled" && (
                        <Button size="small" variant="accent" onClick={() => enableInstalled(listing.id)} disabled={busy}>Enable</Button>
                      )}
                      {installed && installed.status === "enabled" && (
                        <>
                          {installed.manifest.entry !== undefined && (
                            <Button
                              size="small"
                              onClick={() => openSelector({ kind: "plugin-panel", pluginId: listing.id })}
                            >
                              Open
                            </Button>
                          )}
                          <Button size="small" onClick={() => disableInstalled(listing.id)} disabled={busy}>Disable</Button>
                        </>
                      )}
                      {installed && offered && (
                        <Button size="small" onClick={() => update(listing.id)} disabled={busy}>Update to {offered}</Button>
                      )}
                      {installed && (
                        <Button size="small" onClick={() => uninstall(listing.id)} disabled={busy}>Uninstall</Button>
                      )}
                      {installed && (
                        <label className="flex items-center gap-1.5 text-small text-secondary">
                          <Switch checked={pinned !== null} onChange={() => togglePin(listing)} />
                          Pin version
                        </label>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>
          {selected && (
            <Section label={selected.name}>
              {selected.description && <p className="text-regular text-secondary">{selected.description}</p>}
              <p className="text-small text-secondary">License: {selected.license} (recorded as listed, not judged).</p>
              {selected.readme && (
                <p className="text-small text-secondary">README: {selected.readme}</p>
              )}
              {selected.versions.map((entry) => (
                <p key={entry.version} className="text-small text-secondary">
                  {entry.version} — {new Date(entry.publishedAt).toLocaleDateString()}: {entry.changelog}
                </p>
              ))}
            </Section>
          )}
        </>
      )}
      {error && <p className="text-regular text-secondary">Error: {error}</p>}
      {notice && <p className="text-regular text-secondary">{notice}</p>}
    </Dialog>
  );
}
