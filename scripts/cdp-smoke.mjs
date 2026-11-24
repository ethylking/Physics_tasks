// scripts/cdp-smoke.mjs — drive the running Tauri app's WebView2 via the Chrome
// DevTools Protocol: reload the page, collect console errors / exceptions, read
// the DOM state, and capture a true screenshot of the webview.
//
// Usage: node scripts/cdp-smoke.mjs [out.png]
// Requires the app to run with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222".

const PORT = 9222;
const outPath = process.argv[2] ?? `${process.env.TEMP ?? "."}/mechlab-cdp.png`;
// Optional: "x,y" screen coords to click on the canvas (selection test).
const clickAt = process.argv[3] ? process.argv[3].split(",").map(Number) : null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findPageTarget() {
  for (let i = 0; i < 30; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = list.find((t) => t.type === "page" && !t.url.startsWith("devtools://"));
      if (page) return page;
    } catch {
      /* retry */
    }
    await sleep(1000);
  }
  throw new Error("no CDP page target found — is the app running with --remote-debugging-port?");
}

async function main() {
  const target = await findPageTarget();
  console.log(`TARGET: ${target.title} | ${target.url}`);

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error("ws connect failed"));
  });

  let msgId = 0;
  const pending = new Map();
  const collected = { console: [], exceptions: [], logs: [] };
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) rej(new Error(msg.error.message));
      else res(msg.result);
    } else if (msg.method === "Runtime.consoleAPICalled") {
      collected.console.push(msg.params);
    } else if (msg.method === "Runtime.exceptionThrown") {
      collected.exceptions.push(msg.params);
    } else if (msg.method === "Log.entryAdded") {
      collected.logs.push(msg.params.entry);
    }
  };
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const id = ++msgId;
      pending.set(id, { res, rej });
      ws.send(JSON.stringify({ id, method, params }));
    });

  await send("Runtime.enable");
  await send("Log.enable");
  await send("Page.enable");

  // Reload so we capture the app from a clean slate.
  await send("Page.reload", { ignoreCache: true });
  await sleep(12000); // allow vite module graph + first render + session restore

  // DOM / app state
  const evalResult = await send("Runtime.evaluate", {
    expression: `JSON.stringify({
      title: document.title,
      hasCanvas: !!document.querySelector("canvas"),
      canvasCount: document.querySelectorAll("canvas").length,
      rootChildren: document.getElementById("root") ? document.getElementById("root").children.length : -1,
      bodyText: document.body.innerText.slice(0, 400),
      stylesheets: document.styleSheets.length,
    })`,
    returnByValue: true,
  });
  console.log("APP STATE:", evalResult.result.value);

  // Optional: click spots in the canvas to exercise the selection → inspector chain.
  if (clickAt && clickAt.length >= 2) {
    const points = process.argv[3].includes(";")
      ? process.argv[3].split(";").map((p) => p.split(",").map(Number))
      : [clickAt];
    for (const [x, y] of points) {
      await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
      await sleep(1200);
      const after = await send("Runtime.evaluate", {
        expression: `(() => {
          const name = document.querySelector('input[aria-label="Entity name"]');
          const text = document.body.innerText;
          const kind = text.includes("PER-FACE FRICTION") ? "box" : text.includes("STATIC") ? "static" : text.includes("MODEL") ? "rope" : "other";
          return { selected: name ? name.value : null, kind };
        })()`,
        returnByValue: true,
      });
      console.log(`CLICK (${x},${y}) ->`, JSON.stringify(after.result.value));
    }
  }

  // Real webview screenshot
  const shot = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
  const { writeFileSync } = await import("node:fs");
  writeFileSync(outPath, Buffer.from(shot.data, "base64"));
  console.log(`SCREENSHOT: ${outPath}`);

  // Optional: switch to 2D mode and capture the flat viewport too.
  if (process.argv[4] === "2d") {
    await send("Runtime.evaluate", {
      expression: `[...document.querySelectorAll('[role="tab"]')].find((b) => b.textContent.trim() === "2D")?.click()`,
    });
    await sleep(3000);
    const shot2 = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
    const out2 = outPath.replace(/\.png$/, "-2d.png");
    writeFileSync(out2, Buffer.from(shot2.data, "base64"));
    console.log(`SCREENSHOT 2D: ${out2}`);
  }

  // Optional: run the simulation — click Play, wait, inspect the energy HUD.
  if (process.argv[5] === "play") {
    const before = await send("Runtime.evaluate", {
      expression: `(() => {
        const btn = [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Play');
        return { found: !!btn, disabled: btn ? btn.disabled : null, label: btn ? btn.getAttribute('aria-label') : null };
      })()`,
      returnByValue: true,
    });
    console.log("PLAY BUTTON:", JSON.stringify(before.result.value));
    await send("Runtime.evaluate", {
      expression: `[...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Play')?.click()`,
    });
    await sleep(3500);
    const hud = await send("Runtime.evaluate", {
      expression: `(() => {
        const hud = [...document.querySelectorAll('div')].find((d) => d.textContent && d.textContent.includes('ΣE') && d.children.length < 8);
        return { hudText: hud ? hud.textContent.trim() : null };
      })()`,
      returnByValue: true,
    });
    console.log("SIM HUD:", JSON.stringify(hud.result.value));
    const simShot = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
    const out3 = outPath.replace(/\.png$/, "-sim.png");
    writeFileSync(out3, Buffer.from(simShot.data, "base64"));
    console.log(`SCREENSHOT SIM: ${out3}`);
    await send("Runtime.evaluate", {
      expression: `[...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Pause')?.click()`,
    });
  }

  // Console errors
  const errors = [
    ...collected.logs.filter((l) => l.level === "error").map((l) => `${l.text} [${l.url ?? "?"}]`),
    ...collected.exceptions.map((e) => (e.exceptionDetails?.exception?.description ?? e.exceptionDetails?.text ?? "exception")),
    ...collected.console
      .filter((c) => c.type === "error" || c.type === "assert")
      .map((c) => c.args.map((a) => a.value ?? a.description ?? "?").join(" ")),
  ];
  console.log(`CONSOLE ERRORS: ${errors.length}`);
  for (const e of errors.slice(0, 20)) console.log(`  - ${e}`);
  if (collected.logs.some((l) => l.level === "warning")) {
    console.log("WARNINGS (first 5):");
    collected.logs
      .filter((l) => l.level === "warning")
      .slice(0, 5)
      .forEach((l) => console.log(`  - ${l.text}`));
  }

  ws.close();
  process.exit(errors.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("CDP smoke failed:", e.message);
  process.exit(2);
});
