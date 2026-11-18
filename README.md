# Titer

**Scientific data analysis, simplified.**

Organize, analyze and visualize scientific data, from raw numbers to publication-ready
graphs. Titer is a free, open-source and private alternative to GraphPad Prism for macOS.

Three engines do the work: a fast data grid built for Titer, **R**, the reference for
statistics (through [webR](https://github.com/r-wasm/webr), R compiled to WebAssembly), and
**[Plotly](https://plotly.com/javascript/)** for the graphs. Everything runs on your Mac.

![Titer: a table, its analyses and a graph](docs/screenshot.png)

## About this fork

This is a modified fork of mickaphd/Helix,
the original Helix by mickaphd (© 2026 mickaphd). On top of upstream it adds
Prism-file import, a wider analysis catalogue, multi-panel figures, and bug
fixes — see the [release notes](https://github.com/smitpatel316/Titer/releases)
and the git history for what changed and when. Like upstream, it is licensed
under the [GNU General Public License](LICENSE), version 3 or later.

## Download

Get the latest version from the [Releases page](https://github.com/smitpatel316/Titer/releases):

- `Titer_…_aarch64.dmg` for Macs with Apple Silicon (M1 and later)
- `Titer_…_x64.dmg` for Macs with an Intel processor

Each release is cut from a tagged commit — the release notes name the exact
commit the DMGs were built from, so the source for any download is retrievable
from this repo. Every DMG also includes a copy of the GNU GPL (`LICENSE`) and
the third-party notices (`THIRD-PARTY-NOTICES.md`).

Requires macOS 13.3 (Ventura) or later. Open the DMG and drag **Titer** into the
**Applications** folder. Titer is signed ad hoc (not notarized by Apple), so macOS may ask you to confirm the first time you open it.

When a new version is out, Titer tells you (Titer › Check for Updates…) and installs it
for you: it relaunches with your projects.

## What Titer does

Each **table** holds its own **analyses** and **graphs**. Change a value, and every result
and figure that uses it updates at once.

### Tables

Six table types. Each guides how data are entered, and offers every analysis and graph
its data allow:

- **Column:** groups side by side (control, doses, treatments)
- **XY:** a response against a dose, a time or a concentration
- **Grouped:** groups across rows (time points, genes), with replicates
- **Multiple Variables:** one row per subject, one column per variable
- **Contingency:** counts of outcomes
- **Survival:** one subject per row, its time, and whether the event happened

And a spreadsheet that feels like one:

- Copy and paste with Excel or Numbers, fill down, find, resize columns, keep the titles
  visible as you scroll
- Name each row (a mouse, a patient, a gene): the names follow into results and graphs
- Exclude a value from the analyses without deleting it

### Analyses

- **Guided:** an assistant asks which data sets to analyze, whether they are
  paired and whether they follow a normal distribution (or checks it for you with
  Shapiro-Wilk), then runs the right test
- **Every number comes from R**, the reference for statistics — except the
  log-rank test, which is computed directly in TypeScript and checked against
  independently computed reference values
- **Two groups:** unpaired, Welch, paired, ratio and lognormal t tests, with Cohen's d and
  Hedges' g; Mann-Whitney, Wilcoxon; one group against a value, its mean or geometric mean
- **More groups:** one-way ANOVA (or Welch's, without equal SDs; of geometric means: lognormal),
  repeated-measures ANOVA with the Geisser-Greenhouse correction, or a mixed-effects model
  (REML, Kenward-Roger) when subjects miss values, Kruskal-Wallis, Friedman; then every pair (Tukey,
  Games-Howell, Dunnett's T3, Dunn), the pairs chosen (Bonferroni, Šidák, Holm-Šidák,
  Fisher's LSD) or each group against a control (Dunnett)
- **Grouped data:** two-way ANOVA (ordinary, with Tukey, Dunnett, Games-Howell or corrected
  pairs; repeated measures with the Geisser-Greenhouse correction; Scheirer-Ray-Hare) and
  multiple t tests with Holm or FDR correction
- **Curves:** dose-response (4PL, 3PL, 5PL) with the EC50 or IC50 (and the EC10, EC20, EC80 or
  EC90) and every parameter's 95% CI, several data sets at once or two curves compared,
  outliers left out by ROUT; standard curves read for your unknowns (ELISA); exponential,
  logistic and Gompertz growth, one- and two-phase decay (doubling time, half-lives),
  Michaelis-Menten, lines and polynomials; replicates taken as they are
- **Before you test:** a normality and lognormality test that says in plain words which
  tests suit your data; outliers found by ROUT or Grubbs
- **Counts:** Fisher's exact and chi-square tests (Yates' or not), the chi-square test for
  trend, with the odds ratio, the relative risk, the difference of risks and the number
  needed to treat, sensitivity, specificity and predictive values, Phi and Cramér's V
- **Checking assumptions:** QQ plots of your data sets, residual plots of a regression (against
  X or as a QQ plot)
- **Two variables:** a regression line through any two variables of a table, with its
  equation, r (with its 95% CI), R² and P; a logistic regression for a yes/no outcome, with its odds ratio
- **Survival:** Kaplan-Meier with median survival, log-rank, trend and Gehan-Breslow-Wilcoxon
  tests, hazard ratios, and Cox regression
- **Transform or normalize:** logarithms, normalized 0 to 100 %, percent of a control,
  z-scores, as a new table that follows its own and can be analyzed and graphed
- **Clear results:** the exact test that ran and whether it is significant, the data it
  compared, what it means in plain words, its conditions checked (normality, equal SDs…),
  every statistic, multiple comparisons and descriptive statistics, ready to copy
- Analyses follow the data: rename a column and they follow it, edit a value and they run again

### Graphs

- **Ready for a paper by default**
- **Statistics on the graph:** significance stars, P values or group letters from your analyses, between
  groups or, on grouped bars, points and boxes, between a two-way ANOVA's cells; regression
  lines with their confidence or prediction band and equation, any fitted curve with its best-fit values,
  Kaplan-Meier curves with their confidence band and the number at risk
- **Notes and tags on everything:** a note on each table, analysis and graph, and the Finder's
  color tags to find them in a busy project, saved in the project
- **One table, many figures:** a graph shows all of a table's data sets or only those you
  tick, each in the same color everywhere; its stars come from an analysis of them
- **Every kind of figure:** dot plots, bars, box and violin, histograms, lines, heatmaps, volcano plots
  (from your own results, or computed by Titer from replicates), survival curves
- **Colors that work:** 15 palettes from the scientific literature (Okabe-Ito, Paul Tol,
  Viridis, Batlow…), colorblind-friendly ones first, each reversible; or make your own,
  kept on your Mac
- **Style every series:** color, point shape, dashed lines, fill patterns; and the whole graph:
  fill opacity, outlines, error bars (thickness, caps, color, direction)
- **Style single points:** click or drag over them to change their color, shape or size, or
  show their name; on a volcano plot, find genes by name
- **Match:** give a graph the look of another one, choosing what it takes
- **Lay it out:** move the legend and notes, resize by dragging an axis or typing a size, set
  each axis's range and step, draw reference lines (a control's level, a threshold) with
  their text, white or transparent background
- **Export** as PNG or JPG at 150, 300 or 600 DPI, at their true printed size, or as SVG; or
  copy and paste into Keynote, PowerPoint or Word

### Projects

- A native Mac app: real menus and shortcuts, light and dark mode, your accent color,
  resizable sidebar and inspector
- Undo and redo everything, across the whole project
- Several projects at once, each in its own window; the ones still open when you quit come
  back at the next launch
- Open projects: a Titer file (`.hlx`) is plain JSON, described in
  [FILE-FORMAT.md](FILE-FORMAT.md), so your data are never locked in
- Open methods: how each analysis is computed and checked is in [METHODS.md](METHODS.md)
- Import a GraphPad Prism file (`.pzfx`): File › Import Prism File… brings in its
  data tables (analyses and graphs aren't stored in the file, so they don't come
  over). The newer `.prism` format isn't supported yet

**Try it:** Help › Sample Project opens a made-up study told as a paper's figures, from cells
to mice to patients, with every kind of table ([also here](samples/Titer%20Sample.hlx)).

## Use Titer with your AI assistant (MCP)

MCP lets an AI assistant you already use — Claude Code, Claude Desktop, or OpenCode — drive
Titer directly: open projects, run analyses, build graphs, export files. The assistant talks
to a small server that runs only on your Mac.

1. **Turn it on.** In Titer, go to Settings → AI Connections and turn on "Allow AI apps to
   connect". The server is off until you do this. Leave Titer running while you use your
   assistant — if you quit Titer, the tools stop answering until you reopen it.

2. **Connect your assistant.**

   **Claude Code** — in Titer's AI Connections dialog, copy the setup command and run it once
   in a terminal. It looks like this — but copy yours from the dialog, which fills in your
   real address and token; don't type this line by hand:

   ```sh
   claude mcp add --transport http --scope user titer http://127.0.0.1:18741/mcp --header "Authorization: Bearer <your-token>"
   ```

   New Claude Code sessions will see the Titer tools — check with `/mcp`.

   **Claude Desktop** — add the bridge that ships inside the Titer app to
   `~/Library/Application Support/Claude/claude_desktop_config.json`, under `mcpServers`:

   ```json
   {
     "mcpServers": {
       "titer": {
         "command": "/Applications/Titer.app/Contents/MacOS/titer-stdio-bridge",
         "args": [],
         "env": {}
       }
     }
   }
   ```

   Then fully quit Claude Desktop and reopen it. (A one-click `.mcpb` install is coming in a
   later release.)

   **OpenCode** — add this to `~/.config/opencode/opencode.json`:

   ```json
   {
     "$schema": "https://opencode.ai/config.json",
     "mcp": {
       "titer": {
         "type": "local",
         "command": ["/Applications/Titer.app/Contents/MacOS/titer-stdio-bridge"],
         "enabled": true
       }
     }
   }
   ```

   Check it connected with `/mcps` or `opencode mcp list`.

3. **Ask it things**, for example:

   - "Open my dose-response project and run a one-way ANOVA on the XY table."
   - "Build a scatter graph from that table and export it as a 300 DPI PNG."
   - "What analyses have I run on this table, and which are significant?"
   - "Is my Box account connected?"

**Good to know:** the server only listens on your own Mac (`127.0.0.1`) and never sends your
data anywhere. It uses a private token — keep it private, and if you regenerate it in Settings,
reconnect your assistant. It offers 51 tools: 14 only read, 37 can change your project (run an
analysis, build a graph, export, save, delete) — your AI tool's own approval settings decide
when it asks first. Box cloud tools need a Box account connected in Settings → Connected
Storage; without one they tell you to connect first.

## Privacy

Titer works entirely on your Mac: your data never leave it, and there is no
telemetry in the app. Its only connection is a daily check on GitHub for a newer version.

## Building from source

You need [Node.js](https://nodejs.org) 24 or later, [Rust](https://rustup.rs), and the
Xcode Command Line Tools (`xcode-select --install`).

```bash
npm ci            # install
npm run dev       # run Titer with live reload
npm test          # check every analysis and graph against their reference results
npm run build     # build the two DMGs
```

Building the two DMGs needs both Mac targets for Rust, once:
`rustup target add aarch64-apple-darwin x86_64-apple-darwin`.

## Clean-room note

Titer's GraphPad Prism file support (`.pzfx` import and `.prism` import) was
built clean-room: by studying the files Prism writes, together with public
documentation and the open-source readers for those formats (R's `pzfx`
package and Python's `pypzfx`), and implementing the importers independently
from those observations. No part of it involved decompiling, disassembling,
or otherwise reverse-engineering Prism's program, and no cracked or pirated
Prism source was used. Where the internal structure of a file was unclear,
it was probed by changing one thing at a time in a Prism-written file and
observing what changed inside the file — never by touching the program. The
importers are independent implementations and contain no Prism code.

## License

Titer is free software: you can redistribute it and modify it under the terms of the
[GNU General Public License](LICENSE), version 3 or later. It comes with no warranty.

© 2026 mickaphd

Titer is free and always will be. If it saves you time, you can [buy the developer a coffee](https://www.buymeacoffee.com/smitpatel316).

## Acknowledgments

Titer stands on the shoulders of [R](https://www.r-project.org) and
[webR](https://github.com/r-wasm/webr), which bring R to the app, R's
[survival](https://github.com/therneau/survival) package for survival analysis,
[Plotly.js](https://plotly.com/javascript/) for the graphs, [Phosphor Icons](https://phosphoricons.com)
for its icons, and [Tauri](https://tauri.app) and [React](https://react.dev) for the app itself. See
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) for all of them and their licenses.

GraphPad Prism is a trademark of GraphPad Software, LLC. Titer is an independent project,
not affiliated with or endorsed by GraphPad Software.
