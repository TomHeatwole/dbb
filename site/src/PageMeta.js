import React from 'react';
import { Helmet } from './HelmetShim';

const DEFAULT_TITLE = 'The Hwang Dynasty';
const DEFAULT_DESCRIPTION = 'Because Sleeper is too lazy for BestBall in browser';
const DEFAULT_IMAGE = `${process.env.PUBLIC_URL || ''}/logo.jpg`;

function PageMeta({ title, description, image, url }) {
  const fullTitle = title || DEFAULT_TITLE;
  const desc = description || DEFAULT_DESCRIPTION;
  const img = image || DEFAULT_IMAGE;

  let href = url;
  if (!href) {
    try {
      href = window.location.href;
    } catch (e) {
      href = '';
    }
  }

  return (
    <Helmet>
      <title>{fullTitle}</title>
      <meta name="description" content={desc} />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={desc} />
      <meta property="og:image" content={img} />
      {href && <meta property="og:url" content={href} />}
      <meta property="og:type" content="website" />
    </Helmet>
  );
}

export default PageMeta;


