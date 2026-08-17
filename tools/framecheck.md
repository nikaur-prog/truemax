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

## The before/after panel

`tools/cmpcheck.html` does the same job for the Reel Creator's comparison
block, which is HTML rather than canvas and therefore also invisible to `tsc`:

    npm run dev
    npx tsx -e "
    const { chromium } = require('playwright');
    (async () => {
      const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
      for (const [w, n] of [[430,'phone'],[900,'desktop']]) {
        const pg = await b.newPage({ viewport: { width: w, height: 900 } });
        await pg.goto('http://localhost:5173/tools/cmpcheck.html');
        await pg.waitForFunction('window.ready === true');
        await pg.screenshot({ path: 'cmp-' + n + '.png', fullPage: true });
      }
      await b.close();
    })();
    "

It feeds two fabricated reports through the same `regionMoves` the page uses,
so the join, the signs and the flat-move threshold are the real ones. Both
widths matter: the three before-export buttons wrap to one per row on a phone
and to two-then-one on a laptop, and neither layout is obvious from the CSS.
