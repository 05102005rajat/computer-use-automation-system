import { chromium, type Browser, type Page } from "playwright";

/** Launches a browser + page, optionally recording video when
 * RECORD_VIDEO_DIR is set in the environment -- used only to produce the
 * screen-recording evidence in /evidence; normal discover/replay runs never
 * set this and behave exactly as before (a bare `browser.newPage()`). */
export async function launchPage(): Promise<{ browser: Browser; page: Page }> {
  const browser = await chromium.launch({ headless: true });
  const videoDir = process.env.RECORD_VIDEO_DIR;
  if (!videoDir) {
    const page = await browser.newPage();
    return { browser, page };
  }
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    recordVideo: { dir: videoDir, size: { width: 1280, height: 800 } },
  });
  const page = await context.newPage();
  return { browser, page };
}
