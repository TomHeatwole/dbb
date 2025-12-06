import { useEffect } from 'react';

const DEFAULT_TITLE = 'The Hwang Dynasty';
const DEFAULT_DESCRIPTION = 'Because Sleeper is too lazy for BestBall in browser';
const DEFAULT_IMAGE = `${process.env.PUBLIC_URL || ''}/logo.png`;

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

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    // Update document title
    document.title = fullTitle;

    // Helper to upsert a <meta> tag in <head>
    function upsertMeta(selector, attributes) {
      if (!selector || !attributes) {
        return;
      }
      let el = document.head.querySelector(selector);
      if (!el) {
        el = document.createElement('meta');
        document.head.appendChild(el);
      }
      Object.keys(attributes).forEach((key) => {
        const value = attributes[key];
        if (value != null) {
          el.setAttribute(key, value);
        }
      });
    }

    upsertMeta('meta[name="description"]', {
      name: 'description',
      content: desc,
    });

    upsertMeta('meta[property="og:title"]', {
      property: 'og:title',
      content: fullTitle,
    });

    upsertMeta('meta[property="og:description"]', {
      property: 'og:description',
      content: desc,
    });

    upsertMeta('meta[property="og:image"]', {
      property: 'og:image',
      content: img,
    });

    if (href) {
      upsertMeta('meta[property="og:url"]', {
        property: 'og:url',
        content: href,
      });
    }

    upsertMeta('meta[property="og:type"]', {
      property: 'og:type',
      content: 'website',
    });
  }, [fullTitle, desc, img, href]);

  return null;
}

export default PageMeta;


