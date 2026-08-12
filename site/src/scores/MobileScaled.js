import React, { useEffect, useRef, useState } from 'react';

/**
 * Visually scales its children down on mobile (via the provided class) while
 * reserving the correct layout height, since CSS transforms don't affect flow.
 */
function MobileScaled({ children, className = 'mobile-standings-scale-70' }) {
	const innerRef = useRef(null);
	const [heightPx, setHeightPx] = useState(null);

	useEffect(() => {
		const el = innerRef.current;
		if (!el) return;
		const compute = () => {
			const rect = el.getBoundingClientRect();
			setHeightPx(rect.height);
		};
		compute();
		const ro = new ResizeObserver(() => compute());
		ro.observe(el);
		window.addEventListener('resize', compute);
		return () => {
			try { ro.disconnect(); } catch (_) {}
			window.removeEventListener('resize', compute);
		};
	}, []);

	return (
		<div style={{ height: heightPx != null ? `${heightPx}px` : 'auto' }}>
			<div ref={innerRef} className={className}>
				{children}
			</div>
		</div>
	);
}

export default MobileScaled;
