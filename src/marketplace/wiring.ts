// Wiring: the one place the app builds the marketplace store, binding the
// real loader (M1's src/plugins/loader.ts) into the store's loader port.
// The loader is imported dynamically with a literal specifier so the
// bundler includes it once M1 lands; until then the import fails and the
// dialog reports plainly that the plugin loader is not available yet.
import { appVersion } from "../native";
import { MarketplaceStore } from "./store";
import type { PluginLoaderPort } from "./loader-port";
import sampleIndex from "./fixtures/sample-index.json";
import hello100Url from "./fixtures/hello-analysis-1.0.0.zip?url";
import hello110Url from "./fixtures/hello-analysis-1.1.0.zip?url";

/** Bundled fixture zips, by file name (offline sample only). */
const BUNDLED_ZIPS: Record<string, string> = {
  "hello-analysis-1.0.0.zip": hello100Url,
  "hello-analysis-1.1.0.zip": hello110Url,
};

let storePromise: Promise<MarketplaceStore> | null = null;

/** The app's marketplace store (singleton, created on first use). */
export function getMarketplaceStore(): Promise<MarketplaceStore> {
  if (!storePromise) {
    const created = createMarketplaceStore();
    storePromise = created;
    // Seq 518: a transient startup failure (a slow import, a native call
    // that missed) used to poison the cache forever — every later call
    // returned the same rejection and the dialog could never load. Drop
    // the cached promise on rejection, so the next call retries.
    created.catch(() => {
      if (storePromise === created) storePromise = null;
    });
  }
  return storePromise;
}

async function createMarketplaceStore(): Promise<MarketplaceStore> {
  const loaderModule = await import("../plugins/loader");
  const port: PluginLoaderPort = {
    loadPluginFromZip: loaderModule.loadPluginFromZip,
    installPlugin: loaderModule.installPlugin,
    requestEnable: loaderModule.requestEnable,
    confirmEnable: loaderModule.confirmEnable,
    disablePlugin: loaderModule.disablePlugin,
    rehydrateEnabledPlugin: loaderModule.rehydrateEnabledPlugin,
    pluginReviewLines: loaderModule.pluginReviewLines,
  };
  const store = new MarketplaceStore({
    loader: port,
    loadBundledZip: async (name) => {
      const url = BUNDLED_ZIPS[name];
      if (!url) throw new Error(`No bundled plugin named “${name}”.`);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Bundled plugin “${name}” could not be loaded (${res.status}).`);
      return new Uint8Array(await res.arrayBuffer());
    },
    appVersion: await appVersion(),
  });
  // The bundled sample index is loaded first, so the store works offline;
  // the dialog offers a refresh from the GitHub index.
  store.loadIndexFromText(JSON.stringify(sampleIndex));
  return store;
}
