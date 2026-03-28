// Mobile Navigation Toggle
const navToggle = document.querySelector('.nav-toggle');
const navLinks = document.querySelector('.nav-links');

if (navToggle && navLinks) {
  navToggle.addEventListener('click', () => {
    const isOpen = navLinks.classList.toggle('open');
    navToggle.setAttribute('aria-expanded', isOpen);
    navToggle.classList.toggle('active', isOpen);
  });

  document.addEventListener('click', (e) => {
    if (!navToggle.contains(e.target) && !navLinks.contains(e.target)) {
      navLinks.classList.remove('open');
      navToggle.setAttribute('aria-expanded', 'false');
      navToggle.classList.remove('active');
    }
  });
}

// Estimate Form Handling
const estimateForm = document.getElementById('estimate-form');

if (estimateForm) {
  estimateForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const formData = new FormData(estimateForm);
    const data = Object.fromEntries(formData.entries());

    const btn = estimateForm.querySelector('button[type="submit"]');
    const originalText = btn.textContent;
    btn.textContent = 'Sending...';
    btn.disabled = true;

    setTimeout(() => {
      btn.textContent = 'Thank You!';
      btn.style.background = '#28a745';
      estimateForm.reset();

      setTimeout(() => {
        btn.textContent = originalText;
        btn.style.background = '';
        btn.disabled = false;
      }, 3000);
    }, 800);
  });
}

// Navbar background on scroll
const mainNav = document.querySelector('.main-nav');

if (mainNav) {
  window.addEventListener('scroll', () => {
    if (window.scrollY > 50) {
      mainNav.style.boxShadow = '0 4px 20px rgba(0, 0, 0, 0.3)';
    } else {
      mainNav.style.boxShadow = '';
    }
  });
}

// Scroll-triggered animations
const observerOptions = {
  threshold: 0.15,
  rootMargin: '0px 0px -50px 0px'
};

const fadeInObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      fadeInObserver.unobserve(entry.target);
    }
  });
}, observerOptions);

document.querySelectorAll('.service-card, .why-us-card, .about-inner, .badge-item, .project-item, .drone-inner').forEach(el => {
  el.classList.add('fade-in');
  fadeInObserver.observe(el);
});

// Add fade-in animation styles dynamically
const style = document.createElement('style');
style.textContent = `
  .fade-in {
    opacity: 0;
    transform: translateY(30px);
    transition: opacity 0.6s ease, transform 0.6s ease;
  }
  .fade-in.visible {
    opacity: 1;
    transform: translateY(0);
  }
  .service-card.fade-in { transition-delay: calc(var(--i, 0) * 0.1s); }
  .why-us-card.fade-in { transition-delay: calc(var(--i, 0) * 0.1s); }
  .badge-item.fade-in { transition-delay: calc(var(--i, 0) * 0.08s); }
  .project-item.fade-in { transition-delay: calc(var(--i, 0) * 0.08s); }
`;
document.head.appendChild(style);

// Lightbox for project gallery
const lightbox = document.getElementById('lightbox');

if (lightbox) {
  const lbImg = lightbox.querySelector('img');
  const lbClose = lightbox.querySelector('.lightbox-close');
  const lbPrev = lightbox.querySelector('.lightbox-prev');
  const lbNext = lightbox.querySelector('.lightbox-next');
  let galleryImages = [];
  let currentIndex = 0;

  document.querySelectorAll('.project-item img').forEach((img, i) => {
    galleryImages.push(img.src);
    img.parentElement.addEventListener('click', () => {
      currentIndex = i;
      lbImg.src = galleryImages[currentIndex];
      lightbox.classList.add('active');
      document.body.style.overflow = 'hidden';
    });
  });

  function closeLightbox() {
    lightbox.classList.remove('active');
    document.body.style.overflow = '';
  }

  function navigate(dir) {
    currentIndex = (currentIndex + dir + galleryImages.length) % galleryImages.length;
    lbImg.src = galleryImages[currentIndex];
  }

  lbClose.addEventListener('click', (e) => { e.stopPropagation(); closeLightbox(); });
  lbPrev.addEventListener('click', (e) => { e.stopPropagation(); navigate(-1); });
  lbNext.addEventListener('click', (e) => { e.stopPropagation(); navigate(1); });

  lightbox.addEventListener('click', (e) => {
    if (e.target === lightbox) closeLightbox();
  });

  document.addEventListener('keydown', (e) => {
    if (!lightbox.classList.contains('active')) return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft') navigate(-1);
    if (e.key === 'ArrowRight') navigate(1);
  });
}

// Staggered animation delays
document.querySelectorAll('.service-card').forEach((card, i) => card.style.setProperty('--i', i));
document.querySelectorAll('.why-us-card').forEach((card, i) => card.style.setProperty('--i', i));
document.querySelectorAll('.badge-item').forEach((item, i) => item.style.setProperty('--i', i));
document.querySelectorAll('.project-item').forEach((item, i) => item.style.setProperty('--i', i));
