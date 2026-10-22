(() => {
  'use strict';
  const boot = () => {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const body = document.body;
    const toggles = [...document.querySelectorAll('[data-motion-toggle]')];
    const reveals = [...document.querySelectorAll('.reveal')];
    let pausedByUser = false;
    let observer;
    const showAll = () => {
      reveals.forEach(node => { node.classList.remove('pending'); node.classList.add('is-visible'); });
      observer?.disconnect();
    };
    body.classList.add('motion-ready');
    if ('IntersectionObserver' in window && !reduced.matches) {
      observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          entry.target.classList.remove('pending');
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        });
      }, { threshold: 0.03 });
      reveals.forEach(node => {
        const rect = node.getBoundingClientRect();
        if (rect.top < innerHeight && rect.bottom > 0) node.classList.add('is-visible');
        else { node.classList.add('pending'); observer.observe(node); }
      });
    }
    const updateMotion = () => {
      const paused = pausedByUser || reduced.matches;
      body.classList.toggle('motion-paused', paused);
      toggles.forEach(button => {
        button.textContent = paused ? '恢复动效' : '暂停动效';
        button.setAttribute('aria-pressed', String(paused));
        button.setAttribute('aria-label', paused ? '恢复页面动效' : '暂停页面动效');
        button.disabled = reduced.matches;
        if (reduced.matches) { button.textContent = '动效已关闭'; button.setAttribute('aria-label','已遵循系统减少动态效果设置'); }
      });
      if (paused) showAll();
    };
    toggles.forEach(button => button.addEventListener('click', () => { pausedByUser = !pausedByUser; updateMotion(); }));
    reduced.addEventListener('change', updateMotion);
    document.addEventListener('visibilitychange', () => body.classList.toggle('page-hidden', document.hidden));
    updateMotion();
    const progress = document.getElementById('reading-progress');
    let scheduled = false;
    const updateProgress = () => {
      scheduled = false;
      const distance = document.documentElement.scrollHeight - innerHeight;
      if (progress) progress.style.transform = `scaleX(${distance > 0 ? Math.min(1, Math.max(0, scrollY / distance)) : 0})`;
    };
    const scheduleProgress = () => { if (!scheduled) { scheduled = true; requestAnimationFrame(updateProgress); } };
    addEventListener('scroll', scheduleProgress, { passive:true });
    addEventListener('resize', scheduleProgress, { passive:true });
    addEventListener('beforeprint', showAll);
    addEventListener('hashchange', showAll);
    updateProgress();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
  else boot();
})();
