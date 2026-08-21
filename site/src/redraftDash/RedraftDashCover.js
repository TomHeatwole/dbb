import React from 'react';

/**
 * Single-page printable title sheet — separate from the cheat-sheet Printable view
 * so it can be saved as its own PDF.
 */
function RedraftDashCover() {
  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="rddp-root rddp-root--cover">
      <div className="rddp-toolbar rddp-no-print">
        <button type="button" className="rddp-print-btn" onClick={handlePrint}>
          Print / Save PDF
        </button>
        <p className="rddp-toolbar-copy">
          One letter page. Turn off “Headers and footers” and turn on “Background graphics”
          so the logo colors print.
        </p>
      </div>

      <div className="rddp-sheet">
        <section className="rddp-page rddp-page--cover">
          <div className="rddp-cover">
            <img
              src={`${process.env.PUBLIC_URL || ''}/logo.png`}
              alt="The Hwang Dynasty"
              className="rddp-cover-logo"
            />
            <h1 className="rddp-cover-title">
              <span className="rddp-cover-title-brand">The HwangDynasty.Com</span>
              <span className="rddp-cover-title-guide">Redraft Guide</span>
            </h1>
          </div>
        </section>
      </div>
    </div>
  );
}

export default RedraftDashCover;
