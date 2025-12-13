const COMMISSIONER_NOTE_URL =
  'https://docs.google.com/document/d/e/2PACX-1vSOWNbNZgPI_v-vm4KCfROqC8OXqJDsFneDPiKpgxDgzWMx4sHS2EUsn2Jyi0YQrmOPlzm2cFOA2cC0/pub';

function scopeCssToCommissionerNote(rawCss) {
  if (!rawCss) {
    return '';
  }

  const rules = rawCss.split('}');
  const scopedRules = [];

  rules.forEach((rule) => {
    const parts = rule.split('{');

    if (parts.length !== 2) {
      return;
    }

    const selectorPart = parts[0].trim();
    const body = parts[1];

    if (!selectorPart || !body) {
      return;
    }

    // Handle comma-separated selectors and prefix each one with the
    // commissioner note container so we don't leak styles globally.
    const scopedSelectors = selectorPart
      .split(',')
      .map((selector) => selector.trim())
      .filter(Boolean)
      .map((selector) => `.commissioner-note-content ${selector}`);

    if (!scopedSelectors.length) {
      return;
    }

    scopedRules.push(`${scopedSelectors.join(', ')} {${body}}`);
  });

  return scopedRules.join('\n');
}

export async function fetchCommissionerNoteHtml() {
  const response = await fetch(COMMISSIONER_NOTE_URL);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const html = await response.text();

  // Parse the published Google Doc HTML and extract just the commissioner note content.
  // Based on the sample HTML in lol.txt, the main body lives inside:
  //   <div id="contents">
  //     ...
  //     <div class="c3 doc-content"> ... NOTE HTML ... </div>
  //   </div>
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  const contents = doc.querySelector('#contents .doc-content');

  if (!contents) {
    throw new Error('Commissioner note content not found in document.');
  }

  // Grab the inline CSS that Google Docs injects for this published view and
  // scope it to the commissioner note container so bold/typography/etc.
  // render correctly without overriding the rest of the app.
  const inlineStyle = doc.querySelector('#contents style[type="text/css"]');
  const rawCss = inlineStyle ? inlineStyle.textContent || '' : '';
  const scopedCss = scopeCssToCommissionerNote(rawCss);

  const cssBlock = scopedCss ? `<style>${scopedCss}</style>` : '';

  // Return the scoped CSS plus the original inner HTML from the doc content.
  return `${cssBlock}${contents.innerHTML.trim()}`;
}


