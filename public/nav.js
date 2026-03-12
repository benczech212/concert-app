// Global Navigation Injection Script
document.addEventListener('DOMContentLoaded', () => {
  // --- 2) Create the Hamburger Button --- //
  const navBtn = document.createElement('button');
  navBtn.id = 'globalNavBtn';
  navBtn.innerHTML = '☰';
  navBtn.setAttribute('aria-label', 'Open Navigation');
  navBtn.classList.add('global-nav-btn');
  document.body.appendChild(navBtn);

  // --- 3) Create the Off-Canvas Menu --- //
  const navMenu = document.createElement('nav');
  navMenu.id = 'globalNavMenu';
  navMenu.classList.add('global-nav-menu');
  
  navMenu.innerHTML = `
    <div class="nav-header">
      <h2>Menu</h2>
      <button id="globalNavCloseBtn" aria-label="Close Navigation">✕</button>
    </div>
    <ul class="nav-links">
      <li><a href="index.html">Concert App (Lobby/Main)</a></li>
      <li><a href="charts-all.html">Global Dashboard</a></li>
      <li><a href="chart-mood.html">Mood Chart</a></li>
      <li><a href="chart-color.html">Color Chart</a></li>
      <li><a href="chart-reaction.html">Reaction Chart</a></li>
      <li><a href="chart-words.html">Word Cloud</a></li>
      <li><a href="stories.html">Track Stories</a></li>
      <li><a href="admin-controls.html">Admin Controls</a></li>
      <li><a href="admin-console.html">Admin Console</a></li>
      <li><a href="admin-settings.html">Admin Settings</a></li>
      <li><a href="kiosk.html?kiosk=1">Kiosk 1</a></li>
      <li><a href="kiosk.html?kiosk=2">Kiosk 2</a></li>
    </ul>
  `;
  document.body.appendChild(navMenu);

  // --- 4) Create the Overlay --- //
  const navOverlay = document.createElement('div');
  navOverlay.id = 'globalNavOverlay';
  navOverlay.classList.add('global-nav-overlay');
  document.body.appendChild(navOverlay);

  // --- 5) Create the subtle Admin Link (bottom right) --- //
  const adminLink = document.createElement('a');
  adminLink.href = 'admin-controls.html';
  adminLink.title = 'Admin';
  adminLink.innerHTML = '⚙️';
  adminLink.classList.add('global-admin-link');
  document.body.appendChild(adminLink);

  // --- 6) Event Listeners --- //
  const closeBtn = document.getElementById('globalNavCloseBtn');
  
  function openNav() {
    navMenu.classList.add('open');
    navOverlay.classList.add('open');
  }

  function closeNav() {
    navMenu.classList.remove('open');
    navOverlay.classList.remove('open');
  }

  navBtn.addEventListener('click', openNav);
  closeBtn.addEventListener('click', closeNav);
  navOverlay.addEventListener('click', closeNav);
});
