(() => {
  'use strict';
  const cards = [...document.querySelectorAll('.card')];
  const filters = [...document.querySelectorAll('[data-filter]')];
  const count = document.querySelector('#project-count');
  const list = document.querySelector('.list');
  const motionButton = document.querySelector('#motion-toggle');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const mobileLayout = window.matchMedia('(max-width: 760px)');
  const videos = [...document.querySelectorAll('video')];
  const visibleVideos = new Set();
  let paused = reducedMotion.matches;

  const syncVideos = () => {
    for (const video of videos) {
      const active = !paused && !document.hidden && !mobileLayout.matches &&
        !video.closest('.card').hidden && visibleVideos.has(video);
      if (active) video.play().catch(() => {});
      else video.pause();
    }
  };
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting) visibleVideos.add(entry.target);
      else visibleVideos.delete(entry.target);
    }
    syncVideos();
  }, { root: list, threshold: 0.05 });
  videos.forEach(video => { video.muted = true; observer.observe(video); });

  const setFilter = value => {
    filters.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.filter === value)));
    let total = 0;
    cards.forEach(card => {
      card.hidden = value !== 'all' && !card.dataset.tags.split(' ').includes(value);
      if (!card.hidden) total += 1;
    });
    count.value = String(total).padStart(2, '0');
    count.setAttribute('aria-label', `当前展示 ${total} 个项目`);
    document.querySelector('.empty-state').hidden = total > 0;
    list.scrollTop = 0;
    syncVideos();
  };
  filters.forEach(button => button.addEventListener('click', () => setFilter(button.dataset.filter)));
  document.querySelector('[data-reset-filter]').addEventListener('click', () => setFilter('all'));

  const syncMotion = () => {
    motionButton.setAttribute('aria-pressed', String(paused));
    motionButton.textContent = paused ? '恢复动效' : '暂停动效';
    motionButton.setAttribute('aria-label', paused ? '恢复粒子与视频动效' : '暂停粒子与视频动效');
    window.dispatchEvent(new CustomEvent('axon:motion', { detail: { paused } }));
    syncVideos();
  };
  motionButton.addEventListener('click', () => { paused = !paused; syncMotion(); });
  reducedMotion.addEventListener('change', event => { paused = event.matches; syncMotion(); });
  mobileLayout.addEventListener('change', syncVideos);
  document.addEventListener('visibilitychange', syncVideos);
  syncMotion();

  const detailDialog = document.querySelector('#project-dialog');
  const projectsDialog = document.querySelector('#projects-dialog');
  document.querySelectorAll('[data-project]').forEach(button => {
    button.addEventListener('click', () => {
      const template = document.querySelector(`#project-${button.dataset.project}`);
      if (!template) return;
      document.querySelector('#detail-content').replaceChildren(template.content.cloneNode(true));
      detailDialog.showModal();
    });
  });
  document.querySelector('[data-open-projects]').addEventListener('click', () => projectsDialog.showModal());
  document.querySelectorAll('[data-close-dialog]').forEach(button => {
    button.addEventListener('click', () => button.closest('dialog').close());
  });
  const handleHash = () => {
    if (window.location.hash === '#projects') {
      if (mobileLayout.matches) {
        if (!projectsDialog.open) projectsDialog.showModal();
      } else list.focus({ preventScroll: true });
    } else if (window.location.hash === '#about') {
      document.querySelector('#about').focus({ preventScroll: true });
    }
  };
  window.addEventListener('hashchange', handleHash);
  handleHash();
  [detailDialog, projectsDialog].forEach(dialog => {
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const bounds = dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right ||
          event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
    });
  });
})();
