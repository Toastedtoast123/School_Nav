(function () {
    const STORAGE_KEY = 'icct_onboarding_complete_v1';
    const overlay = document.getElementById('onboarding-overlay');
    const modal = document.getElementById('onboarding-modal');
    const stepLabel = document.getElementById('onboarding-step-label');
    const steps = Array.from(document.querySelectorAll('.onboarding-step'));
    const btnSkip = document.getElementById('onboarding-skip');
    const btnPrev = document.getElementById('onboarding-prev');
    const btnNext = document.getElementById('onboarding-next');
    const btnGetStarted = document.getElementById('onboarding-get-started');
    const btnClose = document.getElementById('onboarding-close');

    if (!overlay || !modal || !steps.length) return;
    // Show on every home refresh (remove first-time-only gating)
    // if (localStorage.getItem(STORAGE_KEY) === 'true') return;


    let current = 0;

    function setStep(index) {
        current = Math.max(0, Math.min(index, steps.length - 1));

        steps.forEach((s, i) => {
            s.classList.toggle('is-active', i === current);
            s.classList.toggle('is-next', i === current + 1);
        });

        const total = steps.length;
        stepLabel.textContent = `Step ${current + 1} of ${total}`;

        btnPrev.disabled = current === 0;
        btnNext.style.display = current === total - 1 ? 'none' : 'inline-flex';
        btnGetStarted.style.display = current === total - 1 ? 'inline-flex' : 'none';

        const progressPct = ((current + 1) / total) * 100;
        overlay.style.setProperty('--progress', progressPct + '%');

        // Animate modal content in (CSS handles fade/slide)
        modal.classList.remove('anim-in');
        void modal.offsetWidth;
        modal.classList.add('anim-in');
    }

    function closeTutorial() {
        localStorage.setItem(STORAGE_KEY, 'true');
        overlay.classList.remove('onboarding-visible');
        overlay.setAttribute('aria-hidden', 'true');
    }

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeTutorial();
    });

    btnSkip.addEventListener('click', closeTutorial);
    btnClose.addEventListener('click', closeTutorial);

    btnPrev.addEventListener('click', () => setStep(current - 1));
    btnNext.addEventListener('click', () => setStep(current + 1));
    btnGetStarted.addEventListener('click', (e) => {
        e.preventDefault();
        closeTutorial();
    });

    // First open
    overlay.classList.add('onboarding-visible');
    overlay.setAttribute('aria-hidden', 'false');
    setStep(0);

            // Optional: pause tutorial on Escape
    document.addEventListener('keydown', (e) => {
        if (!overlay.classList.contains('onboarding-visible')) return;
        if (e.key === 'Escape') closeTutorial();
    });
})();