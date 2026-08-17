# Looking at the rundown's ending frames

The card, the curve and the search bar are canvas drawing with no headless
test harness — `tsc` and `vite build` both pass on a frame that draws its
caption straight through half the scorecard, which is exactly what shipped in
the first version of it.

This is the cheapest way to actually look:

    npm run dev
    npx tsx -e "
    const { chromium } = require('playwright');
    (async () => {
      const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
      const pg = await b.newPage({ viewport: { width: 760, height: 1300 } });
      pg.on('pageerror', e => console.log('PAGEERROR:', e.message));
      await pg.goto('http://localhost:5173/tools/framecheck.html');
      await pg.waitForFunction('window.ready === true');
      for (const [i, n] of [[0,'card'],[1,'curve'],[2,'search']]) {
        await pg.evaluate((x) => window.shot(x), i);
        await pg.locator('#c').screenshot({ path: 'frame-' + n + '.png' });
      }
      await b.close();
    })();
    "

The page builds a stand-in photograph and a ring of landmarks, so it needs no
scan and no model download. `window.shot(i)` draws beat `i` at 80% through its
own duration, which is past every entrance animation.

Two faults this found on its first run, both invisible to the type checker:
the caption was drawn over the region rows and hid two of the eight, and the
curve's marker was labelled "HIM" from a hardcoded string — so every woman
measured got a masculine pronoun on the one frame the whole video builds to.
