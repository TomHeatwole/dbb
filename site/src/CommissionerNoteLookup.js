const COMMISSIONER_NOTE_URL =
  'https://docs.google.com/document/d/e/2PACX-1vSOWNbNZgPI_v-vm4KCfROqC8OXqJDsFneDPiKpgxDgzWMx4sHS2EUsn2Jyi0YQrmOPlzm2cFOA2cC0/pub';

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

  return contents.innerHTML.trim();
}


