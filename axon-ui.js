(() => {
  'use strict';

  const root = document.documentElement;
  const body = document.body;
  const list = document.querySelector('.list');
  const cards = [...document.querySelectorAll('.card[data-focus-index]')];
  const counter = document.querySelector('#project-count');
  const caption = document.querySelector('#scene-caption');
  const motionButton = document.querySelector('#motion-toggle');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const videos = [...document.querySelectorAll('video')];
  const visibleVideos = new Set();
  const defaultCaptionHTML = caption ? caption.innerHTML : '';
  const totalCountText = String(cards.length).padStart(2, '0');
  let paused = reducedMotion.matches;
  let activeDialogProject = null;
  let captionTimer = 0;

  // Trigger choreographed entrance on first paint
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      root.classList.add('entered');
    });
  });

  // Video playback visibility & motion control
  const syncVideos = () => {
    for (const video of videos) {
      const card = video.closest('.card');
      const active = !paused && !document.hidden && (!card || !card.hidden) && visibleVideos.has(video);
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
  }, { root: null, threshold: 0.05 });

  videos.forEach(video => {
    video.muted = true;
    observer.observe(video);
  });

  const syncMotion = () => {
    motionButton.setAttribute('aria-pressed', String(paused));
    motionButton.textContent = paused ? '恢复动效' : '暂停动效';
    motionButton.setAttribute('aria-label', paused ? '恢复粒子与视频动效' : '暂停粒子与视频动效');
    window.dispatchEvent(new CustomEvent('axon:motion', { detail: { paused } }));
    syncVideos();
  };

  motionButton.addEventListener('click', () => {
    paused = !paused;
    syncMotion();
  });
  reducedMotion.addEventListener('change', event => {
    paused = event.matches;
    syncMotion();
  });
  document.addEventListener('visibilitychange', syncVideos);
  syncMotion();

  // Caption & counter coupling with central GPGPU particle sculpture
  const updateCaption = (htmlText) => {
    if (!caption) return;
    clearTimeout(captionTimer);
    if (paused || reducedMotion.matches) {
      caption.innerHTML = htmlText;
      return;
    }
    caption.classList.add('is-updating');
    captionTimer = window.setTimeout(() => {
      caption.innerHTML = htmlText;
      caption.classList.remove('is-updating');
    }, 130);
  };

  const setFocusedCard = (index) => {
    const valid = index >= 0 && index < cards.length;
    cards.forEach((card, idx) => {
      card.classList.toggle('is-focused', valid && idx === index);
    });
    if (list) list.classList.toggle('has-focus', valid);
    body.classList.toggle('has-project-focus', valid);

    if (valid) {
      const card = cards[index];
      const accent = card.style.getPropertyValue('--item-accent').trim() || '#bc99ff';
      root.style.setProperty('--active-accent', accent);
      if (counter) {
        counter.textContent = String(index + 1).padStart(2, '0');
        counter.setAttribute('aria-label', `当前聚焦第 ${index + 1} 个项目，共 ${cards.length} 个`);
      }
      if (card.dataset.caption) updateCaption(card.dataset.caption);
    } else {
      root.style.setProperty('--active-accent', '#b79ee8');
      if (counter) {
        counter.textContent = totalCountText;
        counter.setAttribute('aria-label', `当前展示 ${cards.length} 个项目`);
      }
      updateCaption(defaultCaptionHTML);
    }

    window.dispatchEvent(new CustomEvent('axon:focus', { detail: { index: valid ? index : -1 } }));
  };

  cards.forEach((card, index) => {
    card.addEventListener('pointerenter', (event) => {
      if (event.pointerType === 'touch') return;
      setFocusedCard(index);
    });
    card.addEventListener('focusin', () => setFocusedCard(index));
  });

  if (list) {
    list.addEventListener('pointerleave', () => {
      if (activeDialogProject === null) setFocusedCard(-1);
    });
    list.addEventListener('focusout', (event) => {
      if (!list.contains(event.relatedTarget) && activeDialogProject === null) {
        setFocusedCard(-1);
      }
    });
  }

  document.querySelectorAll('[data-focus-trigger]').forEach(trigger => {
    const idx = Number(trigger.dataset.focusTrigger);
    trigger.addEventListener('pointerenter', (event) => {
      if (event.pointerType !== 'touch') setFocusedCard(idx);
    });
    trigger.addEventListener('pointerleave', () => {
      if (activeDialogProject === null) setFocusedCard(-1);
    });
  });

  // Smooth modal dialog open, project switch & close
  const detailDialog = document.querySelector('#project-dialog');
  const detailContent = document.querySelector('#detail-content');
  const projectFocusMap = { bailijin: 1, crm: 2, luoxin: 2 };
  let closingTimer = 0;

  const bindDialogInternalActions = () => {
    detailContent.querySelectorAll('[data-switch-project]').forEach(btn => {
      btn.addEventListener('click', () => {
        openProjectDialog(btn.dataset.switchProject);
      });
    });
  };

  const openProjectDialog = (projectKey) => {
    const template = document.querySelector(`#project-${projectKey}`);
    if (!template || !detailDialog || !detailContent) return;

    clearTimeout(closingTimer);
    detailDialog.classList.remove('is-closing');
    activeDialogProject = projectKey;

    if (projectKey in projectFocusMap) {
      setFocusedCard(projectFocusMap[projectKey]);
    }

    if (detailDialog.open) {
      if (paused || reducedMotion.matches) {
        detailContent.replaceChildren(template.content.cloneNode(true));
        detailDialog.scrollTop = 0;
        bindDialogInternalActions();
      } else {
        detailContent.classList.add('is-switching');
        window.setTimeout(() => {
          detailContent.replaceChildren(template.content.cloneNode(true));
          detailDialog.scrollTop = 0;
          bindDialogInternalActions();
          detailContent.classList.remove('is-switching');
        }, 160);
      }
      return;
    }

    detailContent.replaceChildren(template.content.cloneNode(true));
    bindDialogInternalActions();
    detailDialog.showModal();
    window.dispatchEvent(new CustomEvent('axon:dialog', { detail: { open: true, project: projectKey } }));
  };

  const closeProjectDialog = () => {
    if (!detailDialog || !detailDialog.open || detailDialog.classList.contains('is-closing')) return;
    activeDialogProject = null;
    window.dispatchEvent(new CustomEvent('axon:dialog', { detail: { open: false } }));
    setFocusedCard(-1);

    if (paused || reducedMotion.matches) {
      detailDialog.classList.remove('is-closing');
      detailDialog.close();
      return;
    }

    detailDialog.classList.add('is-closing');
    closingTimer = window.setTimeout(() => {
      detailDialog.classList.remove('is-closing');
      detailDialog.close();
    }, 260);
  };

  document.querySelectorAll('[data-project]').forEach(button => {
    button.addEventListener('click', () => openProjectDialog(button.dataset.project));
  });

  document.querySelectorAll('[data-close-dialog]').forEach(button => {
    button.addEventListener('click', closeProjectDialog);
  });

  if (detailDialog) {
    detailDialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      closeProjectDialog();
    });
    detailDialog.addEventListener('click', (event) => {
      if (event.target !== detailDialog) return;
      const bounds = detailDialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right ||
          event.clientY < bounds.top || event.clientY > bounds.bottom) {
        closeProjectDialog();
      }
    });
  }

  const handleHash = () => {
    if (window.location.hash === '#projects' && list) {
      list.focus({ preventScroll: true });
    } else if (window.location.hash === '#about') {
      const about = document.querySelector('#about');
      if (about) about.focus({ preventScroll: true });
    }
  };
  window.addEventListener('hashchange', handleHash);
  handleHash();
})();
