import { useEffect, useState } from 'react';

function scrollToHash(hash, instant = false) {
  if (!hash) return false;
  const id = decodeURIComponent(hash.replace(/^#/, ''));
  if (!id) return false;
  const scroll = () => {
    const target = document.getElementById(id);
    if (!target) return false;
    target.scrollIntoView({ behavior: instant ? 'auto' : 'smooth', block: 'start' });
    return true;
  };
  if (scroll()) return true;
  window.requestAnimationFrame(() => window.requestAnimationFrame(scroll));
  return true;
}

export function navigate(path, options = {}) {
  if (options.replace) window.history.replaceState(options.state ?? {}, '', path);
  else window.history.pushState(options.state ?? {}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
  if (!scrollToHash(window.location.hash, options.instant)) {
    window.scrollTo({ top: 0, behavior: options.instant ? 'auto' : 'smooth' });
  }
}

export function usePath() {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPopState);
    scrollToHash(window.location.hash, true);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
  return path;
}

export function Link({ to, children, className = '', onClick, ...props }) {
  return (
    <a
      href={to}
      className={className}
      onClick={(event) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || props.target === '_blank') return;
        event.preventDefault();
        onClick?.(event);
        navigate(to);
      }}
      {...props}
    >
      {children}
    </a>
  );
}
