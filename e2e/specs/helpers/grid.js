// Grid typing for the wdio lane: enter values into the active table.
//
// The grid owns one input, positioned on the active cell (aria-label
// "<header>, row N"). Clicking it focuses the grid; typing then commits
// with ArrowDown, which also moves down a row (the QA-proved recipe).
// Typing goes nowhere until a cell is clicked first (Q-17/Q-68) — the
// click below is that step, not optional.
export async function typeColumnAValues(values) {
  // The grid input's label is "<header>, row N". The FIRST input[aria-label]
  // in the DOM is the sidebar "Search project" box (proved by Q-71: a plain
  // input[aria-label] query returns it), so match the grid input by its
  // ", row N" label suffix — typing into the search box would dirty nothing.
  const input = await $("//input[contains(@aria-label, ', row ')]");
  await input.waitForExist({ timeout: 15000 });
  await input.click();
  // The active cell starts in the Title column; move to the first data
  // column (A) before typing values.
  await browser.keys("ArrowRight");
  for (const value of values) {
    await browser.keys(String(value));
    await browser.keys("ArrowDown");
  }
}

// True when every needle appears in the page text (rendered cell values).
export async function pageTextContains(...needles) {
  const text = await browser.tauri.execute(() => document.body.innerText);
  return needles.every((n) => text.includes(n));
}
